---
name: x-publish
description: 把本地 Markdown 长文（含图片/表格按原位置落位）发布为 X (Twitter) Article 草稿。自然语言直接触发，不需要斜杠命令——任何「把这篇/某文件 发到 X（推特）上」「发 X 长文」「传一篇 X 文章」「这篇 md 发推特长文」「publish to X article」之类的表述都算；/x-publish 也可以。只存草稿绝不发布。适用于任何能跑 shell + 能向浏览器页面注入 JS 的 agent（Claude Code / Codex 等），驱动差异见 drivers/。
---

# x-publish — Markdown → X Article 草稿（图片表格原位落地）

**一句话**：本地 markdown 是唯一真相源；解析出「每张图跟在哪段后面」，把文字整篇注入 X 编辑器（Draft.js），再调 X 自己的上传函数把图放到锚点段落后，最后用渲染尺寸校验每张图的身份与位置。

**验证记录**：2026-08-16 CTExcel 长文（92 文字块 + 8 图 + 表格转图）全流程跑通。

## 前置条件

- 浏览器已登录 x.com，账号有 Premium（Articles 权限）
- Python 3.9+ 与 Pillow（表格转图需要系统中文字体，macOS 用 PingFang）
- 驱动：Claude Code 用 claude-in-chrome（本文档主路径）；其他 agent 见 `drivers/`

## 安全红线（必须遵守）

1. **绝不点「发布」**——流程终点是草稿 + 校验报告，发布永远由用户手动
2. **封面策略先问用户**：用户常自己做封面图（问一句"封面用文档里第一张图，还是你自己传？"）。用户自己传过的封面**绝对不碰**
3. 只操作本次新建的草稿，不碰用户其他草稿
4. 发布前用户要自查内容红线（内部路径截图、IP、手机号打码等）

## Phase 1 — 本地准备（纯 shell，驱动无关）

```bash
SKILL_DIR=<本技能目录>   # GM7 技能库: /Volumes/GM7/.claude/skills/x-publish ；仓库安装: .../plugins/x-publish/skills/x-publish
WORK=$(mktemp -d)

# 1. 若正文有 markdown 表格：先转图片，并把表格替换成 ![表格](生成的png路径)
#    （X 不支持原生表格，这是平台限制）
python3 $SKILL_DIR/scripts/table_to_image.py 表格片段.md $WORK/table.png --scale 2
#    然后编辑一份「发布版 md」：去掉编辑元数据（头尾 blockquote 备注）、表格换成图片引用

# 2. 解析
python3 $SKILL_DIR/scripts/parse_markdown.py 发布版.md --output json > $WORK/article.json
python3 $SKILL_DIR/scripts/parse_markdown.py 发布版.md --html-only > $WORK/article.html

# 3. 图片预处理（EXIF 转正 / 缩放 / 压到 5MB 内）+ 产出插入计划
python3 $SKILL_DIR/scripts/prepare_images.py $WORK/article.json --outdir $WORK/imgs --skip-cover > $WORK/plan.json
#    plan.json: images[].{name, path, anchor, expected_preview} + batches[]（每批 <9MB）

# 4. 正文 HTML 转 base64（注入用）
base64 < $WORK/article.html | tr -d '\n' > $WORK/article.b64
```

检查 `article.json`：`missing_images` 必须为 0；`plan.json` 里每张图都要有非空 `anchor`。

## Phase 2 — 浏览器执行（Claude Code + claude-in-chrome 主路径）

工具名：`mcp__claude-in-chrome__*`（navigate / find / computer / form_input / file_upload / javascript_tool）。

1. **新建草稿**：navigate 到 `x.com/compose/articles` → 点「撰写」→ URL 变为 `/compose/articles/edit/<id>`
2. **标题**：find「添加标题 textbox」→ form_input 填入（H1 已被解析器摘出，不会重复出现在正文）
3. **封面**（仅当用户要求用文档封面时）：find `data-testid=fileInput` 的 file input → file_upload 封面图 → 弹「编辑媒体」→ 点「应用」。**注意：这个 fileInput 的默认路由就是封面，绝不能用它插正文图**
4. **装库**：Read `scripts/inpage_lib.js` 全文 → javascript_tool 执行（得到 `window.XA`）
5. **注入正文**：
   ```js
   await XA.ensureSampleChar();                 // 空编辑器必须先做
   XA.injectArticleFromB64('<article.b64 内容>');  // 返回 {injected, types}
   XA.textStats();                              // 核对块数/首尾文字
   ```
