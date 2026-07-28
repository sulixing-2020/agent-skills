# 架构与边界

## 目录结构

```text
grok-task-router/
├── .codex-plugin/plugin.json          插件清单与界面元数据
├── .mcp.json                          MCP 进程启动配置
├── mcp/server.mjs                     独立实现的 stdio MCP Server
├── skills/grok-task-router/
│   ├── SKILL.md                       Codex 路由规则
│   ├── agents/openai.yaml             Skill 界面与 MCP 依赖
│   ├── references/architecture.md     架构与安全边界
│   ├── references/operations.md       安装、使用和回滚
│   └── scripts/doctor.mjs             本地 CLI/OAuth 诊断
└── tests/
    ├── fake-grok.mjs                  不消耗额度的假 CLI
    └── smoke.mjs                      MCP 协议与安全冒烟测试
```

## 两种模式

### Codex 主控下调用 Grok

```text
Codex 当前模型
  -> grok-task-router MCP
  -> 官方 Grok Build CLI（无头模式）
  -> Grok 输出
  -> Codex 核验与综合
```

当前 Codex 模型、对话历史和工具仍由 Codex 管理。Grok 只看到显式传入的任务与上下文。

### 任务级交接给 Grok

```text
Codex 当前模型
  -> delegate_to_grok
  -> Grok Build 在指定工作区执行
  -> 返回结果与 Git 状态
  -> Codex 检查并继续
```

这不是 Codex UI 中的主模型切换。Skill 和 MCP 都不能把一个已经运行的 Codex 对话替换成另一家模型。若需要 Grok 完整接管编码任务，应使用任务交接，或在终端直接启动官方 Grok TUI。

## 为什么不用 OpenCodex

- 官方 Grok CLI 已支持 OAuth、无头运行、模型选择、工具限制与沙箱。
- 避免本地全局代理失效时连带影响 Codex 原生 OpenAI 模型。
- 避免修改 `~/.codex/config.toml`、模型目录和恢复历史。
- 认证仍由官方 CLI 管理，插件不读取或复制令牌内容。

## 安全边界

- 顾问模式在临时空目录运行，用独立系统提示覆盖外部项目规则，关闭 Claude/Cursor 兼容发现、记忆、子 Agent、计划和网页搜索，并移除本地文件与 Shell 工具。
- X 搜索模式只开放 `x_search`、`web_search` 和 `web_fetch`。
- 编辑交接要求显式工作区与 `confirm_write=true`，并使用工作区沙箱及危险命令拒绝规则。
- 所有模式拒绝外部 MCP 工具；编辑模式额外拒绝网络命令、发布、推送、部署、提权和破坏性 Git 操作。
- 子进程只继承基础语言、证书与代理环境；不会转发 `XAI_API_KEY` 或其他任意环境变量。
- 输出有限长；超时会终止子进程组。
- 认证、额度和模型可用性由官方 Grok CLI 决定。

## 模型兼容

当前本机官方 CLI 的 `grok models` 只列出 `grok-4.5`。`grok-build-0.1` 是旧集成中出现过的模型标识，未必继续对官方 CLI 账户开放。本插件保留该请求名用于兼容，但默认会明确解析到 `grok-4.5` 的构建执行配置；严格模式下则直接报错。
