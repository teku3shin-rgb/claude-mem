"""深層線の変異体（オリジナルのデザイン）を Blender で作る。

作り方（ハーフライフ 2 世代のゲームキャラクターと同じ考え方）:
  1. 骨格の点と太さからスキンモディファイアで大まかな体を作り、ボクセルで作り直して均一な細かいメッシュにする
  2. 肋骨・背骨の突起・筋・しわなどを、解剖学的な位置（背骨に沿った位置など）から計算して彫り込む（ハイポリ）
  3. 間引いたローポリに UV を展開し、ハイポリから法線・色・粗さ・AO を焼き付ける
  4. ボーンを組んで自動ウェイトで載せ、歯・爪・目を足して glb に書き出す

ボーン名はゲームの手続き型アニメーション（js/entities.js の Mutant.animate）が動かす関節に合わせてある:
  body（胴の中心） / head / jaw / legFL・kneeFL（前左）… / legBR・kneeBR（後右）

使い方: python tools/build_mutants.py <出力ディレクトリ> [名前,名前,...]
"""
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector, noise  # noqa: E402

import mh_paint as PT  # noqa: E402
from blender_common import apply_mods, assign, cone, join, material, reset_scene, smooth, uv_sphere  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else 'assets/build/mutants'
ONLY = sys.argv[2].split(',') if len(sys.argv) > 2 else None
TEX = 1024
LOW_FACES = 10000  # 三角形の数


# ------------------------------------------------------------ 骨格（点・辺・太さ）
class Frame:
    def __init__(self):
        self.p = {}
        self.r = {}
        self.edges = []

    def pt(self, name, pos, r, mirror=False):
        if mirror:
            x, y, z = pos
            self.pt(name + 'L', (-x, y, z), r)
            self.pt(name + 'R', (x, y, z), r)
            return
        self.p[name] = Vector(pos)
        self.r[name] = r if isinstance(r, tuple) else (r, r)

    def chain(self, *names, mirror=False):
        if mirror:
            self.chain(*[n + 'L' if not n.startswith('=') else n[1:] for n in names])
            self.chain(*[n + 'R' if not n.startswith('=') else n[1:] for n in names])
            return
        for a, b in zip(names, names[1:]):
            self.edges.append((a, b))


def skin_body(fr, subdiv=2, voxel=0.01, rscale=1.45):
    """rscale: 細分化で縮む分を見込んで太さを大きめにする。"""
    names = list(fr.p)
    idx = {n: i for i, n in enumerate(names)}
    me = bpy.data.meshes.new('skin')
    me.from_pydata([fr.p[n][:] for n in names], [(idx[a], idx[b]) for a, b in fr.edges], [])
    ob = bpy.data.objects.new('skin', me)
    bpy.context.scene.collection.objects.link(ob)
    ob.modifiers.new('skin', 'SKIN')
    sv = me.skin_vertices[0].data
    root = 'chest' if 'chest' in fr.p else names[0]
    for i, n in enumerate(names):
        sv[i].radius = (fr.r[n][0] * rscale, fr.r[n][1] * rscale)
        sv[i].use_root = n == root
    m = ob.modifiers.new('sub', 'SUBSURF')
    m.levels = subdiv
    apply_mods(ob)
    rm = ob.modifiers.new('rm', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = voxel
    rm.adaptivity = 0
    apply_mods(ob)
    sm = ob.modifiers.new('sm', 'SMOOTH')
    sm.factor = 0.7
    sm.iterations = 16
    apply_mods(ob)
    return ob


def seg_dist(p, a, b):
    """点 p（N,3）と線分 ab の距離と、線分上の位置 t。"""
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
    q = a + t[:, None] * ab
    return np.linalg.norm(p - q, axis=1), t


def sculpt(ob, fn):
    """頂点ごとの押し出し量（法線方向, m）を計算して形に彫り込む。"""
    me = ob.data
    n = len(me.vertices)
    P = np.empty(n * 3)
    N = np.empty(n * 3)
    me.vertices.foreach_get('co', P)
    me.vertices.foreach_get('normal', N)
    P = P.reshape(-1, 3)
    N = N.reshape(-1, 3)
    d = fn(P, N)
    me.vertices.foreach_set('co', (P + N * d[:, None]).ravel())
    me.update()


def nz(P, scale, seed=0.0, octaves=3):
    """mathutils のノイズを配列に（-1..1 くらい）。"""
    out = np.empty(len(P))
    for i, p in enumerate(P):
        out[i] = noise.fractal(Vector((p[0] * scale + seed, p[1] * scale, p[2] * scale)), 0.5, 2.0, octaves)
    return out


def vor(P, scale, seed=0.0):
    """ボロノイの境界（ひび割れ・鱗用）。境界で 0、内側ほど大きい。"""
    out = np.empty(len(P))
    for i, p in enumerate(P):
        d, _ = noise.voronoi(Vector((p[0] * scale + seed, p[1] * scale, p[2] * scale)), distance_metric='DISTANCE')
        out[i] = d[1] - d[0]
    return out


# ------------------------------------------------------------ ローポリ化・UV・焼き込み
def make_low(high, faces=LOW_FACES):
    low = high.copy()
    low.data = high.data.copy()
    low.name = 'low'
    bpy.context.scene.collection.objects.link(low)
    d = low.modifiers.new('dec', 'DECIMATE')
    d.ratio = min(1.0, faces / max(1, 2 * len(high.data.polygons)))
    apply_mods(low)
    for p in low.data.polygons:
        p.use_smooth = True
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    return low


def bake_maps(name, high, low, mat):
    high.data.materials.clear()
    high.data.materials.append(mat)
    tgt = material('bake_' + name)
    low.data.materials.clear()
    low.data.materials.append(tgt)
    tgt.use_nodes = True
    PT.add_target(tgt, None)
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    rb = scn.render.bake
    rb.use_selected_to_active = True
    rb.cage_extrusion = 0.02
    rb.max_ray_distance = 0.05
    rb.margin = 0
    rb.use_clear = False
    out = {}
    for key, kind, samples, data in (('c', 'DIFFUSE', 1, False), ('n', 'NORMAL', 1, True), ('r', 'ROUGHNESS', 1, True), ('ao', 'AO', 32, True)):
        im = bpy.data.images.new(f'{name}_{key}', TEX, TEX, alpha=True, float_buffer=True, is_data=data)
        im.pixels.foreach_set(np.zeros(TEX * TEX * 4, dtype=np.float32))
        tgt.node_tree.nodes['bake_target'].image = im
        tgt.node_tree.nodes.active = tgt.node_tree.nodes['bake_target']
        scn.cycles.samples = samples
        for ob in scn.objects:
            ob.select_set(False)
        high.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        if kind == 'DIFFUSE':
            bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_selected_to_active=True, cage_extrusion=0.02,
                                max_ray_distance=0.05, margin=0, use_clear=False)
        elif kind == 'NORMAL':
            bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_selected_to_active=True, cage_extrusion=0.02,
                                max_ray_distance=0.05, margin=0, use_clear=False)
        else:
            bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=0.02, max_ray_distance=0.05, margin=0, use_clear=False)
        out[key] = PT.dilate(PT.image_array(im), 16)
    texdir = os.path.join(OUT, 'tex')
    color = out['c'][..., :3] * (0.3 + 0.7 * out['ao'][..., :1])
    PT.save_png(color, os.path.join(texdir, f'mu_{name}_c.png'), srgb_out=True)
    PT.save_png(out['n'], os.path.join(texdir, f'mu_{name}_n.png'))
    PT.save_png(np.repeat(out['r'][..., :1], 3, axis=2), os.path.join(texdir, f'mu_{name}_r.png'))


