# 驱动手册：DevTools 控制台手动流程（零依赖・任何人可用）

不需要任何 agent / 自动化工具。只要一个登录了 x.com 的 Chrome 和本技能的 `scripts/` 目录。

## 步骤

1. **本地准备**：跑完 SKILL.md 的 Phase 1（三条 python 命令 + base64），得到 `article.b64` 和 `plan.json`、处理好的图片目录 `imgs/`。

2. **开草稿**：浏览器打开 `x.com/compose/articles` → 撰写 → 手动填标题、传封面。

3. **开控制台**：F12 → Console。把 `scripts/inpage_lib.js` 全文粘进去回车（显示 `XA lib loaded`）。

4. **注入正文**：
   ```js
   await XA.ensureSampleChar()
   XA.injectArticleFromB64('把 article.b64 的内容粘到这里')
   XA.textStats()   // 核对块数
   ```

5. **传图**：
   ```js
   XA.makeBridge()
   ```
   页面左上角出现一个几乎透明的小按钮（120x24 区域）——**手动点它**，文件选择框里把 `imgs/` 里的图全选上（这一步由人点，就没有任何自动化依赖）。然后逐张：
   ```js
   XA.fireUpload('锚点文字片段', '文件名.jpg')   // plan.json 里有每张的 anchor
   XA.pollUpload('文件名.jpg')                    // 反复回车直到 {ok: true, newAtomicKey: "..."}
   ```
   记下每张的 `newAtomicKey`，一张完成再传下一张。

6. **落位**：
   ```js
   XA.planRebuild([
     ['锚点1', ['key1']],
     ['锚点2', ['key2', 'key3']],
   ])
   ```

7. **校验**：
   ```js
   XA.listAtomics()        // 每张的 after（锚点）和 imgSize（对照 plan.json 的 expected_preview）
   XA.scrollToAtomic(0)    // 逐张滚过去用眼睛确认
   ```

8. **清理**：`XA.removeBridge()` → 确认「已保存」→ 预览 → 自己点发布。

## 常见问题

- `injectArticleFromB64` 报 `no character sample` → 先跑 `ensureSampleChar()`，或手动在正文区敲一个字符
- 图插到文档开头 → 页面失焦了，点一下正文区再 fireUpload（lib 内已做 focus，一般不会）
- `pollUpload` 一直 RUNNING → 大图上传慢，等；超过 90 秒返回 timeout 就重新 fireUpload
- 位置乱了 → 别慌，重新 `planRebuild` 即可，重排幂等
