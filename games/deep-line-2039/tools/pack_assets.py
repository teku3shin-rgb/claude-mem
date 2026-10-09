"""Blender で作ったモデル(glb)とテクスチャ(png)を js/assets.js に埋め込む。

index.html をファイルとして直接開いても読めるように、すべて base64 で一つの JS にまとめる。
使い方: python3 tools/pack_assets.py <モデルのディレクトリ> <テクスチャのディレクトリ> <出力 js>
（Pillow が必要）
"""
import base64
import io
import json
import os
import sys

from PIL import Image

MODELS, TEX, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
# 小物・人物用は 256px で十分
SMALL = {'fabric', 'burlap', 'leather', 'skin', 'rubber', 'gunwood', 'fur', 'rock'}


def jpeg(path, size, quality):
    im = Image.open(path).convert('RGB')
    if im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=quality, optimize=True)
    return buf.getvalue()


def main():
    models = {}
    for f in sorted(os.listdir(MODELS)):
        if f.endswith('.glb'):
            with open(os.path.join(MODELS, f), 'rb') as fh:
                models[f[:-4]] = base64.b64encode(fh.read()).decode()
    tex = {}
    total = 0
    for f in sorted(os.listdir(TEX)):
        if not f.endswith('.png'):
            continue
        key = f[:-4]
        name, kind = key.rsplit('_', 1)
        size = 256 if name in SMALL else 512
        q = 88 if kind == 'n' else 84
        data = jpeg(os.path.join(TEX, f), size, q)
        total += len(data)
        tex[key] = 'data:image/jpeg;base64,' + base64.b64encode(data).decode()
    with open(OUT, 'w') as fh:
        fh.write('// 自動生成ファイル（tools/pack_assets.py）。手で編集しないこと。\n')
        fh.write('// Blender で生成したモデル(glb)とテクスチャ(jpeg)を base64 で埋め込んでいる。\n')
        fh.write('window.DL_ASSETS = {\n')
        fh.write('  models: ' + json.dumps(models) + ',\n')
        fh.write('  tex: ' + json.dumps(tex) + ',\n')
        fh.write('};\n')
    print(f'models={len(models)} textures={len(tex)} tex-bytes={total} -> {OUT} ({os.path.getsize(OUT)} bytes)')


main()