# ------------------------------------------------------------ 皮膚の材質（焼き込み用）
def creature_mat(name, o):
    """o: base, dark（背中側）, belly, vein, mottle, ash, wet, mouth_z, head_y"""
    m = bpy.data.materials.new(name)
    g = PT.NB(m)
    P = g.co()
    x, y, z = g.sep(P)
    base, dark, belly = o['base'], o['dark'], o.get('belly', o['base'])
    col = PT.col
    # 背中ほど暗く、腹ほど明るい（法線の上向き成分で）
    geo = g.node('ShaderNodeNewGeometry')
    nzc = g.sep(geo.outputs['Normal'])[2]
    c = g.mix(g.maprange(nzc, -0.6, 0.7), col(belly), col(base))
    c = g.mix(g.maprange(nzc, 0.3, 0.95, 0.0, 0.75), c, col(dark))
    mot = g.noise(P, o.get('mottle', 9.0), 4.0, 0.6)
    c = g.mix(g.maprange(mot, 0.35, 0.75, 0.0, 0.5), c, col(PT.shade(base, 0.6)))
    blot = g.noise(P, 3.5, 3.0, 0.55, 0.0, 1.7)
    c = g.mix(g.maprange(blot, 0.55, 0.75, 0.0, 0.4), c, col(o.get('blot', PT.shade(dark, 0.8))))
    # 血管（ノイズの等高線）
    v = g.noise(P, o.get('vein_scale', 14.0), 2.0, 0.5, 0.8)
    vein = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', v, 0.5)), 0.0, 0.015, 1.0, 0.0)
    vein = g.math('MULTIPLY', vein, g.maprange(g.noise(P, 4.0, 2.0, 0.5, 0.0, 9.1), 0.4, 0.6))
    c = g.mix(g.math('MULTIPLY', vein, o.get('vein_amt', 0.6)), c, col(o['vein']))
    # 細かいしみ
    sp = g.noise(P, 160.0, 1.0, 0.5)
    c = g.mix(g.maprange(sp, 0.6, 0.75, 0.0, 0.3), c, col(PT.shade(base, 0.5)))
    # 口の中（頭の前の、口の高さの内側の面）
    if 'mouth_z' in o:
        mz = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', z, o['mouth_z'])), o.get('mouth_h', 0.025), o.get('mouth_h', 0.025) * 0.4)
        my = g.maprange(y, o['head_y'], o['head_y'] + 0.04)
        inner = g.maprange(g.math('ABSOLUTE', nzc), 0.4, 0.8)
        mm = g.math('MULTIPLY', g.math('MULTIPLY', mz, my), inner)
        c = g.mix(mm, c, col((0.18, 0.03, 0.03)))
    # 灰をかぶった上面
    if o.get('ash', 0):
        ash = g.math('MULTIPLY', g.maprange(nzc, 0.5, 0.95), g.maprange(g.noise(P, 6.0, 4.0, 0.6), 0.45, 0.7))
        c = g.mix(g.math('MULTIPLY', ash, o['ash']), c, col((0.42, 0.4, 0.37)))
    # 骨の板（ヌシ）: 背中のボロノイの島を骨の色に
    if 'plates' in o:
        cell = g.voronoi(P, o['plate_scale'], 'DISTANCE_TO_EDGE')
        pl = g.math('MULTIPLY', g.maprange(cell, 0.02, 0.08), g.maprange(nzc, 0.2, 0.75))
        c = g.mix(pl, c, g.mix(g.maprange(g.noise(P, 25.0, 3.0, 0.6), 0.3, 0.7), col(o['plates']), col(PT.shade(o['plates'], 0.6))))
    # まばらな毛（ハグレ）
    if 'fur' in o:
        fm = g.maprange(g.noise(P, 4.0, 3.0, 0.6, 0.0, 3.3), 0.5, 0.62)
        strand = g.noise(g.vmath('MULTIPLY', P, (1.0, 3.0, 1.0)), 300.0, 2.0, 0.6)
        c = g.mix(g.math('MULTIPLY', fm, g.maprange(strand, 0.3, 0.6)), c, col(o['fur']))
    if 'crack' in o:
        cr = g.voronoi(P, o['crack'], 'DISTANCE_TO_EDGE')
        c = g.mix(g.maprange(cr, 0.0, 0.03, 0.6, 0.0), c, col((0.05, 0.035, 0.03)))
    # 育児嚢（ハハ）: 半透明っぽく赤みと血管を強く
    if 'sac' in o:
        sd = g.vmath('DISTANCE', P, o['sac'])
        sm = g.maprange(sd, 0.16, 0.08)
        c = g.mix(g.math('MULTIPLY', sm, 0.7), c, col((0.55, 0.32, 0.3)))
        c = g.mix(g.math('MULTIPLY', sm, vein), c, col((0.35, 0.06, 0.12)))
    # 足先・爪のまわりは汚れて暗い
    c = g.mix(g.maprange(z, 0.12, 0.02, 0.0, 0.6), c, col((0.08, 0.06, 0.05)))
    rough = g.math('ADD', o.get('rough', 0.55), g.math('MULTIPLY', mot, 0.25))
    if 'mouth_z' in o:
        rough = g.math('SUBTRACT', rough, g.math('MULTIPLY', mm, 0.4))
    h = g.math('MULTIPLY', g.noise(P, 220.0, 2.0, 0.6), 0.4)
    h = g.math('ADD', h, g.math('MULTIPLY', vein, 0.6))
    g.bsdf(c, rough, h, 0.25, 0.002)
    return m


