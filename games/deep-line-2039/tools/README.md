# Blender アセットパイプライン

武器・小道具・壁や床のテクスチャ、人物、変異体の 3D モデルを Blender（`bpy` モジュール）でスクリプト生成し、
`js/assets*.js` に base64 で埋め込む。手で作った .blend ファイルは使っておらず、すべてこのディレクトリのコードから再現できる。

ゲーム本体は `js/assets*.js` をそのまま読むので、遊ぶだけならこの手順は不要。モデルやテクスチャを作り直すときだけ使う。

## 準備

[uv](https://docs.astral.sh/uv/) で Python 3.13 の仮想環境を作り、Blender 5.2 の `bpy` と Pillow を入れる（bpy は数百 MB ある）。
モデルの圧縮に [gltfpack](https://github.com/zeux/meshoptimizer)（npm）を使うので Node.js も要る。

```bash
cd games/deep-line-2039
uv venv --python 3.13 .venv
uv pip install --python .venv -r tools/requirements.txt
```

## 生成

```bash
PY=.venv/bin/python
# 1. 武器・小道具（と、人物モデルが無いとき用の簡易な人物）
$PY tools/build_models.py assets/build/models human,weapons,props
# 2. 壁・床・小物のタイル用テクスチャを Cycles で焼く（512px、数分）
$PY tools/build_textures.py assets/build/tex 512
# 3. 人物: MakeHuman の CC0 データを取得し、19 人分の服・顔・テクスチャを作る（1 人 1 分ほど）
$PY tools/fetch_makehuman.py assets/build/mpfb2
$PY tools/build_humans.py assets/build/mpfb2 assets/build/chars
# 4. 変異体（ムクロ・ヌシ・ハハ・ハグレ）
$PY tools/build_mutants.py assets/build/mutants
# 5. glb を gltfpack で圧縮し、テクスチャを JPEG にして JS へまとめる
$PY tools/pack_assets.py js/assets.js --models assets/build/models --tex assets/build/tex --gltfpack
$PY tools/pack_assets.py js/assets-chars.js --models assets/build/chars --tex assets/build/chars/tex --gltfpack
$PY tools/pack_assets.py js/assets-mutants.js --models assets/build/mutants --tex assets/build/mutants/tex --gltfpack
```

`build_humans.py` と `build_mutants.py` は 3 番目の引数（名前のカンマ区切り）で一部だけ作り直せる。
`pack_assets.py` は gltfpack を `npx gltfpack@1.3.0` で呼ぶ。環境変数 `GLTFPACK` に `cli.js` のパスを入れればそれを使う。

`assets/build/` は中間生成物なので git には入れない（`.gitignore` 済み）。コミットするのは `js/assets*.js` だけ。

スキンモディファイアやボクセルの作り直しは並列で面を作るため、実行のたびに頂点の並び順が変わる（形は同じ）。
そのため作り直すと、中身が同じでも `js/assets*.js` に差分が出る。

## ファイル

| ファイル | 内容 |
| --- | --- |
| `blender_common.py` | プリミティブ生成、モディファイア、結合、UV 展開、glb 書き出しのヘルパー |
| `build_models.py` | 武器（一人称）・小道具・簡易な人物の glb |
| `build_textures.py` | シェーダーノードで描いた 25 種類の素材を、色・法線・粗さのマップに焼く |
| `fetch_makehuman.py` | MakeHuman の人体データ（CC0）を PyPI の wheel から取り出す |
| `mh_body.py` | 体型ターゲットの適用、リグとウェイト、腕を下ろした基本姿勢への付け替え |
| `mh_dress.py` | 体の面から服・髪・ひげの「殻」を作る。ブーツの足先、マフラー、髪の房 |
| `mh_masks.py` | 顔まわり（眉・ひげ・頬）のマスクを UV 上に描く |
| `mh_paint.py` | 肌・布・革・髪・目のシェーダーと、Cycles での焼き込み |
| `mh_gear.py` | ヘルメット、帽子、ガスマスクの金具、背嚢、小銃、ギター、ランタンなど |
| `build_humans.py` | 登場人物 19 人の定義と組み立て |
| `build_mutants.py` | 変異体 4 種のデザインと組み立て |
| `pack_assets.py` | 生成物を `js/assets*.js`（`window.DL_ASSETS`）に埋め込む |

## 人物の作り方

1. MakeHuman の基本メッシュに、性別・年齢・筋肉・体重・身長と顔の細部のターゲットを足して体型を作る（アジア系の比率を高めに）。
2. ゲーム用リグ（game_engine、53 本）とそのウェイトを載せ、A ポーズから腕を体の横へ下ろした姿勢を基本姿勢にする。
3. 服は体の面を少し外へずらした殻として作る。殻は元の面の UV とウェイトを受け継ぐので、体の UV 配置と同じ 1 枚のテクスチャに
   肌も服も描ける。体の各面はいちばん外側の服（または素肌）がひとつだけ持ち、内側に隠れる面は捨てる。
4. 肌・布・革・髪の模様はオブジェクト空間のシェーダーで描き、色・法線・粗さ・AO を Cycles で 1024px のアトラスへ焼く。
5. 間引いて（顔は細かいまま）glb に書き出す。持ち物はマテリアル名の接頭辞（`gun_` など）でゲームが見分ける。

## 変異体の作り方

骨格の点と太さからスキンモディファイアで体を作り、ボクセルで均一なメッシュにしてから、肋骨・背骨の突起・骨の板・ひび割れなどを
解剖学的な位置から計算して彫り込む（約 10 万面）。それを約 1 万三角形に間引いて UV を展開し、ハイポリから法線・色・粗さ・AO を焼き付ける。
ボーンは自動ウェイトで載せ、歯・爪・目を足して書き出す。デザインの説明は `../SCENARIO.md` の「変異体」を参照。

## ゲーム側との約束

- **座標系**: Blender では Z が上で、キャラクターは +Y を向いて作る。glTF 書き出しで three.js の -Z 向きになる。
- **ボーン**: ゲームは読み込んだ直後にボーンの基本姿勢の回転を 0 にそろえ（`js/gfx.js` の `rebindSkeleton`）、
  旧来の手続き型アニメーションと同じ軸で回す。人物は `pelvis` `spine_01` `head` `upperarm_l` `lowerarm_l` `thigh_l` `calf_l` など、
  変異体は `body` `head` `jaw` `legFL` `kneeFL` … `legBR` `kneeBR` を動かす。
- **マテリアル名 = 役割**: 人物と変異体の体は `body` / `mskin`（焼いたアトラスを使う）。それ以外のマテリアル名（`metal` `wood` `helmet` など）は
  `js/gfx.js` の `ROLE` 表のキーで、タイル用テクスチャと色に置き換えられる。
- **テクスチャ**: 名前は `<素材>_c`（色）・`_n`（法線）・`_r`（粗さ）。人物は `ch_<名前>_*`、変異体は `mu_<名前>_*`。

`js/assets*.js` が無い、または読み込みに失敗した場合、ゲームは従来のプリミティブのモデルと canvas のテクスチャで動く。

## ライセンスと出典

- **MakeHuman / MPFB2 の人体データ**（基本メッシュ、体型ターゲット、リグ、ウェイト、顔まわりのマスク）: CC0 1.0。
  [MakeHuman](http://www.makehumancommunity.org/) コミュニティの成果物で、
  PyPI の [anny](https://pypi.org/project/anny/) 0.6.1（NAVER LABS Europe）の wheel に同梱されている `anny/data/mpfb2/` だけを使う。
  anny 自体のコード（Apache-2.0）は使っていない。
- **meshoptimizer / gltfpack**（MIT, Arseny Kapoulkine）: 生成時の圧縮と、ゲーム内の展開（`vendor/meshopt_decoder*.js`）。
- **three.js r128 の GLTFLoader と SkeletonUtils**（MIT）: `vendor/` に同梱。
- 服・装備・変異体・テクスチャはすべてこのディレクトリのスクリプトで作ったもの。
