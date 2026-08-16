# 驱动手册：Playwright（Codex 及其他 CLI agent 用）

> ⚠️ 状态：**流程已设计、未实测**（claude-in-chrome 路径已实测）。首次跑通后请把差异写回本文件。

适用：Codex CLI、或任何能跑 Node/Python Playwright 的 agent。核心逻辑与主路径完全一致——差异只在「谁来执行浏览器动作」。

## 一次性准备

```bash
npm i -g playwright && npx playwright install chromium
# 持久化 profile：首次跑会开浏览器窗口，人工登录 x.com 一次，之后复用
PROFILE=~/.x-publish-profile
```

## 执行骨架（Node）

```js
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const ctx = await chromium.launchPersistentContext(process.env.HOME + '/.x-publish-profile', { headless: false });
  const page = await ctx.newPage();
  await page.goto('https://x.com/compose/articles');
  await page.getByText('撰写').click();                       // 新草稿
  await page.getByPlaceholder('添加标题').fill(TITLE);

  // 封面（可选）：X 的封面 fileInput
  // await page.setInputFiles('[data-testid="fileInput"]', COVER);
  // await page.getByText('应用').click();

  // 装页内库
  const lib = fs.readFileSync(SKILL_DIR + '/scripts/inpage_lib.js', 'utf8');
  await page.evaluate(lib);

  // 注入正文
  await page.evaluate(() => XA.ensureSampleChar());
  const b64 = fs.readFileSync(WORK + '/article.b64', 'utf8');
  await page.evaluate(b => XA.injectArticleFromB64(b), b64);

  // 桥接 input + 放文件（Playwright 原生支持）
  await page.evaluate(() => XA.makeBridge());
  await page.setInputFiles('#claude-bridge-input', plan.images.map(i => i.path));

  // 逐张上传（fire + poll，与主路径同）
  const keys = {};
  for (const im of plan.images) {
    await page.evaluate(([a, n]) => XA.fireUpload(a, n), [im.anchor, im.name]);
    let r;
    do { await page.waitForTimeout(4000); r = await page.evaluate(n => XA.pollUpload(n), im.name); }
    while (r === 'RUNNING');
    if (!r.ok) throw new Error(im.name + ': ' + r.error);
    keys[im.name] = r.newAtomicKey;
  }

  // 全量落位（同锚多图按 plan 顺序合组）
  const PLAN = buildPlanGroups(plan, keys);   // [[anchor, [key...]], ...]
  await page.evaluate(p => XA.planRebuild(p), PLAN);

  // 校验：渲染尺寸 vs expected_preview（±3px）；同尺寸图截图目检
  const atomics = await page.evaluate(() => XA.listAtomics());
  // ... 对照 plan.json，错则 deleteBlocks / 重排 / 补传
  await page.evaluate(() => XA.removeBridge());
  // 绝不点发布。停在草稿。
})();
```

## 与主路径的差异点

| 事项 | claude-in-chrome | Playwright |
|---|---|---|
| 放文件进 bridge | find + file_upload 工具 | `page.setInputFiles('#claude-bridge-input', paths)` |
| 真实点击（封面「应用」、插入菜单） | computer left_click (ref) | `page.getByText(...).click()`（天然 trusted） |
| eval 超时 | 45s → 必须 fire/poll | 默认 30s → 同样用 fire/poll 更稳 |
| 登录态 | 用户日常 Chrome | 持久化 profile 首次人工登录 |

## SKILL.md 的坑规则全部适用

尤其：#3（换 key → 只信渲染尺寸）、#6（EXIF）、上传串行。校验步骤不可省。