# ------------------------------------------------------------ 歯・爪・目
def teeth_side(bvh, sx, y0, y1, z, n, size, down=True, name='teeth'):
    """唇のない口: 鼻づらの横（口の線の高さ）に外から光線を当てて歯を並べる。"""
    parts = []
    for i in range(n):
        y = y0 + (y1 - y0) * (i + 0.5) / n
        p = on_surface(bvh, Vector((sx * 0.25, y, z)), (-sx, 0, 0), 0.002, 0.3)
        s = size * (1.15 if i % 3 == 0 else 0.85)
        c = cone(name, s * 0.35, s, (p.x, p.y, p.z - (s / 2 if down else -s / 2)), (math.pi if down else 0, 0, 0), 6)
        parts.append(c)
    t = join(parts, name)
    assign(t, material('teeth'))
    return t


def teeth_row(a, b, n, size, down=True, jitter=0.25, name='teeth', bvh=None):
    """a→b に沿って歯を並べる。bvh があれば口の中から顎の面へ光線を飛ばして歯ぐきの位置を決める。"""
    parts = []
    for i in range(n):
        t = (i + 0.5) / n
        p = a.lerp(b, t)
        if bvh is not None:
            p = on_surface(bvh, p, (0, 0, 1) if down else (0, 0, -1), -0.002)
        s = size * (1 - jitter + jitter * 2 * ((i * 7919) % 13) / 13) * (1.2 if i % 3 == 0 else 0.85)
        c = cone(name, s * 0.35, s, (p.x, p.y, p.z - (s / 2 if down else -s / 2)), (math.pi if down else 0, 0, 0), 6)
        parts.append(c)
    t = join(parts, name)
    assign(t, material('teeth'))
    return t


def claws(tip, fwd, n=3, size=0.05, spread=0.03, name='claws'):
    parts = []
    for i in range(n):
        off = (i - (n - 1) / 2) * spread
        p = tip + Vector((off, 0, 0))
        c = cone(name, size * 0.22, size, (0, 0, 0), (0, 0, 0), 6)
        # 前へ曲げながら下へ
        c.data.transform(Matrix.Rotation(-math.pi / 2 + 0.5, 4, 'X'))
        c.data.transform(Matrix.Translation(p + fwd * size * 0.3))
        parts.append(c)
    cl = join(parts, name)
    assign(cl, material('claw'))
    return cl


def on_surface(bvh, p, direction, back=0.0, dist=0.2):
    """p から direction へ光線を飛ばして最初に当たった表面の点（なければ p）。back だけ表面の内側へ戻す。"""
    d = Vector(direction).normalized()
    hit, nrm, _, _ = bvh.ray_cast(Vector(p), d, dist)
    if hit is None:
        # 当たらなければ、光線の届く先にいちばん近い表面
        hit, nrm, _, _ = bvh.find_nearest(Vector(p) + d * dist * 0.5)
    return hit - nrm * back


def eye(name, pos, r):
    e = uv_sphere(name, r, pos, (1, 1, 1), 10, 6)
    assign(e, material('eye'))
    return e


# ------------------------------------------------------------ リグ
def armature(bones):
    """bones: [(名前, 根元, 先, 親名 or None)]"""
    arm = bpy.data.armatures.new('rig')
    ob = bpy.data.objects.new('rig', arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n, h, t, par in bones:
        e = arm.edit_bones.new(n)
        e.head = Vector(h)
        e.tail = Vector(t)
        eb[n] = e
    for n, h, t, par in bones:
        if par:
            eb[n].parent = eb[par]
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def auto_weights(mesh, arm):
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')


def rigid(ob, arm, bone):
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
    ob.parent = arm
    m = ob.modifiers.new('Armature', 'ARMATURE')
    m.object = arm


def export(name, arm, objs):
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    arm.select_set(True)
    for ob in objs:
        ob.select_set(True)
    path = os.path.abspath(os.path.join(OUT, f'{name}.glb'))
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_skins=True, export_animations=False, export_materials='EXPORT', export_attributes=False,
                              export_cameras=False, export_lights=False)
    print(f'[{name}] glb {os.path.getsize(path)} bytes, faces {sum(len(o.data.polygons) for o in objs)}')



def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def bump(P, c, r):
    """点 c のまわり半径 r の丸いふくらみ（0..1）。"""
    d = np.linalg.norm(P - np.array(c), axis=1)
    return smoothstep(r, 0, d)


# ------------------------------------------------------------ 共通の体の部品
def limb_front(fr, root, sx_pts, prefix='F'):
    """前脚（長く、こぶしで歩く）。sx_pts: 各関節の (x, y, z, 半径)。指を 3 本。"""
    names = ['clv', 'sh', 'bic', 'el', 'frm', 'wr', 'palm']
    for n, (x, y, z, r) in zip(names, sx_pts):
        fr.pt(prefix + n, (x, y, z), r, mirror=True)
    fr.chain('=' + root, *[prefix + n for n in names], mirror=True)
    px, py, pz, _ = sx_pts[-1]
    for i, off in enumerate((-0.026, 0.0, 0.026)):
        fr.pt(f'{prefix}f{i}a', (px + off, py + 0.05, 0.03), 0.015, mirror=True)
        fr.pt(f'{prefix}f{i}b', (px + off * 1.2, py + 0.095, 0.014), 0.011, mirror=True)
        fr.chain(prefix + 'palm', f'{prefix}f{i}a', f'{prefix}f{i}b', mirror=True)


