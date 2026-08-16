#!/usr/bin/env python3
"""
prepare_images.py — 把文章图片处理成 X 可上传的规格，并产出插入计划。

输入: parse_markdown.py 的 JSON 输出文件
输出: --outdir 下的处理后图片 + stdout 打印 plan JSON

处理规则（全部来自实测踩坑）:
  1. EXIF orientation 先转正（iPhone 照片 orientation=6 不转会横躺）
  2. 长边 > 2048 缩到 2048
  3. 单文件 > 4.5MB 转 JPEG q88（X 图片上限 5MB）
  4. 文件名保持原 basename（扩展名可能 .png→.jpg），锚点映射不丢

plan JSON 结构:
  {
    "cover": {"path": "...", "skip": false},
    "images": [
      {"name": "xx.jpg", "path": "/outdir/xx.jpg",
       "anchor": "锚点文字片段（前块渲染文本的可辨识尾部）",
       "width": 1536, "height": 2048,
       "expected_preview": "900x1200"}   # X 编辑器预览尺寸（长边>1200 缩到 1200）
    ],
    "batches": [["a.jpg","b.jpg"], ...]  # 每批合计 <9MB（file_upload 单次 10MB 限制留余量）
  }

用法:
  python3 prepare_images.py article.json --outdir /tmp/x-publish-imgs
"""
import argparse
import json
import os
import re
import shutil
import sys

from PIL import Image, ImageOps

MAX_EDGE = 2048
MAX_BYTES = int(4.5 * 1024 * 1024)
PREVIEW_EDGE = 1200
BATCH_LIMIT = 9 * 1024 * 1024


def strip_md(text):
    """把 markdown 行内标记去掉，得到编辑器里的渲染文本。"""
    t = text
    t = re.sub(r'___CODE_BLOCK_END___', '', t)
    t = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', t)          # image
    t = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', t)      # link -> text
    t = re.sub(r'\*\*([^*]*)\*\*', r'\1', t)            # bold
    t = re.sub(r'\*([^*]*)\*', r'\1', t)                # italic
    t = re.sub(r'`([^`]*)`', r'\1', t)                  # inline code: keep backticks? editor keeps them -> 保留原样更稳
    t = re.sub(r'^#+\s*', '', t)                        # heading marks
    t = re.sub(r'^>\s*', '', t)                         # blockquote mark
    t = re.sub(r'^[-*+]\s+', '', t)                     # ul mark
    t = re.sub(r'^\d+\.\s+', '', t)                     # ol mark
    return t.strip()


def make_anchor(after_text):
    """取前块渲染文本的尾部片段作锚点（页内用 includes 匹配）。"""
    clean = strip_md(after_text or '')
    # 取最后 24 个字符，够独特又不易断在格式边界
    return clean[-24:] if len(clean) > 24 else clean


def expected_preview(w, h):
    if max(w, h) <= PREVIEW_EDGE:
        return f"{w}x{h}"
    if w >= h:
        return f"{PREVIEW_EDGE}x{round(h * PREVIEW_EDGE / w)}"
    return f"{round(w * PREVIEW_EDGE / h)}x{PREVIEW_EDGE}"


def process_one(src, outdir):
    img = Image.open(src)
    img = ImageOps.exif_transpose(img)
    w, h = img.size
    if max(w, h) > MAX_EDGE:
        r = MAX_EDGE / max(w, h)
        img = img.resize((int(w * r), int(h * r)), Image.LANCZOS)
    base = os.path.splitext(os.path.basename(src))[0]
    ext = os.path.splitext(src)[1].lower()

    # 无损路径：小 PNG / 已是 JPG 且尺寸方向都没动 → 直接拷贝
    orig_ok = (
        ext in ('.jpg', '.jpeg', '.png')
        and os.path.getsize(src) <= MAX_BYTES
        and img.size == Image.open(src).size  # 未缩放
        and (Image.open(src).getexif().get(274, 1) in (None, 1))  # 无需转向
    )
    if orig_ok:
        dst = os.path.join(outdir, os.path.basename(src))
        shutil.copy(src, dst)
        return dst, img.size

    dst = os.path.join(outdir, base + '.png')
    img.save(dst, 'PNG', optimize=True)
    if os.path.getsize(dst) > MAX_BYTES:
        os.remove(dst)
        dst = os.path.join(outdir, base + '.jpg')
        img.convert('RGB').save(dst, 'JPEG', quality=88)
    return dst, img.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('article_json')
    ap.add_argument('--outdir', required=True)
    ap.add_argument('--skip-cover', action='store_true',
                    help='不处理封面（用户自己传封面时用）')
    args = ap.parse_args()

    with open(args.article_json, encoding='utf-8') as f:
        art = json.load(f)
    os.makedirs(args.outdir, exist_ok=True)

    plan = {'cover': None, 'images': [], 'batches': []}

    if not args.skip_cover and art.get('cover_image') and art.get('cover_exists'):
        dst, size = process_one(art['cover_image'], args.outdir)
        plan['cover'] = {'path': dst, 'width': size[0], 'height': size[1]}

    for item in art.get('content_images', []):
        if not item.get('exists'):
            print(f"WARN missing: {item.get('path')}", file=sys.stderr)
            continue
        dst, size = process_one(item['path'], args.outdir)
        plan['images'].append({
            'name': os.path.basename(dst),
            'path': dst,
            'anchor': make_anchor(item.get('after_text', '')),
            'alt': item.get('alt', ''),
            'width': size[0], 'height': size[1],
            'expected_preview': expected_preview(*size),
        })

    batch, batch_bytes = [], 0
    for im in plan['images']:
        sz = os.path.getsize(im['path'])
        if batch and batch_bytes + sz > BATCH_LIMIT:
            plan['batches'].append(batch)
            batch, batch_bytes = [], 0
        batch.append(im['name'])
        batch_bytes += sz
    if batch:
        plan['batches'].append(batch)

    print(json.dumps(plan, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
