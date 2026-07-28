# Sulixing Skills

苏立行个人 AI OS 的 Codex 私有扩展仓库。

这里沉淀经过实际使用验证的 Codex Skill、MCP 工具与模型协作能力；所有插件均保持职责单一、可独立安装、可审计和可回滚。

## 当前模块

### `plugins/grok-task-router`

通过官方 Grok Build CLI 的 OAuth 会话，让 Codex 在不依赖 OpenCodex 的情况下：

- 调用 Grok 作为独立顾问、审查者或反方；
- 搜索公开 X 与网页信号；
- 将边界明确的只读或编辑任务交接给 Grok；
- 保持 Codex 当前会话主模型不变。

详细安装、模型兼容、安全边界与回滚说明见插件内文档。

## 本地原则

- 不提交密码、Cookie、OAuth 凭据、API Key 或公司资料；
- Grok 登录通过每台设备的官方 CLI 单独完成；
- 新 Skill 先在个人环境验证，再进入此仓库；
- 重要模型结论需要由主任务复核，不把外部模型输出视为最终事实。