def limb_hind(fr, root, pts, prefix='B'):
    names = ['hp', 'thg', 'kn', 'shn', 'hk', 'met']
    for n, (x, y, z, r) in zip(names, pts):
        fr.pt(prefix + n, (x, y, z), r, mirror=True)
    fr.chain('=' + root, *[prefix + n for n in names], mirror=True)
    mx, my, mz, _ = pts[-1]
    for i, off in enumerate((-0.02, 0.0, 0.02)):
        fr.pt(f'{prefix}t{i}a', (mx + off, my + 0.045, 0.022), 0.012, mirror=True)
        fr.pt(f'{prefix}t{i}b', (mx + off * 1.3, my + 0.08, 0.01), 0.008, mirror=True)
        fr.chain(prefix + 'met', f'{prefix}t{i}a', f'{prefix}t{i}b', mirror=True)


def leg_bones(bones, front, hind, chest='chest', hips='hips'):
    """ゲームが動かす脚のボーン（legF?/kneeF?/pawF? と legB?/kneeB?/pawB?）。front/hind は関節の座標（右側, x>0）。"""
    for s, sx in (('L', -1), ('R', 1)):
        def m(p):
            return (p[0] * sx, p[1], p[2])
        sh, el, wr, tip = front
        hp, kn, hk, ft = hind
        bones += [
            (f'legF{s}', m(sh), m(el), chest), (f'kneeF{s}', m(el), m(wr), f'legF{s}'), (f'pawF{s}', m(wr), m(tip), f'kneeF{s}'),
            (f'legB{s}', m(hp), m(kn), hips), (f'kneeB{s}', m(kn), m(hk), f'legB{s}'), (f'pawB{s}', m(hk), m(ft), f'kneeB{s}'),
        ]


def ribs_spine(P, N, y0, y1, zc, top_z, amp=1.0, spacing=0.045):
    """やせた体の肋骨と背骨の突起。"""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    d = np.zeros(len(P))
    torso = smoothstep(y0, y0 + 0.15, y) * smoothstep(y1, y1 - 0.15, y)
    flank = smoothstep(0.02, 0.12, np.abs(x)) * smoothstep(zc - 0.2, zc - 0.05, z) * smoothstep(top_z + 0.02, top_z - 0.12, z)
    u = y - 0.5 * (z - zc)
    rib = np.cos(u * np.pi / spacing) ** 16
    d += (rib - 0.3) * 0.006 * torso * flank * amp
    topm = smoothstep(0.03, 0.0, np.abs(x)) * smoothstep(0.4, 0.85, N[:, 2])
    spine = np.cos(y * np.pi / 0.042) ** 10
    d += spine * topm * 0.014 * amp
    return d


