"""MakeHuman の人体データ（CC0）を取得する。

MakeHuman / MPFB2 の基本メッシュ・体型ターゲット・リグ・ウェイトは CC0 で公開されている。
公式サイトの代わりに、それを同梱している PyPI パッケージ anny（NAVER LABS Europe）の wheel から
データ部分（anny/data/mpfb2/）だけを取り出して使う。コードは実行しない。

使い方: python tools/fetch_makehuman.py <出力ディレクトリ>   （例: assets/build/mpfb2）
"""
import hashlib
import io
import os
import sys
import urllib.request
import zipfile

URL = ('https://files.pythonhosted.org/packages/f8/5e/0833d42b1ed3afd6c5c52c61fc31185348bc6cc2e17f296c518d593fdc37/'
       'anny-0.6.1-py3-none-any.whl')
SHA256 = '9dbd3d6c2e5dae20a4f5e0b80e104f50fd13d2e15e42c90fc288e00d86e60e09'
PREFIX = 'anny/data/mpfb2/'


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'assets/build/mpfb2'
    if os.path.exists(os.path.join(out, '3dobjs', 'base.obj')):
        print('already fetched:', out)
        return
    print('downloading', URL)
    data = urllib.request.urlopen(URL, timeout=300).read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        sys.exit(f'sha256 mismatch: {digest}')
    n = 0
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for info in z.infolist():
            if not info.filename.startswith(PREFIX) or info.is_dir():
                continue
            rel = info.filename[len(PREFIX):]
            if '..' in rel.split('/'):
                continue
            dst = os.path.join(out, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, 'wb') as fh:
                fh.write(z.read(info))
            n += 1
    print(f'extracted {n} files -> {out}')


main()
