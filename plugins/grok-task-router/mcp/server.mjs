#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, realpath, stat } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";

const SERVER_NAME = "grok-task-router";
const SERVER_VERSION = "0.1.0";
const DEFAULT_MODEL = "grok-4.5";
const BUILD_ALIAS = "grok-build-0.1";
const MAX_STDOUT = 2_000_000;
const MAX_STDERR = 300_000;
const DEFAULT_TIMEOUT = 240_000;
const SEARCH_TIMEOUT = 600_000;
const DELEGATE_TIMEOUT = 600_000;
const DEFAULT_CONFIG_PATH = join(homedir(), ".config", "grok-task-router", "config.json");

const activeRuns = new Map();
let modelCache = null;

function asText(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function content(text, extra = {}) {
  return {
    content: [{ type: "text", text }],
    ...extra,
  };
}

function fail(message) {
  return content(`Grok 调用失败：${message}`, { isError: true });
}

function numberFromEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cliPath() {
  return process.env.GROK_ROUTER_CLI || join(homedir(), ".grok", "bin", "grok");
}

function routerConfigPath() {
  return process.env.GROK_ROUTER_CONFIG || DEFAULT_CONFIG_PATH;
}

function readRouterConfig() {
  try {
    const parsed = JSON.parse(readFileSync(routerConfigPath(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("配置文件必须是 JSON 对象");
    }
    return parsed;
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    throw new Error(`无法读取 Grok 路由配置：${error.message}`);
  }
}

function parseLocalProxy(value, source) {
  if (!value) return null;
  if (typeof value !== "string") throw new Error(`${source} 必须是字符串`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${source} 不是有效的代理地址`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${source} 只允许 http 或 https 代理`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${source} 不允许包含账号或密码`);
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error(`${source} 只允许本机回环地址`);
  }
  return { value: parsed.toString().replace(/\/$/, ""), source };
}

function proxyConfig() {
  if (process.env.GROK_ROUTER_PROXY) {
    return parseLocalProxy(process.env.GROK_ROUTER_PROXY, "GROK_ROUTER_PROXY");
  }
  const config = readRouterConfig();
  return parseLocalProxy(config.proxy, routerConfigPath());
}

function proxyStatus() {
  const proxy = proxyConfig();
  if (!proxy) return "本地代理：未配置（仅使用 Codex 继承的网络环境）";
  const parsed = new URL(proxy.value);
  return `本地代理：已配置（${parsed.hostname}:${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}；来源：${proxy.source}）`;
}

function safeEnv() {
  const keys = [
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TERM",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ];
  const environment = {
    ...Object.fromEntries(keys.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : [])),
    GROK_CURSOR_SKILLS_ENABLED: "false",
    GROK_CURSOR_RULES_ENABLED: "false",
    GROK_CURSOR_AGENTS_ENABLED: "false",
    GROK_CURSOR_MCPS_ENABLED: "false",
    GROK_CURSOR_HOOKS_ENABLED: "false",
    GROK_CLAUDE_SKILLS_ENABLED: "false",
    GROK_CLAUDE_RULES_ENABLED: "false",
    GROK_CLAUDE_AGENTS_ENABLED: "false",
    GROK_CLAUDE_MCPS_ENABLED: "false",
    GROK_CLAUDE_HOOKS_ENABLED: "false",
  };
  const proxy = proxyConfig();
  if (proxy) {
    environment.HTTP_PROXY = proxy.value;
    environment.HTTPS_PROXY = proxy.value;
    environment.http_proxy = proxy.value;
    environment.https_proxy = proxy.value;
  }
  return environment;
}

function stripAnsi(text) {
  return text.replace(/\u001B\[[0-?]*[ -\/]*[@-~]/g, "");
}

async function run(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT;
  const cwd = options.cwd || process.cwd();
  const requestId = options.requestId;

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: safeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: platform() !== "win32",
    });

    if (requestId !== undefined) activeRuns.set(String(requestId), child);

    let stdout = "";
    let stderr = "";
    let overflow = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_STDOUT) stdout += chunk;
      else overflow = true;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_STDERR) stderr += chunk;
    });

    const timer = setTimeout(() => {
      if (platform() === "win32") child.kill("SIGKILL");
      else {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
      rejectPromise(new Error(`超过 ${Math.ceil(timeoutMs / 1000)} 秒，已终止 Grok 子进程`));
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      if (requestId !== undefined) activeRuns.delete(String(requestId));
      rejectPromise(error);
    });

    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (requestId !== undefined) activeRuns.delete(String(requestId));
      if (overflow) stderr += "\n输出超过本地上限，已截断。";
      const result = { code, signal, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) };
      if (code === 0) resolvePromise(result);
      else rejectPromise(Object.assign(new Error(stderr.trim() || stdout.trim() || `退出码 ${code}`), { result }));
    });
  });
}

function extractModelIds(output) {
  const clean = stripAnsi(output);
  const ids = new Set();
  for (const match of clean.matchAll(/^\s*[*-]\s+([a-z0-9][a-z0-9._-]*)/gim)) ids.add(match[1]);
  const defaultMatch = clean.match(/Default model:\s*([a-z0-9._-]+)/i);
  if (defaultMatch) ids.add(defaultMatch[1]);
  return [...ids];
}

async function availableModels(force = false) {
  const now = Date.now();
  if (!force && modelCache && now - modelCache.at < 60_000) return modelCache;
  const result = await run(cliPath(), ["models"], { timeoutMs: 30_000 });
  modelCache = { at: now, models: extractModelIds(`${result.stdout}\n${result.stderr}`), raw: result.stdout.trim() };
  return modelCache;
}

async function resolveModel(requested = DEFAULT_MODEL) {
  if (![DEFAULT_MODEL, BUILD_ALIAS].includes(requested)) {
    throw new Error(`模型不在白名单中：${requested}`);
  }
  const status = await availableModels();
  if (status.models.includes(requested)) {
    return { requested, actual: requested, compatibility: false, available: status.models };
  }
  if (requested === BUILD_ALIAS && process.env.GROK_ROUTER_STRICT_MODELS !== "1" && status.models.includes(DEFAULT_MODEL)) {
    return {
      requested,
      actual: DEFAULT_MODEL,
      compatibility: true,
      available: status.models,
      note: `${BUILD_ALIAS} 当前未由官方 CLI 暴露，已使用 ${DEFAULT_MODEL} 的构建执行配置。`,
    };
  }
  throw new Error(`当前 Grok 账户不可用模型 ${requested}；可用模型：${status.models.join(", ") || "未检测到"}`);
}

function extractAssistantText(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  let parsed;
  try { parsed = JSON.parse(trimmed); } catch { return trimmed; }

  const candidates = [];
  const visit = (node) => {
    if (!node) return;
    if (typeof node === "string") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== "object") return;
    for (const key of ["output_text", "answer", "result", "response", "final", "text", "content"]) {
      if (typeof node[key] === "string" && node[key].trim()) candidates.push(node[key].trim());
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(parsed);
  return candidates.sort((a, b) => b.length - a.length)[0] || JSON.stringify(parsed, null, 2);
}

function commonHeadlessArgs(model) {
  return [
    "--model", model,
    "--output-format", "json",
    "--no-memory",
    "--no-subagents",
    "--no-plan",
  ];
}

async function consult(args, requestId) {
  const task = String(args.task || "").trim();
  if (!task) return fail("缺少 task");
  const contextText = String(args.context || "").trim();
  const purpose = ["answer", "review", "challenge"].includes(args.purpose) ? args.purpose : "answer";
  const model = await resolveModel(args.model || DEFAULT_MODEL);
  const isolated = await mkdtemp(join(tmpdir(), "grok-router-consult-"));
  const role = {
    answer: "独立回答问题，明确事实、推断与不确定性。",
    review: "审查给定内容，优先指出具体缺陷、风险、遗漏和可执行改进。",
    challenge: "站在反方进行压力测试，寻找最强反例和失败条件。",
  }[purpose];
  const prompt = [
    "你是由 Codex 临时调用的外部 Grok 顾问。",
    role,
    "不要声称已读取本地文件、执行命令或搜索网页；本次没有这些权限。",
    `任务：\n${task}`,
    contextText ? `必要上下文：\n${contextText}` : "",
    "用中文给出紧凑、可核验的结论。",
  ].filter(Boolean).join("\n\n");
  const cliArgs = [
    ...commonHeadlessArgs(model.actual),
    "--cwd", isolated,
    "--max-turns", "1",
    "--permission-mode", "dontAsk",
    "--disable-web-search",
    "--disallowed-tools", "run_terminal_cmd,search_replace,write_file,read_file,grep,list_dir,web_search,web_fetch,Agent",
    "--deny", "MCPTool",
    "--system-prompt-override", "你是隔离运行的 Grok 顾问。只处理用户显式提供的任务，不读取外部上下文，不使用本地或网络工具。",
    "--verbatim",
    "-p", prompt,
  ];
  const result = await run(cliPath(), cliArgs, {
    cwd: isolated,
    timeoutMs: numberFromEnv("GROK_ROUTER_TIMEOUT_MS", DEFAULT_TIMEOUT),
    requestId,
  });
  return content([
    `请求模型：${model.requested}`,
    `实际模型：${model.actual}`,
    model.note || "",
    "",
    "Grok 外部意见：",
    extractAssistantText(result.stdout),
  ].filter((line) => line !== "").join("\n"));
}

function xStatusTimestamp(id) {
  try {
    const millis = (BigInt(id) >> 22n) + 1288834974657n;
    return new Date(Number(millis)).toISOString();
  } catch { return null; }
}

function extractXLinks(text) {
  const found = new Map();
  const regex = /https?:\/\/(?:x\.com|twitter\.com)\/[^\s)\]}>"']+\/status\/(\d+)/gi;
  for (const match of text.matchAll(regex)) {
    const url = match[0].replace(/[.,;:!?]+$/, "");
    found.set(url, xStatusTimestamp(match[1]));
  }
  return [...found.entries()].map(([url, publishedAt]) => ({ url, publishedAt }));
}

async function searchX(args, requestId) {
  const query = String(args.query || "").trim();
  if (!query) return fail("缺少 query");
  const hours = Math.min(720, Math.max(1, Number(args.hours || 48)));
  const limit = Math.min(30, Math.max(1, Number(args.limit || 10)));
  const model = await resolveModel(args.model || DEFAULT_MODEL);
  const isolated = await mkdtemp(join(tmpdir(), "grok-router-search-"));
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
  const prompt = [
    "使用 X 搜索工具研究下面的问题。",
    `查询：${query}`,
    `时间范围：优先 ${cutoff} 之后发布的内容。`,
    `最多返回 ${limit} 条高价值结果；不要为了凑数伪造链接。`,
    "每条结果包含：作者、发布时间、核心观点、原帖 URL，以及它为什么与查询相关。",
    "最后区分可验证事实、个人观点和你的推断。用中文回答。",
  ].join("\n");
  const cliArgs = [
    ...commonHeadlessArgs(model.actual),
    "--cwd", isolated,
    "--max-turns", "20",
    "--permission-mode", "dontAsk",
    "--tools", "x_search,web_search,web_fetch",
    "--deny", "MCPTool",
    "--system-prompt-override", "你是隔离运行的公开信息研究员。只使用获准的 X 和网页搜索工具，输出真实来源链接，并明确区分事实与推断。",
    "--verbatim",
    "-p", prompt,
  ];
  const result = await run(cliPath(), cliArgs, {
    cwd: isolated,
    timeoutMs: numberFromEnv("GROK_ROUTER_SEARCH_TIMEOUT_MS", SEARCH_TIMEOUT),
    requestId,
  });
  const answer = extractAssistantText(result.stdout);
  const links = extractXLinks(answer);
  return content([
    `请求模型：${model.requested}`,
    `实际模型：${model.actual}`,
    model.note || "",
    `提取到的真实 X 状态链接：${links.length}`,
    "",
    answer,
    links.length ? `\n链接时间校验：\n${links.map((item) => `- ${item.publishedAt || "时间无法解码"} ${item.url}`).join("\n")}` : "",
  ].filter((line) => line !== "").join("\n"));
}

async function findGitRoot(start) {
  let current = start;
  while (true) {
    try {
      const info = await stat(join(current, ".git"));
      if (info.isDirectory() || info.isFile()) return current;
    } catch { /* 继续向上查找 */ }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isInside(child, parent) {
  const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child === parent || child.startsWith(normalizedParent);
}

async function validateWorkspace(pathValue, access, confirmWrite) {
  if (!pathValue || !isAbsolute(pathValue)) throw new Error("workspace 必须是已存在目录的绝对路径");
  const target = await realpath(pathValue);
  const info = await stat(target);
  if (!info.isDirectory()) throw new Error("workspace 不是目录");
  if (access !== "edit") return { target, gitRoot: await findGitRoot(target) };
  if (confirmWrite !== true) throw new Error("编辑模式必须显式传 confirm_write=true");
  if ([resolve(sep), resolve(homedir())].includes(resolve(target))) throw new Error("禁止把根目录或用户主目录作为编辑目标");

  const roots = String(process.env.GROK_ROUTER_ALLOWED_ROOTS || "")
    .split(delimiter).map((item) => item.trim()).filter(Boolean).map(resolve);
  const gitRoot = await findGitRoot(target);
  if (roots.length && !roots.some((root) => isInside(target, root))) {
    throw new Error(`目标不在 GROK_ROUTER_ALLOWED_ROOTS 内：${target}`);
  }
  if (!roots.length && !gitRoot) throw new Error("未配置允许根目录时，编辑目标必须位于 Git 仓库中");
  return { target, gitRoot };
}

async function gitStatus(gitRoot) {
  if (!gitRoot) return "（目标不是 Git 仓库，无法提供状态）";
  try {
    const result = await run("git", ["status", "--short"], { cwd: gitRoot, timeoutMs: 10_000 });
    return result.stdout.trim() || "（工作区无变更）";
  } catch (error) {
    return `（读取 Git 状态失败：${error.message}）`;
  }
}

async function delegate(args, requestId) {
  const task = String(args.task || "").trim();
  if (!task) return fail("缺少 task");
  const access = args.access === "edit" ? "edit" : "read_only";
  const workspace = await validateWorkspace(String(args.workspace || ""), access, args.confirm_write);
  const model = await resolveModel(args.model || BUILD_ALIAS);
  const acceptance = String(args.acceptance || "给出完成情况、验证证据和剩余风险。").trim();
  const prompt = [
    "这是 Codex 交接给你的限定任务。只在指定工作区和授权范围内行动。",
    `任务：\n${task}`,
    `验收标准：\n${acceptance}`,
    access === "read_only"
      ? "权限：只读。不得修改文件、运行 Shell、访问网络或创建外部状态。"
      : "权限：允许编辑工作区并运行必要的本地检查；禁止删除、提权、推送、重置、清理仓库、开 PR、打开 GUI 或执行外部发布。不要提交 Git。",
    "结束时列出实际检查或修改的文件、执行的验证、未解决问题。用中文回答。",
  ].join("\n\n");

  const cliArgs = [
    ...commonHeadlessArgs(model.actual),
    "--cwd", workspace.target,
    "--max-turns", access === "edit" ? "80" : "30",
    "--permission-mode", access === "edit" ? "auto" : "dontAsk",
    "--sandbox", access === "edit" ? "workspace" : "strict",
    "--disable-web-search",
  ];
  if (access === "read_only") {
    cliArgs.push(
      "--tools", "read_file,grep,list_dir",
      "--disallowed-tools", "run_terminal_cmd,search_replace,write_file,web_search,web_fetch,Agent",
      "--deny", "MCPTool",
    );
  } else {
    for (const rule of [
      "Bash(rm *)", "Bash(sudo *)", "Bash(git push*)", "Bash(git reset*)", "Bash(git clean*)",
      "Bash(gh *)", "Bash(curl *)", "Bash(wget *)", "Bash(ssh *)", "Bash(scp *)", "Bash(rsync *)",
      "Bash(npm publish*)", "Bash(pnpm publish*)", "Bash(yarn npm publish*)", "Bash(docker push*)",
      "Bash(kubectl *)", "Bash(terraform apply*)", "Bash(terraform destroy*)", "Bash(brew *)",
      "Bash(osascript *)", "Bash(open *)", "MCPTool",
    ]) cliArgs.push("--deny", rule);
  }
  cliArgs.push("-p", prompt);

  const result = await run(cliPath(), cliArgs, {
    cwd: workspace.target,
    timeoutMs: numberFromEnv("GROK_ROUTER_DELEGATE_TIMEOUT_MS", DELEGATE_TIMEOUT),
    requestId,
  });
  return content([
    `模式：${access}`,
    `工作区：${workspace.target}`,
    `请求模型：${model.requested}`,
    `实际模型：${model.actual}`,
    model.note || "",
    "",
    "Grok 任务结果：",
    extractAssistantText(result.stdout),
    "",
    "任务结束后的 Git 状态：",
    await gitStatus(workspace.gitRoot),
  ].filter((line) => line !== "").join("\n"));
}

async function statusTool() {
  const version = await run(cliPath(), ["version"], { timeoutMs: 15_000 });
  const models = await availableModels(true);
  return content([
    `CLI：${cliPath()}`,
    `版本：${version.stdout.trim()}`,
    `可用模型：${models.models.join(", ") || "未检测到"}`,
    `默认模型：${DEFAULT_MODEL}`,
    `兼容请求：${BUILD_ALIAS}${models.models.includes(BUILD_ALIAS) ? "（原生可用）" : "（将明确解析到 grok-4.5）"}`,
    proxyStatus(),
    "认证：官方 Grok CLI OAuth；本插件不读取令牌内容。",
    "OpenCodex：未使用。",
  ].join("\n"));
}

const tools = [
  {
    name: "grok_router_status",
    description: "检查官方 Grok Build CLI、OAuth 登录和当前可用模型，不消耗对话额度。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "consult_grok",
    description: "在隔离环境中调用 Grok 给出独立回答、审查或反方压力测试；不读取本地文件。",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", minLength: 1, description: "交给 Grok 的明确问题" },
        context: { type: "string", description: "完成任务所需的最少上下文，不含秘密" },
        purpose: { type: "string", enum: ["answer", "review", "challenge"], default: "answer" },
        model: { type: "string", enum: [DEFAULT_MODEL, BUILD_ALIAS], default: DEFAULT_MODEL },
      },
      required: ["task"], additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "search_x_with_grok",
    description: "只开放 Grok 的 X/网页搜索工具，返回带真实链接的公开 X 信息候选。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        hours: { type: "number", minimum: 1, maximum: 720, default: 48 },
        limit: { type: "integer", minimum: 1, maximum: 30, default: 10 },
        model: { type: "string", enum: [DEFAULT_MODEL, BUILD_ALIAS], default: DEFAULT_MODEL },
      },
      required: ["query"], additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "delegate_to_grok",
    description: "把限定的项目分析或编辑任务交给 Grok Build；编辑需要显式确认并受工作区沙箱约束。",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", minLength: 1 },
        workspace: { type: "string", minLength: 1, description: "目标项目绝对路径" },
        access: { type: "string", enum: ["read_only", "edit"], default: "read_only" },
        acceptance: { type: "string", description: "验收标准" },
        confirm_write: { type: "boolean", default: false },
        model: { type: "string", enum: [DEFAULT_MODEL, BUILD_ALIAS], default: BUILD_ALIAS },
      },
      required: ["task", "workspace"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

async function handle(request) {
  const { id, method, params = {} } = request;
  if (method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: params.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } } };
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools } };
  if (method === "notifications/cancelled") {
    const child = activeRuns.get(String(params.requestId));
    if (child) {
      if (platform() === "win32") child.kill("SIGTERM");
      else { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } }
    }
    return null;
  }
  if (method === "notifications/initialized") return null;
  if (method !== "tools/call") return { jsonrpc: "2.0", id, error: { code: -32601, message: `不支持的方法：${method}` } };

  try {
    const name = params.name;
    const args = params.arguments || {};
    let result;
    if (name === "grok_router_status") result = await statusTool();
    else if (name === "consult_grok") result = await consult(args, id);
    else if (name === "search_x_with_grok") result = await searchX(args, id);
    else if (name === "delegate_to_grok") result = await delegate(args, id);
    else return { jsonrpc: "2.0", id, error: { code: -32602, message: `未知工具：${name}` } };
    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    return { jsonrpc: "2.0", id, result: fail(error instanceof Error ? error.message : String(error)) };
  }
}

let buffer = Buffer.alloc(0);

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function consume(message) {
  let request;
  try { request = JSON.parse(message); }
  catch { return; }
  const response = await handle(request);
  if (response) writeMessage(response);
}

function parseBuffer() {
  while (buffer.length) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd >= 0) {
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) { buffer = buffer.subarray(headerEnd + 4); continue; }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.subarray(bodyStart + length);
      void consume(body);
      continue;
    }
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const line = buffer.subarray(0, newline).toString("utf8").trim();
    buffer = buffer.subarray(newline + 1);
    if (line) void consume(line);
  }
}

process.stdin.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); parseBuffer(); });
process.stdin.on("end", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
