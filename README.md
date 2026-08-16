# Sulixing Skills

苏立行个人 AI OS 的 Codex 私有扩展仓库。

这里沉淀经过实际使用验证的 Codex Skill、MCP 工具与模型协作能力；所有插件均保持职责单一、可独立安装、可审计和可回滚。

## 当前模块

### `plugins/x-publish`

把本地 Markdown 长文发布为 X (Twitter) Article 草稿，图片与表格落回原文对应位置：

- 解析层提取「每张图跟在哪段后面」，正文整篇注入 X 编辑器（Draft.js），图片走 X 自带上传管线落到锚点段落后；
- 表格自动转图片、iPhone 图自动 EXIF 转正压缩、渲染尺寸校验兜底；
- 只存草稿，发布永远由用户手动；
- 核心脚本驱动无关：Claude Code（claude-in-chrome）已实测跑通（2026-08-16 CTExcel 长文），Playwright（Codex 用）与 DevTools 手动路径见插件内 `drivers/`。
- 同步约定：日常使用与迭代以 `/Volumes/GM7/.claude/skills/x-publish/` 为工作副本，验证后同步进本仓库发版。

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
- 若 Codex 桌面进程未继承网络代理，只在本机的 `~/.config/grok-task-router/config.json` 配置本机代理；不把该配置提交到仓库。