# ------------------------------------------------------------ ムクロ
def mukuro():
    """トンネルに棲む群れの変異体。やせた背の曲がった体、こぶしで這う長い前脚、額に四つの小さな目。"""
    fr = Frame()
    spine = [('tail2', (0, -1.0, 0.36), 0.01), ('tail1', (0, -0.74, 0.54), 0.03), ('sacrum', (0, -0.52, 0.65), (0.085, 0.075)),
             ('hips', (0, -0.38, 0.67), (0.115, 0.095)), ('waist', (0, -0.17, 0.69), (0.07, 0.085)), ('ribs', (0, 0.0, 0.74), (0.115, 0.12)),
             ('chest', (0, 0.19, 0.80), (0.145, 0.145)), ('shoulders', (0, 0.33, 0.86), (0.12, 0.10)), ('neck1', (0, 0.45, 0.87), 0.052),
             ('neck2', (0, 0.55, 0.87), 0.046), ('skull', (0, 0.65, 0.89), (0.064, 0.072)), ('brow', (0, 0.73, 0.885), (0.055, 0.05)),
             ('snout', (0, 0.84, 0.84), (0.03, 0.026))]
    for n, p, r in spine:
        fr.pt(n, p, r)
    fr.chain(*[n for n, _, _ in spine])
    fr.pt('chin', (0, 0.63, 0.79), (0.05, 0.03))
    fr.pt('jawtip', (0, 0.8, 0.765), (0.028, 0.016))
    fr.chain('neck2', 'chin', 'jawtip')
    fr.pt('cheek', (0.05, 0.69, 0.84), 0.022, mirror=True)
    fr.chain('=skull', 'cheek', mirror=True)
    front = [(0.08, 0.32, 0.83, 0.055), (0.16, 0.31, 0.77, 0.07), (0.2, 0.32, 0.62, 0.058), (0.22, 0.29, 0.46, 0.04),
             (0.22, 0.36, 0.3, 0.047), (0.21, 0.45, 0.12, 0.028), (0.21, 0.5, 0.045, (0.042, 0.018))]
    limb_front(fr, 'shoulders', front)
    hind = [(0.12, -0.38, 0.62, 0.078), (0.15, -0.28, 0.5, 0.072), (0.17, -0.17, 0.37, 0.042), (0.16, -0.29, 0.27, 0.04),
            (0.15, -0.44, 0.14, 0.027), (0.15, -0.38, 0.045, (0.032, 0.018))]
    limb_hind(fr, 'hips', hind)
    high = skin_body(fr, 2, 0.006)
    eyes_at = [(-0.02, 0.75, 0.9), (0.02, 0.75, 0.9), (-0.042, 0.725, 0.895), (0.042, 0.725, 0.895)]

    def details(P, N):
        d = ribs_spine(P, N, -0.12, 0.3, 0.76, 0.84)
        for sx in (-1, 1):
            d += bump(P, (sx * 0.09, 0.24, 0.9), 0.07) * 0.016   # 肩甲骨
            d += bump(P, (sx * 0.1, -0.4, 0.74), 0.05) * 0.012   # 腰骨
            d += bump(P, (sx * 0.22, 0.27, 0.46), 0.03) * 0.012  # 肘の骨
            d += bump(P, (sx * 0.17, -0.15, 0.37), 0.03) * 0.01  # 膝
        for e in eyes_at:
            d -= bump(P, e, 0.014) * 0.006
        d += bump(P, (0, 0.735, 0.92), 0.05) * 0.008
        # 頭頂の稜線と頬骨
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        d += smoothstep(0.02, 0.0, np.abs(x)) * smoothstep(0.58, 0.64, y) * smoothstep(0.8, 0.72, y) * smoothstep(0.86, 0.9, z) * 0.01
        for sx in (-1, 1):
            d += bump(P, (sx * 0.06, 0.7, 0.85), 0.03) * 0.008
            d += bump(P, (sx * 0.2, 0.32, 0.62), 0.07) * 0.012   # 上腕
            d += bump(P, (sx * 0.22, 0.36, 0.32), 0.06) * 0.008  # 前腕
            d += bump(P, (sx * 0.15, -0.3, 0.5), 0.08) * 0.014   # もも
        d += nz(P, 8.0, 1.3, 3) * 0.004
        d += nz(P, 40.0, 4.1, 2) * 0.0012
        return d

    sculpt(high, details)
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromObject(high, bpy.context.evaluated_depsgraph_get())
    eyes_at = [on_surface(bvh, Vector((e[0], e[1], e[2] + 0.1)), (0, 0, -1), 0.003) for e in eyes_at]
    mat = creature_mat('mukuro', dict(base=(0.25, 0.225, 0.215), dark=(0.075, 0.07, 0.07), belly=(0.36, 0.31, 0.29), vein=(0.16, 0.05, 0.1),
                                      vein_amt=0.85, blot=(0.2, 0.12, 0.14), ash=0.3, mouth_z=0.81, mouth_h=0.02, head_y=0.6))
    bones = [
        ('body', (0, -0.16, 0.7), (0, 0.16, 0.78), None),
        ('chest', (0, 0.16, 0.78), (0, 0.42, 0.86), 'body'),
        ('neck', (0, 0.42, 0.86), (0, 0.58, 0.86), 'chest'),
        ('head', (0, 0.58, 0.86), (0, 0.88, 0.82), 'neck'),
        ('jaw', (0, 0.58, 0.8), (0, 0.84, 0.75), 'head'),
        ('hips', (0, -0.16, 0.7), (0, -0.5, 0.65), 'body'),
        ('tail1', (0, -0.52, 0.64), (0, -0.78, 0.5), 'hips'),
        ('tail2', (0, -0.78, 0.5), (0, -1.0, 0.36), 'tail1'),
    ]
    leg_bones(bones, [(0.16, 0.31, 0.77), (0.22, 0.29, 0.46), (0.21, 0.45, 0.12), (0.21, 0.58, 0.02)],
              [(0.12, -0.38, 0.62), (0.17, -0.17, 0.37), (0.15, -0.44, 0.14), (0.15, -0.3, 0.01)])
    extras = []
    for sx in (-1, 1):
        extras.append(('head', teeth_row(Vector((sx * 0.04, 0.66, 0.815)), Vector((sx * 0.012, 0.84, 0.81)), 9, 0.018, True, bvh=bvh)))
        extras.append(('jaw', teeth_row(Vector((sx * 0.036, 0.66, 0.815)), Vector((sx * 0.01, 0.8, 0.81)), 8, 0.015, False, bvh=bvh)))
    for s, sx in (('L', -1), ('R', 1)):
        for off in (-0.026, 0.0, 0.026):
            extras.append((f'pawF{s}', claws(Vector((sx * 0.21 + off * 1.2, 0.6, 0.012)), Vector((0, 1, 0)), 1, 0.04, 0)))
        for off in (-0.02, 0.0, 0.02):
            extras.append((f'pawB{s}', claws(Vector((sx * 0.15 + off * 1.3, -0.29, 0.008)), Vector((0, 1, 0)), 1, 0.03, 0)))
    ey = join([eye('e', Vector(e), 0.0075) for e in eyes_at], 'eyes')
    extras.append(('head', ey))
    return high, mat, bones, extras


def spikes_along(points, size, mat='claw', lean=(0, -0.4)):
    parts = []
    for p, k in points:
        c = cone('spike', size * k * 0.32, size * k, (0, 0, 0), (0, 0, 0), 8)
        c.data.transform(Matrix.Rotation(lean[1], 4, 'X'))
        c.data.transform(Matrix.Translation(Vector(p) + Vector((0, 0, size * k * 0.35))))
        parts.append(c)
    sp = join(parts, 'spikes')
    assign(sp, material(mat))
    return sp


def plate_mat_mix(o):
    return o


