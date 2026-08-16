/**
 * x-publish 页内注入库 —— 在 X Article 编辑器页面上下文中运行
 *
 * 驱动无关：claude-in-chrome javascript_tool / Playwright page.evaluate /
 * CDP Runtime.evaluate / 手动贴 DevTools Console 均可。
 *
 * 技法来源（均为实测验证）：
 * - React Fiber 攀爬 + Draft.js 状态写入 + onFilesAdded 上传：
 *   改写自 punk2898/x-article-publisher (MIT) 与 xPoster 技法
 * - 渲染尺寸身份校验 / 全量重排：2026-08-16 CTExcel 长文实战沉淀
 *
 * 用法（按顺序）：
 *   1. 整个文件 eval 一次 → window.XA 就绪
 *   2. XA.ensureSampleChar()            // 空编辑器先生成字符样本
 *   3. XA.injectArticleFromB64(b64Html) // 注入全文（UTF-8 HTML 的 base64）
 *   4. XA.makeBridge()                  // 建桥接 input（外部把文件放进来）
 *   5. XA.fireUpload(anchor, fileName)  // 逐张发射；XA.pollUpload(fileName) 轮询
 *   6. XA.planRebuild(PLAN)             // 全量落位 [[anchor, [key...]], ...]
 *   7. XA.listAtomics()                 // 校验：位置 + 渲染尺寸
 *   8. XA.removeBridge()               // 清理
 */
