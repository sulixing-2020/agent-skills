# Agent Skills

Practical AI agent skills built from real daily use. Each plugin solves one specific problem — install in one command, works across Claude Code, Codex, Cursor, and any MCP-compatible agent.

## Skills

### #01 [`grok-task-router`](plugins/grok-task-router/)

Let your primary agent (Claude / Codex / Cursor) route tasks to Grok — as an external consultant, X researcher, or bounded code executor.

| Tool | What it does |
|---|---|
| `consult_grok` | Independent answer, code review, or adversarial challenge in an isolated sandbox |
| `search_x_with_grok` | Search public X posts via Grok's native search, real links with timestamps |
| `delegate_to_grok` | Hand a bounded task to Grok Build in a target workspace |
| `grok_router_status` | Check CLI version, auth, available models |

**Install:**

```bash
# Claude Code
claude mcp add grok-task-router -- node plugins/grok-task-router/mcp/server.mjs

# Codex
codex plugin add grok-task-router@personal

# Cursor — add to .cursor/mcp.json
```

Prerequisites: [Grok Build CLI](https://docs.x.ai/docs/grok-build) + SuperGrok subscription

### #02 [`x-publish`](plugins/x-publish/)

Markdown → X Article draft, with images and tables landing in their original positions.

- Parses "which image follows which paragraph" from your markdown
- Injects full article into X's Draft.js editor
- Tables auto-convert to images (X doesn't support native tables)
- EXIF auto-rotation, compression, size validation
- **Saves as draft only — publishing is always manual**

Works with: Claude Code (claude-in-chrome), Playwright (Codex), or DevTools console (manual).

## Philosophy

- **Real use first**: every skill here was built to solve a problem I hit daily, then packaged for others
- **One command install**: no config files to create, no build steps
- **Agent-agnostic**: MCP standard means any compatible agent can use these
- **Security by default**: isolated sandboxes, dangerous commands denied, never touches your tokens

## Roadmap

- [x] #01 grok-task-router
- [x] #02 x-publish
- [ ] #03 (next skill — TBD)

## License

MIT

---

# Agent Skills（中文）

从真实日常使用中提炼的 AI Agent 技能。每个插件解决一个具体问题——一行命令安装，Claude Code / Codex / Cursor / 任何 MCP 兼容 Agent 都能用。

## 当前技能

### #01 [`grok-task-router`](plugins/grok-task-router/) — 让 Claude 指挥 Grok

把 Grok 变成你的外部顾问、X 搜索员、受控代码执行器。主 Agent 保持指挥权，Grok 在隔离沙箱里干活。

四个工具：咨询 Grok (`consult_grok`)、搜 X (`search_x_with_grok`)、交接编辑任务 (`delegate_to_grok`)、状态检查 (`grok_router_status`)。

安全边界卡得死：Grok 看不到你的对话历史、环境变量、API Key。

### #02 [`x-publish`](plugins/x-publish/) — Markdown 一键变 X Article 草稿

本地 Markdown 是唯一真相源。解析出每张图的位置，整篇注入 X 编辑器，图片落到对应段落后面。表格自动转图片，iPhone 照片自动转正压缩。

只存草稿，发布永远由你手动。

## 原则

- **真实使用优先**：每个技能都是先自己用、踩完坑、再开源
- **一行安装**：不需要额外配置或编译
- **Agent 无关**：MCP 标准协议，不绑定特定 Agent
- **默认安全**：隔离沙箱、危险命令拒绝、不碰你的 token

## 许可

MIT