# ------------------------------------------------------------ ヌシ
def nushi():
    """ムクロの巣の大型個体。頭蓋が平たい骨の盾になっていて、それで突進する。背中は骨の板で覆われる。"""
    fr = Frame()
    spine = [('tail2', (0, -0.92, 0.36), 0.015), ('tail1', (0, -0.68, 0.5), 0.045), ('hips', (0, -0.42, 0.6), (0.12, 0.11)),
             ('waist', (0, -0.2, 0.66), (0.12, 0.12)), ('ribs', (0, 0.0, 0.74), (0.17, 0.16)), ('chest', (0, 0.2, 0.8), (0.2, 0.18)),
             ('shoulders', (0, 0.34, 0.83), (0.17, 0.13)), ('neck1', (0, 0.48, 0.78), (0.09, 0.085)), ('skull', (0, 0.6, 0.75), (0.085, 0.075)),
             ('shield', (0, 0.68, 0.76), (0.13, 0.05)), ('snout', (0, 0.78, 0.69), (0.05, 0.04))]
    for n, p, r in spine:
        fr.pt(n, p, r)
    fr.chain(*[n for n, _, _ in spine])
    fr.pt('chin', (0, 0.6, 0.64), (0.065, 0.04))
    fr.pt('jawtip', (0, 0.76, 0.62), (0.04, 0.022))
    fr.chain('neck1', 'chin', 'jawtip')
    front = [(0.1, 0.32, 0.86, 0.08), (0.2, 0.32, 0.78, 0.1), (0.25, 0.33, 0.6, 0.085), (0.26, 0.3, 0.44, 0.06),
             (0.26, 0.36, 0.28, 0.075), (0.25, 0.44, 0.12, 0.045), (0.25, 0.49, 0.045, (0.06, 0.022))]
    limb_front(fr, 'shoulders', front)
    hind = [(0.12, -0.4, 0.56, 0.085), (0.15, -0.3, 0.44, 0.08), (0.16, -0.2, 0.32, 0.05), (0.15, -0.3, 0.22, 0.05),
            (0.15, -0.42, 0.12, 0.035), (0.15, -0.37, 0.045, (0.04, 0.02))]
    limb_hind(fr, 'hips', hind)
    high = skin_body(fr, 2, 0.007)
    eyes_at = [(-0.07, 0.7, 0.72), (0.07, 0.7, 0.72)]

    def details(P, N):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        d = ribs_spine(P, N, -0.15, 0.3, 0.72, 0.86, amp=0.3)
        # 背中の骨の板（ボロノイの島を盛り上げる）
        dors = smoothstep(0.2, 0.75, N[:, 2]) * smoothstep(-0.6, -0.45, y) * smoothstep(0.62, 0.5, y)
        cell = vor(P, 14.0, 2.3)
        d += dors * smoothstep(0.02, 0.1, cell) * 0.014
        # 盾（額の骨）: 前面を平らに硬く
        shield = bump(P, (0, 0.7, 0.78), 0.14) * smoothstep(-0.2, 0.5, N[:, 1] + N[:, 2])
        d += shield * (0.012 * smoothstep(0.01, 0.06, vor(P, 22.0, 1.1)) + 0.006)
        for sx in (-1, 1):
            d += bump(P, (sx * 0.12, 0.24, 0.92), 0.09) * 0.02    # 肩の筋肉
            d += bump(P, (sx * 0.25, 0.33, 0.62), 0.08) * 0.018   # 上腕
            d += bump(P, (sx * 0.26, 0.36, 0.3), 0.07) * 0.014    # 前腕
            d += bump(P, (sx * 0.15, -0.32, 0.46), 0.08) * 0.014  # もも
        d += nz(P, 7.0, 3.3, 3) * 0.005
        d += nz(P, 36.0, 9.1, 2) * 0.0015
        return d

    sculpt(high, details)
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromObject(high, bpy.context.evaluated_depsgraph_get())
    eyes_at = [on_surface(bvh, Vector((e[0] * 2.5, e[1], e[2])), (-np.sign(e[0]), 0, 0), 0.004) for e in eyes_at]
    mat = creature_mat('nushi', dict(base=(0.2, 0.17, 0.15), dark=(0.06, 0.05, 0.045), belly=(0.3, 0.25, 0.22), vein=(0.18, 0.05, 0.06),
                                     vein_amt=0.6, blot=(0.28, 0.22, 0.16), ash=0.25, mouth_z=0.645, mouth_h=0.022, head_y=0.56,
                                     plates=(0.4, 0.36, 0.3), plate_scale=14.0, plate_seed=2.3, rough=0.6))
    bones = [
        ('body', (0, -0.18, 0.67), (0, 0.16, 0.78), None),
        ('chest', (0, 0.16, 0.78), (0, 0.42, 0.82), 'body'),
        ('neck', (0, 0.42, 0.8), (0, 0.56, 0.75), 'chest'),
        ('head', (0, 0.56, 0.75), (0, 0.8, 0.7), 'neck'),
        ('jaw', (0, 0.56, 0.67), (0, 0.78, 0.61), 'head'),
        ('hips', (0, -0.18, 0.67), (0, -0.48, 0.58), 'body'),
        ('tail1', (0, -0.48, 0.58), (0, -0.72, 0.48), 'hips'),
        ('tail2', (0, -0.72, 0.48), (0, -0.92, 0.36), 'tail1'),
    ]
    leg_bones(bones, [(0.2, 0.32, 0.78), (0.26, 0.3, 0.44), (0.25, 0.44, 0.12), (0.25, 0.56, 0.02)],
              [(0.12, -0.4, 0.56), (0.16, -0.2, 0.32), (0.15, -0.42, 0.12), (0.15, -0.3, 0.01)])
    extras = []
    for sx in (-1, 1):
        extras.append(('head', teeth_row(Vector((sx * 0.05, 0.6, 0.66)), Vector((sx * 0.018, 0.8, 0.66)), 8, 0.026, True, bvh=bvh)))
        extras.append(('jaw', teeth_row(Vector((sx * 0.046, 0.6, 0.66)), Vector((sx * 0.015, 0.76, 0.655)), 7, 0.022, False, bvh=bvh)))
    for s_, sx in (('L', -1), ('R', 1)):
        for off in (-0.026, 0.0, 0.026):
            extras.append((f'pawF{s_}', claws(Vector((sx * 0.25 + off * 1.2, 0.59, 0.012)), Vector((0, 1, 0)), 1, 0.055, 0)))
            extras.append((f'pawB{s_}', claws(Vector((sx * 0.15 + off * 1.3, -0.28, 0.008)), Vector((0, 1, 0)), 1, 0.04, 0)))
    pts = []
    for i, (yy, zz, k) in enumerate([(0.3, 0.92, 1.0), (0.18, 0.92, 1.1), (0.05, 0.88, 1.0), (-0.08, 0.83, 0.9), (-0.22, 0.78, 0.8), (-0.36, 0.72, 0.7)]):
        p = on_surface(bvh, Vector((0, yy, zz + 0.2)), (0, 0, -1), -0.002)
        pts.append((p, k))
    extras.append(('chest', spikes_along(pts[:3], 0.09)))
    extras.append(('hips', spikes_along(pts[3:], 0.09)))
    ey = join([eye('e', Vector(e), 0.01) for e in eyes_at], 'eyes')
    extras.append(('head', ey))
    return high, mat, bones, extras


