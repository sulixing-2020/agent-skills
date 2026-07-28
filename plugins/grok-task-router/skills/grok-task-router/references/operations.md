# 安装、使用与回滚

## 前置条件

```bash
grok version
grok login
grok models
node --version
```

要求 Node.js 18+，并已通过官方 Grok CLI 登录。

## 桌面版 Codex 的本地代理配置（按需）

若终端能访问 Grok、但 Codex 中调用 Skill 出现 DNS 或网络错误，通常是 Codex 桌面进程没有继承终端代理环境。此时可在本机创建配置文件：

```json
{
  "proxy": "http://127.0.0.1:7897"
}
```

固定位置为：

```text
~/.config/grok-task-router/config.json
```

可从插件根目录的 `config.example.json` 复制后按本机代理端口调整。

也可用环境变量 `GROK_ROUTER_PROXY` 临时覆盖。插件只接受 `127.0.0.1`、`localhost` 或 `::1` 的 HTTP/HTTPS 本地代理；不接受含账号密码或远程代理地址。该配置不含 Grok 凭据，也不应提交到 Git。

## 安装插件

插件安装到个人 marketplace 后执行：

```bash
codex plugin add grok-task-router@personal
```

新建 Codex 任务，使 Skill 与 MCP 工具进入工具列表。

## 常用请求

```text
用 Grok 独立审查这个技术方案。
用 Grok 反驳这个商业判断。
用 Grok 搜索最近 48 小时 X 上的 PDF 工具需求。
把 /path/to/repo 中这个限定修改交给 Grok，完成后由你检查。
检查 Grok CLI 当前登录和可用模型。
```

## 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `GROK_ROUTER_CLI` | 自动查找 `grok` | 指定官方 CLI 绝对路径 |
| `GROK_ROUTER_PROXY` | 空 | 临时指定本机 HTTP/HTTPS 代理，优先于本地配置文件 |
| `GROK_ROUTER_CONFIG` | `~/.config/grok-task-router/config.json` | 指定本地配置文件路径 |
| `GROK_ROUTER_TIMEOUT_MS` | `240000` | 顾问超时 |
| `GROK_ROUTER_SEARCH_TIMEOUT_MS` | `600000` | X 搜索超时 |
| `GROK_ROUTER_DELEGATE_TIMEOUT_MS` | `600000` | 任务交接超时 |
| `GROK_ROUTER_ALLOWED_ROOTS` | 空 | 编辑模式允许的根目录，用系统路径分隔符分隔 |
| `GROK_ROUTER_STRICT_MODELS` | `0` | 为 `1` 时禁止模型兼容回退 |

## 验证

```bash
node skills/grok-task-router/scripts/doctor.mjs
node --check mcp/server.mjs
node tests/smoke.mjs
```

在 Codex 新任务中调用 `grok_router_status`，然后用一句短问题调用 `consult_grok`。

## 回滚

```bash
codex plugin remove grok-task-router
```

需要彻底删除本地源时，再删除个人插件目录。插件不修改 Codex 的模型配置，因此回滚不需要恢复 `~/.codex/config.toml`。

若此前使用 OpenCodex，它仍可能继续代理 Codex 的原生模型；本插件不会自动卸载或修改它。应先用 OpenCodex 自带的恢复命令撤销全局代理，再单独使用本插件。不要在未备份 `~/.codex/config.toml` 的情况下手工覆盖配置。
