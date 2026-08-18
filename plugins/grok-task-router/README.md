# grok-task-router

Route tasks to [xAI Grok](https://x.ai) from any MCP-compatible AI agent.

Use Grok as an external consultant, X researcher, or bounded code executor — while your primary agent (Claude Code, Codex, Cursor, or anything that speaks MCP) stays in control.

## What it does

| Tool | Purpose |
|---|---|
| `consult_grok` | Get an independent answer, code review, or adversarial challenge from Grok in an isolated sandbox |
| `search_x_with_grok` | Search public X posts via Grok's native X/web search, returns real links with timestamps |
| `delegate_to_grok` | Hand a bounded read-only or editing task to Grok Build in a target workspace |
| `grok_router_status` | Check CLI version, OAuth login, available models (no quota consumed) |

## Prerequisites

- [Grok Build CLI](https://docs.x.ai/docs/grok-build) installed and logged in (`grok login`)
- Node.js 18+
- A SuperGrok subscription (for API quota)

## Quick start

### Claude Code

```bash
claude mcp add grok-task-router -- node /path/to/grok-task-router/mcp/server.mjs
```

### Codex

```bash
codex plugin add grok-task-router@personal
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "grok-task-router": {
      "command": "node",
      "args": ["/path/to/grok-task-router/mcp/server.mjs"]
    }
  }
}
```

### Any MCP client

The server speaks JSON-RPC over stdio:

```bash
node /path/to/grok-task-router/mcp/server.mjs
```

## Usage examples

```
Ask Grok to independently review this technical proposal.
Use Grok to search X for AI agent trends in the last 24 hours.
Delegate this refactoring task in /path/to/repo to Grok, then review the diff.
Check Grok CLI status.
```

## How it works

```
Your agent (Claude / Codex / Cursor / DeepSeek / ...)
  └─ MCP call ──> grok-task-router (stdio server)
                    └─ spawns ──> official Grok Build CLI (headless)
                                    └─ Grok executes in isolation
                                    └─ returns result
                    └─ parses & returns to your agent
  └─ your agent verifies, synthesizes, continues
```

The calling agent's model, history, and tools are never exposed to Grok. Grok only sees the task and context you explicitly pass.

## Security

- **Consultant mode**: temp directory, no file/shell/network tools, overridden system prompt
- **X search mode**: only `x_search`, `web_search`, `web_fetch` enabled
- **Edit delegation**: explicit workspace + `confirm_write=true`, workspace sandbox, dangerous commands denied (`rm`, `sudo`, `git push`, `git reset`, publish, deploy, etc.)
- **All modes**: external MCP tools denied; child processes inherit only basic env vars (PATH, LANG, proxy); never forwards API keys
- **Auth**: managed by the official Grok CLI OAuth; this plugin never reads or copies tokens

## Model auto-detection

The default model is auto-detected from `grok models` CLI output. No hardcoded model names — when xAI releases a new default, it just works.

Set `GROK_ROUTER_STRICT_MODELS=1` to disable compatibility fallback.

## Proxy (optional)

If Grok CLI works in your terminal but fails from an agent, create `~/.config/grok-task-router/config.json`:

```json
{
  "proxy": "http://127.0.0.1:7897"
}
```

Only local loopback addresses accepted. See `config.example.json`.

## Verify installation

```bash
node --check mcp/server.mjs
node skills/grok-task-router/scripts/doctor.mjs
node tests/smoke.mjs
```

Then call `grok_router_status` from your agent.

## License

MIT

---

# grok-task-router（中文说明）

把任务路由给 [xAI Grok](https://x.ai)，支持所有 MCP 兼容的 AI Agent。

让 Grok 当外部顾问、X 搜索员或受控代码执行器，你的主 Agent（Claude Code / Codex / Cursor 等）保持指挥权。

## 四个工具

| 工具 | 用途 |
|---|---|
| `consult_grok` | 在隔离沙箱中获取 Grok 的独立回答、代码审查或反方压力测试 |
| `search_x_with_grok` | 通过 Grok 原生的 X/网页搜索，返回带真实链接和时间戳的公开帖子 |
| `delegate_to_grok` | 把限定范围的只读或编辑任务交给 Grok Build 在目标工作区执行 |
| `grok_router_status` | 检查 CLI 版本、OAuth 登录状态、可用模型（不消耗额度） |

## 前置条件

- [Grok Build CLI](https://docs.x.ai/docs/grok-build) 已安装并登录（`grok login`）
- Node.js 18+
- SuperGrok 订阅（API 额度）

## 快速安装

**Claude Code:**
```bash
claude mcp add grok-task-router -- node /path/to/grok-task-router/mcp/server.mjs
```

**Codex:**
```bash
codex plugin add grok-task-router@personal
```

**Cursor:** 在 `.cursor/mcp.json` 中添加 `grok-task-router` 条目（见上方英文说明）。

**其他 MCP 客户端:** `node /path/to/grok-task-router/mcp/server.mjs`（stdio JSON-RPC）。

## 安全边界

- 顾问模式：临时空目录，无文件/Shell/网络工具
- X 搜索模式：仅开放搜索工具
- 编辑交接：显式工作区 + `confirm_write=true`，沙箱 + 危险命令拒绝
- 所有模式拒绝外部 MCP；子进程不转发 API Key
- 认证由官方 Grok CLI OAuth 管理，本插件不接触令牌