# ------------------------------------------------------------ ハハ
def haha():
    """崩れた店に棲む母獣。長い首と脚、子を宿してふくらんだ腹、背中の半透明の育児嚢。目は淡い青。"""
    fr = Frame()
    spine = [('tail2', (0, -0.9, 0.5), 0.01), ('tail1', (0, -0.62, 0.62), 0.035), ('hips', (0, -0.38, 0.72), (0.1, 0.095)),
             ('waist', (0, -0.15, 0.74), (0.11, 0.11)), ('mid', (0, 0.03, 0.76), (0.12, 0.12)), ('chest', (0, 0.2, 0.8), (0.13, 0.13)),
             ('shoulders', (0, 0.3, 0.88), (0.11, 0.1)), ('neck1', (0, 0.4, 0.98), 0.055), ('neck2', (0, 0.5, 1.06), 0.045),
             ('skull', (0, 0.6, 1.08), (0.06, 0.06)), ('snout', (0, 0.74, 1.04), (0.03, 0.028))]
    for n, p, r in spine:
        fr.pt(n, p, r)
    fr.chain(*[n for n, _, _ in spine])
    fr.pt('chin', (0, 0.58, 1.02), (0.04, 0.025))
    fr.pt('jawtip', (0, 0.71, 1.0), (0.022, 0.013))
    fr.chain('neck2', 'chin', 'jawtip')
    # たれ下がった腹と、背中の育児嚢
    fr.pt('belly', (0, -0.04, 0.6), (0.13, 0.12))
    fr.chain('mid', 'belly')
    fr.pt('sac', (0, -0.08, 0.9), (0.1, 0.085))
    fr.chain('waist', 'sac')
    front = [(0.07, 0.28, 0.86, 0.045), (0.13, 0.27, 0.8, 0.058), (0.16, 0.29, 0.62, 0.048), (0.17, 0.27, 0.46, 0.034),
             (0.17, 0.31, 0.3, 0.036), (0.16, 0.36, 0.12, 0.024), (0.16, 0.4, 0.04, (0.034, 0.016))]
    limb_front(fr, 'shoulders', front)
    hind = [(0.11, -0.38, 0.68, 0.07), (0.14, -0.28, 0.56, 0.064), (0.16, -0.18, 0.42, 0.036), (0.15, -0.3, 0.3, 0.034),
            (0.14, -0.44, 0.14, 0.024), (0.14, -0.39, 0.04, (0.028, 0.016))]
    limb_hind(fr, 'hips', hind)
    high = skin_body(fr, 2, 0.006)
    eyes_at = [(-0.035, 0.66, 1.1), (0.035, 0.66, 1.1)]

    def details(P, N):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        d = ribs_spine(P, N, 0.05, 0.32, 0.8, 0.9, amp=0.6)
        # 腹の張り（伸びた皮のすじ）
        bel = bump(P, (0, -0.04, 0.52), 0.22)
        d += bel * np.sin(np.arctan2(x, z - 0.66) * 18) * 0.002
        # 育児嚢のこぶ
        sac = bump(P, (0, -0.08, 0.98), 0.16)
        d += sac * (0.012 * smoothstep(0.05, 0.15, vor(P, 22.0, 5.5)))
        d += nz(P, 8.0, 6.3, 3) * 0.004
        d += nz(P, 42.0, 2.1, 2) * 0.0012
        return d

    sculpt(high, details)
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromObject(high, bpy.context.evaluated_depsgraph_get())
    eyes_at = [on_surface(bvh, Vector((e[0], e[1], e[2] + 0.1)), (0, 0, -1), 0.003) for e in eyes_at]
    mat = creature_mat('haha', dict(base=(0.34, 0.3, 0.29), dark=(0.12, 0.1, 0.1), belly=(0.48, 0.38, 0.36), vein=(0.3, 0.1, 0.2),
                                    vein_amt=0.9, vein_scale=10.0, blot=(0.4, 0.26, 0.28), ash=0.15, mouth_z=1.02, mouth_h=0.015, head_y=0.56,
                                    sac=(0, -0.08, 0.98), rough=0.45))
    bones = [
        ('body', (0, -0.16, 0.72), (0, 0.14, 0.76), None),
        ('chest', (0, 0.14, 0.76), (0, 0.34, 0.9), 'body'),
        ('neck', (0, 0.34, 0.9), (0, 0.56, 1.08), 'chest'),
        ('head', (0, 0.56, 1.08), (0, 0.76, 1.04), 'neck'),
        ('jaw', (0, 0.56, 1.03), (0, 0.72, 0.99), 'head'),
        ('hips', (0, -0.16, 0.72), (0, -0.44, 0.7), 'body'),
        ('tail1', (0, -0.44, 0.7), (0, -0.66, 0.6), 'hips'),
        ('tail2', (0, -0.66, 0.6), (0, -0.9, 0.5), 'tail1'),
    ]
    leg_bones(bones, [(0.13, 0.27, 0.8), (0.17, 0.27, 0.46), (0.16, 0.36, 0.12), (0.16, 0.47, 0.02)],
              [(0.11, -0.38, 0.68), (0.16, -0.18, 0.42), (0.14, -0.44, 0.14), (0.14, -0.31, 0.01)])
    extras = []
    for sx in (-1, 1):
        extras.append(('head', teeth_row(Vector((sx * 0.03, 0.6, 1.035)), Vector((sx * 0.01, 0.74, 1.03)), 7, 0.012, True, bvh=bvh)))
    ey = join([eye('e', Vector(e), 0.0085) for e in eyes_at], 'eyes')
    extras.append(('head', ey))
    return high, mat, bones, extras