window.XA = (() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── 编辑器发现 ──────────────────────────────────────
  function findEditorElement() {
    const sel = '[contenteditable="true"].public-DraftEditor-content, [data-contents="true"] [contenteditable="true"], [contenteditable="true"][role="textbox"]';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 200 && r.height > 80) return el;
    }
    return document.querySelector('.public-DraftEditor-content');
  }

  function findDraftStateNode() {
    const editor = findEditorElement();
    if (!editor) return null;
    const fk = Object.keys(editor).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (!fk) return null;
    let fiber = editor[fk];
    for (let d = 0; d < 80 && fiber; d++) {
      if (fiber.stateNode?.props?.editorState && typeof fiber.stateNode.props.onChange === 'function') return fiber.stateNode;
      const mp = fiber.memoizedProps;
      if (mp?.editorState && typeof mp.onChange === 'function') return { props: mp };
      fiber = fiber.return;
    }
    return null;
  }

  function findOnFilesAdded() {
    const editor = findEditorElement();
    if (!editor) return null;
    const fk = Object.keys(editor).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (!fk) return null;
    let fiber = editor[fk];
    for (let d = 0; d < 160 && fiber; d++) {
      const props = fiber.memoizedProps || fiber.stateNode?.props;
      if (typeof props?.onFilesAdded === 'function') return props.onFilesAdded;
      let child = fiber.child;
      for (let cd = 0; cd < 8 && child; cd++) {
        const cp = child.memoizedProps || child.stateNode?.props;
        if (typeof cp?.onFilesAdded === 'function') return cp.onFilesAdded;
        child = child.child;
      }
      fiber = fiber.return;
    }
    return null;
  }

  // ── 空编辑器字符样本（Draft 需要真实 CharacterMetadata 才能建带样式的块）──
  async function ensureSampleChar() {
    const dn = findDraftStateNode();
    const has = dn?.props.editorState.getCurrentContent().getBlockMap()
      .some(b => (b.getCharacterList()?.size || 0) > 0);
    if (has) return 'sample ok';
    const editor = findEditorElement();
    editor.focus();
    try { document.execCommand('insertText', false, 'x'); } catch (e) {}
    await sleep(300);
    return 'sample typed';
  }

  // ── 全文注入：base64(UTF-8 HTML) → Draft.js 块 ─────────
  function injectArticleFromB64(b64) {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const html = new TextDecoder('utf-8').decode(bytes);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const dn = findDraftStateNode();
    if (!dn) throw 'no draft node';
    const es = dn.props.editorState;
    const cs = es.getCurrentContent();
    const sample = cs.getBlockMap().find(b => (b.getCharacterList()?.size || 0) > 0);
    if (!sample) throw 'no character sample — run ensureSampleChar() first';
    const BlockCtor = sample.constructor;
    const CharMeta = sample.getCharacterList().first().constructor;
    const ImmList = sample.getCharacterList().constructor;
    const genKey = () => Math.random().toString(32).substring(2, 7);
    const makeList = a => { try { return ImmList(a); } catch (e) { return new ImmList(a); } };

    function extractText(elem) {
      let text = ''; const ranges = [];
      (function walk(n, bold) {
        if (n.nodeType === 3) {
          if (bold && n.textContent.length) ranges.push({ start: text.length, end: text.length + n.textContent.length });
          text += n.textContent;
        } else if (n.nodeType === 1) {
          const tag = n.tagName.toLowerCase();
          if (tag === 'br') { text += '\n'; return; }
          const isBold = bold || tag === 'strong' || tag === 'b';
          for (const c of n.childNodes) walk(c, isBold);
        }
      })(elem, false);
      return { text, ranges };
    }

    const defs = [];
    let pending = null;
    const flush = () => {
      if (pending && pending.text.trim()) defs.push({ type: 'unstyled', text: pending.text.trim(), ranges: pending.ranges });
      pending = null;
    };
    for (const child of doc.body.childNodes) {
      if (child.nodeType === 3) {
        const t = child.textContent.replace(/\s+/g, ' ');
        if (t.trim()) { if (!pending) pending = { text: '', ranges: [] }; pending.text += t.trim(); }
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'p' || tag === 'h2' || tag === 'h1' || tag === 'h3' || tag === 'blockquote') {
        flush();
        const type = (tag === 'p') ? 'unstyled' : (tag === 'blockquote') ? 'blockquote' : 'header-two';
        const { text, ranges } = extractText(child);
        if (text.trim()) defs.push({ type, text, ranges });
      } else if (tag === 'ul' || tag === 'ol') {
        flush();
        const liType = tag === 'ul' ? 'unordered-list-item' : 'ordered-list-item';
        for (const li of child.children) {
          if (li.tagName.toLowerCase() !== 'li') continue;
          const { text, ranges } = extractText(li);
          if (text.trim()) defs.push({ type: liType, text, ranges });
        }
      } else if (tag === 'br') {
        // skip
      } else {
        if (!pending) pending = { text: '', ranges: [] };
        const base = pending.text.length;
        const { text, ranges } = extractText(child);
        pending.text += text;
        for (const r of ranges) pending.ranges.push({ start: r.start + base, end: r.end + base });
        if (tag === 'strong' || tag === 'b') pending.ranges.push({ start: base, end: base + text.length });
      }
    }
    flush();

    const emptyMeta = CharMeta.create();
    const blocks = defs.map(d => {
      const chars = new Array(d.text.length).fill(emptyMeta);
      for (const r of d.ranges) for (let i = r.start; i < r.end && i < chars.length; i++) chars[i] = CharMeta.applyStyle(chars[i], 'BOLD');
      return new BlockCtor({ key: genKey(), type: d.type, text: d.text, characterList: makeList(chars), depth: 0 });
    });
    const newCS = cs.constructor.createFromBlockArray(blocks);
    let newES = es.constructor.push(es, newCS, 'insert-fragment');
    if (typeof es.constructor.moveFocusToEnd === 'function') newES = es.constructor.moveFocusToEnd(newES);
    dn.props.onChange(newES);
    const counts = defs.reduce((a, d) => (a[d.type] = (a[d.type] || 0) + 1, a), {});
    return { injected: blocks.length, types: counts };
  }

  // ── 锚点定位（startsWith 优先，includes 兜底）─────────
  function findAnchorBlock(blocks, anchor) {
    return blocks.find(b => b.getText().startsWith(anchor)) || blocks.find(b => b.getText().includes(anchor));
  }

  function placeCursorAtEndOf(anchor) {
    const dn = findDraftStateNode();
    const es = dn.props.editorState;
    const target = findAnchorBlock(es.getCurrentContent().getBlocksAsArray(), anchor);
    if (!target) return { ok: false, error: 'anchor not found: ' + anchor };
    const key = target.getKey(), len = target.getLength();
    const sel = es.getSelection().constructor.createEmpty(key).merge({ anchorOffset: len, focusOffset: len, hasFocus: true });
    dn.props.onChange(es.constructor.forceSelection(es, sel));
    return { ok: true, blockKey: key };
  }

  // ── 桥接 input（外部 setInputFiles / file_upload 往里放真实 File）──
  function makeBridge() {
    let b = document.getElementById('claude-bridge-input');
    if (!b) {
      b = document.createElement('input');
      b.type = 'file'; b.id = 'claude-bridge-input'; b.multiple = true;
      b.setAttribute('aria-label', 'claude bridge file input');
      b.style.cssText = 'position:fixed;top:2px;left:2px;width:120px;height:24px;z-index:99999;opacity:0.01;';
      document.body.appendChild(b);
    }
    return 'bridge ready';
  }
  function removeBridge() { document.getElementById('claude-bridge-input')?.remove(); return 'bridge removed'; }

  // ── 图片上传：光标到锚点 → 调 X 自己的 onFilesAdded ────
  async function uploadImageAfter(anchor, file) {
    const onFilesAdded = findOnFilesAdded();
    if (!onFilesAdded) return { ok: false, error: 'onFilesAdded not found' };
    const editor = findEditorElement();
    editor.focus();                    // 必须真实聚焦，否则插到文档头
    await sleep(120);
    const placed = placeCursorAtEndOf(anchor);
    if (!placed.ok) return placed;
    await sleep(150);
    let dn = findDraftStateNode();
    const before = new Set();
    dn.props.editorState.getCurrentContent().getBlockMap().forEach((b, k) => { if (b.getType() === 'atomic') before.add(k); });
    try { onFilesAdded([file]); } catch (e) { return { ok: false, error: 'onFilesAdded threw: ' + e.message }; }
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await sleep(500);
      dn = findDraftStateNode() || dn;
      const cs2 = dn.props.editorState.getCurrentContent();
      const keyList = [], candidates = [];
      cs2.getBlockMap().forEach((b, k) => { keyList.push(k); if (b.getType() === 'atomic' && !before.has(k)) candidates.push(k); });
      if (candidates.length) {
        const ai = keyList.indexOf(placed.blockKey);
        let chosen = candidates[0], best = Infinity;
        for (const k of candidates) { const d = Math.abs(keyList.indexOf(k) - ai); if (d < best) { best = d; chosen = k; } }
        return { ok: true, newAtomicKey: chosen, position: keyList.indexOf(chosen), anchorPosition: ai };
      }
    }
    return { ok: false, error: 'timeout waiting for atomic block' };
  }

  // fire-and-poll（避免驱动侧 eval 超时；上传在页面里继续跑）
  const _results = {};
  function fireUpload(anchor, fileName) {
    const b = document.getElementById('claude-bridge-input');
    if (!b) return 'NO BRIDGE';
    const f = [...b.files].find(x => x.name === fileName);
    if (!f) return 'NOT_IN_BRIDGE: ' + fileName + ' (has: ' + [...b.files].map(x => x.name).join(',') + ')';
    _results[fileName] = 'RUNNING';
    uploadImageAfter(anchor, f).then(r => { _results[fileName] = r; }).catch(e => { _results[fileName] = { ok: false, error: String(e) }; });
    return 'STARTED';
  }
  function pollUpload(fileName) { return _results[fileName] || 'UNKNOWN'; }

  // ── 全量落位：PLAN = [[anchor, [key, key...]], ...] ──
  // 注意：X 上传落定后会异步换块 key。安全流程 = 所有上传完成后统一重排，
  // 且 key 尽量来自「刚返回的上传结果」；事后一律用 listAtomics 渲染尺寸复核。
  function planRebuild(PLAN) {
    const dn = findDraftStateNode();
    const es = dn.props.editorState;
    const cs = es.getCurrentContent();
    const allKeys = PLAN.flatMap(([a, ks]) => ks);
    let bm = cs.getBlockMap();
    const saved = {};
    for (const k of allKeys) { saved[k] = bm.get(k); if (!saved[k]) throw 'missing block: ' + k; }
    let without = bm;
    for (const k of allKeys) without = without.delete(k);
    const entries = without.entrySeq().toArray();
    for (const [anchor, keys] of PLAN) {
      const ai = entries.findIndex(([k, b]) => b.getText().startsWith(anchor) || b.getText().includes(anchor));
      if (ai < 0) throw 'anchor missing: ' + anchor;
      entries.splice(ai + 1, 0, ...keys.map(k => [k, saved[k]]));
    }
    const newBm = without.constructor(entries);
    const SelState = es.getSelection().constructor;
    const sel = SelState.createEmpty(entries[entries.length - 1][0]);
    const ncs = cs.set('blockMap', newBm).set('selectionBefore', sel).set('selectionAfter', sel);
    dn.props.onChange(es.constructor.push(es, ncs, 'move-block'));
    return 'rebuilt ' + allKeys.length + ' blocks';
  }

  function deleteBlocks(keys) {
    const dn = findDraftStateNode();
    const es = dn.props.editorState;
    const cs = es.getCurrentContent();
    let bm = cs.getBlockMap();
    const missing = keys.filter(k => !bm.has(k));
    for (const k of keys) bm = bm.delete(k);
    const SelState = es.getSelection().constructor;
    const sel = SelState.createEmpty(bm.last().getKey());
    const ncs = cs.set('blockMap', bm).set('selectionBefore', sel).set('selectionAfter', sel);
    dn.props.onChange(es.constructor.push(es, ncs, 'remove-range'));
    return { deleted: keys.length - missing.length, missing };
  }

  // ── 校验：位置 + 渲染尺寸（唯一可靠的身份判据）────────
  function listAtomics() {
    const dn = findDraftStateNode();
    const arr = dn.props.editorState.getCurrentContent().getBlocksAsArray();
    const out = [];
    arr.forEach((b, i) => {
      if (b.getType() !== 'atomic') return;
      const img = document.querySelector('[data-offset-key="' + b.getKey() + '-0-0"] img');
      out.push({
        pos: i, key: b.getKey(),
        after: arr[i - 1]?.getText().substring(0, 12) || '(前一块是图)',
        imgSize: img ? img.naturalWidth + 'x' + img.naturalHeight : 'loading',
      });
    });
    return out;
  }

  function scrollToAtomic(idx) {
    const a = listAtomics()[idx];
    if (!a) return 'no atomic #' + idx;
    const el = document.querySelector('[data-offset-key="' + a.key + '-0-0"]');
    el?.scrollIntoView({ block: 'center' });
    return 'scrolled to #' + idx + ' (' + a.key + ')';
  }

  function textStats() {
    const dn = findDraftStateNode();
    const arr = dn.props.editorState.getCurrentContent().getBlocksAsArray();
    return {
      totalBlocks: arr.length,
      atomicCount: arr.filter(b => b.getType() === 'atomic').length,
      first: arr[0]?.getText().substring(0, 20),
      last: arr[arr.length - 1]?.getText().substring(0, 20),
    };
  }

  return {
    sleep, findEditorElement, findDraftStateNode, findOnFilesAdded,
    ensureSampleChar, injectArticleFromB64, placeCursorAtEndOf,
    makeBridge, removeBridge, uploadImageAfter, fireUpload, pollUpload,
    planRebuild, deleteBlocks, listAtomics, scrollToAtomic, textStats,
  };
})();
'XA lib loaded';
