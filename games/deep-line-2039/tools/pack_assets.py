"""Blender で作ったモデル(glb)とテクスチャ(png)を JS ファイルに埋め込む。

index.html をファイルとして直接開いても読めるように、すべて base64 で JS にまとめる。
一つのファイルが大きくなりすぎないよう、用途ごとに別のファイルへ書き出せる（どれも window.DL_ASSETS に足し込む）。

使い方:
  python3 tools/pack_assets.py <出力 js> --models <glb のディレクトリ> --tex <png のディレクトリ> [--gltfpack]
  --gltfpack を付けると glb を gltfpack（meshoptimizer）で量子化・圧縮する（Node.js が必要）。
  gltfpack の場所は環境変数 GLTFPACK（cli.js のパス）で指定できる。無ければ npx gltfpack@1.3.0 を使う。
（Pillow が必要）
"""
import argparse
import base64
import io
import json
import os
import subprocess
import tempfile

from PIL import Image

# 小物・人物用は 256px で十分
SMALL = {'fabric', 'burlap', 'leather', 'skin', 'rubber', 'gunwood', 'fur', 'rock'}


def tex_size(key):
    name, kind = key.rsplit('_', 1)
    if name.startswith(('ch_', 'mu_')):
        return {'c': 1024, 'n': 512, 'r': 256}.get(kind, 512)
    return 256 if name in SMALL else 512


def jpeg(path, size, quality):
    im = Image.open(path).convert('RGB')
    if im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=quality, optimize=True)
    return buf.getvalue()


def gltfpack(src):
    cmd = ['node', os.environ['GLTFPACK']] if os.environ.get('GLTFPACK') else ['npx', '--yes', 'gltfpack@1.3.0']
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, 'out.glb')
        # テクスチャはゲーム側で付けるので、glb のマテリアルにはテクスチャが無い。そのため
        # -kv: 使われていないように見える UV も残す / -vtf: UV を量子化しない（復元用の変換はテクスチャに付くため失われる）
        subprocess.run(cmd + ['-i', src, '-o', out, '-kn', '-km', '-kv', '-vtf', '-cc'], check=True, capture_output=True)
        with open(out, 'rb') as fh:
            return fh.read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--models', action='append', default=[])
    ap.add_argument('--tex', action='append', default=[])
    ap.add_argument('--gltfpack', action='store_true')
    ap.add_argument('--skip', default='', help='含めない glb の名前（カンマ区切り）')
    a = ap.parse_args()
    skip = set(filter(None, a.skip.split(',')))
    models = {}
    for d in a.models:
        for f in sorted(os.listdir(d)):
            if f.endswith('.glb') and f[:-4] not in skip:
                p = os.path.join(d, f)
                data = gltfpack(p) if a.gltfpack else open(p, 'rb').read()
                models[f[:-4]] = base64.b64encode(data).decode()
    tex = {}
    total = 0
    for d in a.tex:
        for f in sorted(os.listdir(d)):
            if not f.endswith('.png'):
                continue
            key = f[:-4]
            kind = key.rsplit('_', 1)[1]
            q = 88 if kind == 'n' else 84
            data = jpeg(os.path.join(d, f), tex_size(key), q)
            total += len(data)
            tex[key] = 'data:image/jpeg;base64,' + base64.b64encode(data).decode()
    with open(a.out, 'w') as fh:
        fh.write('// 自動生成ファイル（tools/pack_assets.py）。手で編集しないこと。\n')
        fh.write('// Blender で生成したモデル(glb)とテクスチャ(jpeg)を base64 で埋め込んでいる。\n')
        fh.write('(function (A) {\n')
        fh.write('  A.models = Object.assign(A.models || {}, ' + json.dumps(models) + ');\n')
        fh.write('  A.tex = Object.assign(A.tex || {}, ' + json.dumps(tex) + ');\n')
        fh.write('})(window.DL_ASSETS = window.DL_ASSETS || {});\n')
    print(f'models={len(models)} textures={len(tex)} tex-bytes={total} -> {a.out} ({os.path.getsize(a.out)} bytes)')


main()