# ------------------------------------------------------------ ハグレ
def hagure():
    """地上の群れの犬型変異体。灰で固まりひび割れた皮、唇のない口、まばらに残った毛、赤い目。"""
    fr = Frame()
    spine = [('tail2', (0, -0.82, 0.42), 0.012), ('tail1', (0, -0.58, 0.55), 0.03), ('hips', (0, -0.38, 0.6), (0.09, 0.085)),
             ('waist', (0, -0.18, 0.6), (0.07, 0.08)), ('ribs', (0, 0.02, 0.62), (0.1, 0.13)), ('chest', (0, 0.2, 0.64), (0.11, 0.14)),
             ('shoulders', (0, 0.3, 0.7), (0.09, 0.09)), ('neck1', (0, 0.42, 0.74), 0.05), ('skull', (0, 0.54, 0.76), (0.055, 0.055)),
             ('muzzle', (0, 0.66, 0.73), (0.036, 0.034)), ('nose', (0, 0.76, 0.71), (0.022, 0.02))]
    for n, p, r in spine:
        fr.pt(n, p, r)
    fr.chain(*[n for n, _, _ in spine])
    fr.pt('chin', (0, 0.54, 0.69), (0.036, 0.022))
    fr.pt('jawtip', (0, 0.72, 0.665), (0.018, 0.012))
    fr.chain('neck1', 'chin', 'jawtip')
    fr.pt('ear', (0.04, 0.5, 0.84), (0.016, 0.008), mirror=True)
    fr.pt('eartip', (0.055, 0.47, 0.9), 0.004, mirror=True)
    fr.chain('=skull', 'ear', 'eartip', mirror=True)
    # 犬の前脚: 肩 → 肘（後ろ） → 手首 → 足先
    front = [(0.06, 0.28, 0.66, 0.04), (0.1, 0.27, 0.58, 0.05), (0.11, 0.24, 0.44, 0.038), (0.11, 0.22, 0.34, 0.03),
             (0.11, 0.25, 0.2, 0.026), (0.1, 0.27, 0.07, 0.02), (0.1, 0.31, 0.03, (0.028, 0.014))]
    limb_front(fr, 'shoulders', front)
    hind = [(0.09, -0.38, 0.56, 0.06), (0.11, -0.3, 0.44, 0.058), (0.12, -0.24, 0.32, 0.03), (0.12, -0.34, 0.22, 0.028),
            (0.11, -0.44, 0.12, 0.02), (0.11, -0.4, 0.035, (0.026, 0.014))]
    limb_hind(fr, 'hips', hind)
    high = skin_body(fr, 2, 0.0055)
    eyes_at = [(-0.035, 0.6, 0.79), (0.035, 0.6, 0.79)]

    def details(P, N):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        d = ribs_spine(P, N, -0.05, 0.25, 0.6, 0.72, amp=0.8, spacing=0.04)
        # 灰で固まったひび割れ
        cell = vor(P, 26.0, 8.8)
        d += smoothstep(0.0, 0.06, cell) * 0.003 - 0.0015
        # 唇のない口: 口のまわりをへこませて歯ぐきを見せる
        lip = smoothstep(0.03, 0.0, np.abs(z - 0.695)) * smoothstep(0.55, 0.62, y)
        d -= lip * 0.006
        for e in eyes_at:
            d -= bump(P, e, 0.012) * 0.004
        d += nz(P, 9.0, 7.1, 3) * 0.003
        return d

    sculpt(high, details)
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromObject(high, bpy.context.evaluated_depsgraph_get())
    eyes_at = [on_surface(bvh, Vector((e[0] * 2.2, e[1], e[2])), (-np.sign(e[0]), 0, 0), 0.003) for e in eyes_at]
    mat = creature_mat('hagure', dict(base=(0.2, 0.17, 0.15), dark=(0.07, 0.06, 0.055), belly=(0.3, 0.24, 0.21), vein=(0.25, 0.08, 0.06),
                                      vein_amt=0.5, blot=(0.14, 0.11, 0.09), ash=0.55, mouth_z=0.695, mouth_h=0.018, head_y=0.5,
                                      fur=(0.09, 0.075, 0.06), crack=26.0, crack_seed=8.8, rough=0.75))
    bones = [
        ('body', (0, -0.18, 0.6), (0, 0.12, 0.63), None),
        ('chest', (0, 0.12, 0.63), (0, 0.36, 0.72), 'body'),
        ('neck', (0, 0.36, 0.72), (0, 0.5, 0.76), 'chest'),
        ('head', (0, 0.5, 0.76), (0, 0.78, 0.71), 'neck'),
        ('jaw', (0, 0.5, 0.69), (0, 0.73, 0.66), 'head'),
        ('hips', (0, -0.18, 0.6), (0, -0.44, 0.58), 'body'),
        ('tail1', (0, -0.44, 0.58), (0, -0.62, 0.52), 'hips'),
        ('tail2', (0, -0.62, 0.52), (0, -0.82, 0.42), 'tail1'),
    ]
    leg_bones(bones, [(0.1, 0.27, 0.58), (0.11, 0.22, 0.34), (0.1, 0.27, 0.07), (0.1, 0.36, 0.01)],
              [(0.09, -0.38, 0.56), (0.12, -0.24, 0.32), (0.11, -0.44, 0.12), (0.11, -0.33, 0.01)])
    extras = []
    for sx in (-1, 1):
        extras.append(('head', teeth_side(bvh, sx, 0.58, 0.76, 0.702, 8, 0.016, True)))
        extras.append(('jaw', teeth_side(bvh, sx, 0.58, 0.72, 0.688, 7, 0.013, False)))
    ey = join([eye('e', Vector(e), 0.008) for e in eyes_at], 'eyes')
    extras.append(('head', ey))
    return high, mat, bones, extras


def build(name, fn):
    reset_scene()
    t0 = time.time()
    high, mat, bones, extras = fn()
    print(f'[{name}] high {len(high.data.polygons)} faces {time.time() - t0:.1f}s')
    low = make_low(high)
    bake_maps(name, high, low, mat)
    print(f'[{name}] baked {time.time() - t0:.1f}s')
    bpy.data.objects.remove(high)
    low.name = 'skin_' + name
    low.data.materials.clear()
    low.data.materials.append(material('mskin'))
    arm = armature(bones)
    auto_weights(low, arm)
    objs = [low]
    for bone, ob in extras:
        for p in ob.data.polygons:
            p.use_smooth = True
        rigid(ob, arm, bone)
        objs.append(ob)
    export(name, arm, objs)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT, f'{name}.blend')))


MUTANTS = {'mukuro': mukuro, 'nushi': nushi, 'haha': haha, 'hagure': hagure}


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, fn in MUTANTS.items():
        if ONLY and name not in ONLY:
            continue
        build(name, fn)


if __name__ == '__main__':
    main()