6. **建桥 + 传文件**：`XA.makeBridge()` → find「claude bridge file input」→ 按 `plan.batches` 分批 file_upload（单批 <10MB）
7. **逐张上传**（串行，一张确认后再下一张）：
   ```js
   XA.fireUpload('<anchor>', '<name>');   // 立即返回 STARTED
   // 驱动侧轮询（每 4-6 秒）：
   XA.pollUpload('<name>');               // {ok, newAtomicKey, ...}
   ```
   记下每张的 `newAtomicKey`。**大图上传 >45s 会超时驱动侧 eval——所以必须用 fire/poll 模式，绝不在一次 eval 里 await 多张**
8. **全量落位**（所有上传完成后一次做）：
   ```js
   XA.planRebuild([
     ['锚点片段1', ['key1']],
     ['锚点片段2', ['key2', 'key3']],   // 同锚多图：数组序 = 显示序
   ]);
   ```
9. **校验（必做，不做等于没完成）**：
   ```js
   XA.listAtomics();   // [{pos, key, after, imgSize}]
   ```
   - 每张 `imgSize` 对照 plan.json 的 `expected_preview`（±3px 容差）
   - `after` 对照锚点
   - **同尺寸图无法靠尺寸区分身份 → 必须 `XA.scrollToAtomic(i)` + 截图逐张目检**
   - 有错 → `XA.deleteBlocks([...])` 删错块 / 重新 `planRebuild` / 缺图回到第 7 步补传 → 再校验
10. **清理**：`XA.removeBridge()` → 确认顶栏出现「已保存」→ 向用户输出校验表（每张图：位置锚点 + 验证方式）→ **停，让用户预览并手动发布**

分割线（可选）：原文 `---` 不自动插入（正文 H2 已分节）。用户要的话走 UI：`XA.placeCursorAtEndOf(锚点)` → 真实点击工具栏「插入」→「分割线」（必须真实点击，合成事件 X 不认）。

## 已踩过的坑（规则化，违反必翻车）

| # | 坑 | 规则 |
|---|---|---|
| 1 | Draft.js 只认真实焦点 | 任何 forceSelection 前先 `editor.focus()`（lib 已内置），否则图片插到文档头 |
| 2 | 空编辑器没有 CharacterMetadata 样本 | 注入前必须 `ensureSampleChar()` |
| 3 | **X 上传落定后异步换块 key、可能重排** | 上传期间不搬块；全部传完后统一 `planRebuild`；**身份判定只信渲染尺寸 + 截图目检**，绝不信历史 key / localMediaId |
| 4 | 删除块也会因换 key 删错 | 删除后立刻 `listAtomics()` 用尺寸复核 |
| 5 | `data-testid=fileInput` 是封面通道 | 正文图只走 bridge + `onFilesAdded` |
| 6 | iPhone 图 EXIF orientation=6 | 必须 `exif_transpose` 后再压（prepare_images.py 已内置） |
| 7 | 驱动 eval 有 45s 超时 | 上传用 fire/poll；长等待拆多次轮询 |
| 8 | 合成鼠标/键盘事件 X 大多不认（isTrusted 校验） | 页面 UI 点击用驱动的真实点击（ref/坐标），不用 dispatchEvent |

## 跨 agent 使用

- **核心资产驱动无关**：`scripts/` 四个文件（2 个解析 Python、1 个图片预处理 Python、1 个页内 JS 库）
- Claude Code：本文档 Phase 2
- Codex / 其他 CLI agent：`drivers/playwright.md`（Playwright 驱动，未实测标注）
- 任何人肉兜底：`drivers/console-manual.md`（DevTools 控制台手动流程，零依赖）

## 已知边界

- ✅ H2、粗体、列表、引用、图片位置、封面
- 🔄 表格→图片（平台限制）；斜体/删除线解析层暂未提取（parse_markdown 只标 BOLD）
- ⚠️ 代码块降级为引用块（X 无代码块）；H1/H3 都渲染为 header-two；链接以纯文本注入（X 发布时自动识别 URL）
- 长文分割线不自动化（可手动/UI 路径）

## 致谢

- 解析层 `parse_markdown.py` / `table_to_image.py`：wshuyi/x-article-publisher-skill (MIT)
- 页内注入技法（Fiber 攀爬 / onFilesAdded / 标记落位思想）：punk2898/x-article-publisher (MIT)、xPoster
