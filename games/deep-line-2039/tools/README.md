# Blender アセットパイプライン

人物・変異体・武器・小道具の 3D モデルと、壁や床などの PBR テクスチャを Blender（`bpy` モジュール）でスクリプト生成し、
`js/assets.js` に base64 で埋め込む。手で作った .blend ファイルは使っておらず、すべてこのディレクトリのコードから再現できる。

ゲーム本体は `js/assets.js` をそのまま読むので、遊ぶだけならこの手順は不要。モデルやテクスチャを作り直すときだけ使う。

## 準備

[uv](https://docs.astral.sh/uv/) で Python 3.13 の仮想環境を作り、Blender 5.2 の `bpy` と Pillow を入れる（bpy は数百 MB ある）。

```bash
cd games/deep-line-2039
uv venv --python 3.13 .venv
uv pip install --python .venv -r tools/requirements.txt
```

## 生成

```bash
# 1. モデル（glb）を書き出す。2 番目の引数で一部だけ作り直せる（例: human,weapons）
.venv/bin/python tools/build_models.py assets/build

# 2. テクスチャを Cycles で焼く（512px、数分かかる）。3 番目の引数で一部だけ焼き直せる（例: wood,marble）
.venv/bin/python tools/build_textures.py assets/build/tex 512

# 3. glb とテクスチャ（JPEG に変換）を js/assets.js にまとめる
.venv/bin/python tools/pack_assets.py assets/build assets/build/tex js/assets.js
```

`assets/build/` は中間生成物なので git には入れない（`.gitignore` 済み）。コミットするのは `js/assets.js` だけ。

スキンモディファイアが並列で面を作るため、人物と変異体の glb は実行のたびに頂点の並び順が変わる（形は同じ）。
そのため作り直すと、中身が同じでも `js/assets.js` に差分が出る。

## ファイル

| ファイル | 内容 |
| --- | --- |
| `blender_common.py` | プリミティブ生成、モディファイア（スキン・細分化・ディスプレイス）、結合、UV 展開、glb 書き出しのヘルパー |
| `build_models.py` | `human` `mukuro` `hagure` `weapons` `props` の 5 つの glb を作る |
| `build_textures.py` | シェーダーノードで描いた 25 種類の素材を、色・法線・粗さのマップに焼く |
| `pack_assets.py` | 生成物を `js/assets.js`（`window.DL_ASSETS`）に埋め込む |

## ゲーム側との約束

- **座標系**: Blender では Z が上で、キャラクターは +Y を向いて作る。glTF 書き出しで three.js の -Z 向きになる。
- **ピボット**: 関節は回転なしの Empty で、名前（`hips` `torso` `head` `shL` `elR` `knL` など）が `js/models.js` の手続き型アニメーションと同じ。
  ゲームはこの名前でノードを探して `rotation` を動かすので、名前を変えるときは `js/gfx.js` も直す。
- **オプション部品**: `opt_` で始まるノード（`opt_coat` `opt_mask` `opt_gun` など）は人物ごとに表示を切り替える。
- **マテリアル名 = 役割**: Blender のマテリアル名（`skin` `cloth` `metal` `wood` など）は `js/gfx.js` の `ROLE` 表のキーで、
  ゲーム側でテクスチャと色に置き換えられる。Blender 側の色は目安にすぎない。
- **テクスチャ**: すべてタイル可能。ノイズは UV をトーラス状の 4D 座標に写して評価しているので継ぎ目が出ない。
  名前は `<素材>_c`（色）・`_n`（法線）・`_r`（粗さ）。

`js/assets.js` が無い、または読み込みに失敗した場合、ゲームは従来のプリミティブのモデルと canvas のテクスチャで動く。
