#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const fake = join(here, "fake-grok.mjs");
await chmod(fake, 0o755);

const fixture = await mkdtemp(join(tmpdir(), "grok-router-test-"));
await mkdir(join(fixture, ".git"));
await writeFile(join(fixture, "README.md"), "fixture\n");

const server = spawn(process.execPath, [join(root, "mcp", "server.mjs")], {
  cwd: root,
  env: { ...process.env, GROK_ROUTER_CLI: fake },
  stdio: ["pipe", "pipe", "inherit"],
});

let nextId = 1;
let textBuffer = "";
const pending = new Map();
server.stdout.setEncoding("utf8");
server.stdout.on("data", (chunk) => {
  textBuffer += chunk;
  while (textBuffer.includes("\n")) {
    const index = textBuffer.indexOf("\n");
    const line = textBuffer.slice(0, index).trim();
    textBuffer = textBuffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); waiter.resolve(message); }
  }
});

function rpc(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`RPC 超时：${method}`));
    }, 5000);
  });
}

try {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.result.serverInfo.name, "grok-task-router");

  const listed = await rpc("tools/list");
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), [
    "grok_router_status", "consult_grok", "search_x_with_grok", "delegate_to_grok",
  ]);

  const status = await rpc("tools/call", { name: "grok_router_status", arguments: {} });
  assert.match(status.result.content[0].text, /可用模型：grok-4\.5/);
  assert.match(status.result.content[0].text, /OpenCodex：未使用/);

  const consult = await rpc("tools/call", {
    name: "consult_grok",
    arguments: { task: "审查测试", purpose: "review", model: "grok-build-0.1" },
  });
  assert.match(consult.result.content[0].text, /请求模型：grok-build-0\.1/);
  assert.match(consult.result.content[0].text, /实际模型：grok-4\.5/);

  const delegated = await rpc("tools/call", {
    name: "delegate_to_grok",
    arguments: { task: "读取说明", workspace: fixture, access: "read_only" },
  });
  assert.match(delegated.result.content[0].text, /模式：read_only/);

  const rejected = await rpc("tools/call", {
    name: "delegate_to_grok",
    arguments: { task: "危险编辑", workspace: "/", access: "edit", confirm_write: true },
  });
  assert.equal(rejected.result.isError, true);
  assert.match(rejected.result.content[0].text, /禁止把根目录/);

  console.log("全部 MCP 冒烟测试通过。\n- 初始化\n- 工具清单\n- CLI 状态\n- 模型兼容解析\n- 只读交接\n- 编辑安全拒绝");
} finally {
  server.kill("SIGTERM");
}
