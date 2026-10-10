"""MakeHuman の体から服・髪・ひげを作る。

考え方:
  服はすべて「体の面を少し外側へずらした殻」として作る。殻は元の面の UV とウェイトをそのまま受け継ぐので、
  体と同じテクスチャ配置（UV）を共有し、リグにもそのまま乗る。
  体の各面は、いちばん外側にある服（または素肌）がひとつだけ「持つ」。内側に隠れる面は捨てる。
  こうするとキャラクター一人分の肌と服を、体の UV 配置の 1 枚のテクスチャに描ける。
"""
import math
import os

import bpy  # noqa: F401
import bmesh
import numpy as np
from mathutils import Vector, noise

PART_BONES = {
    'head': ['head', 'neck_01'],
    'torso': ['spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'],
    'pelvis': ['pelvis'],
    'uarm_l': ['upperarm_l'], 'uarm_r': ['upperarm_r'],
    'larm_l': ['lowerarm_l'], 'larm_r': ['lowerarm_r'],
    'hand_l': ['hand_l'] + [f'{f}_{j}_l' for f in ('thumb', 'index', 'middle', 'ring', 'pinky') for j in ('01', '02', '03')],
    'hand_r': ['hand_r'] + [f'{f}_{j}_r' for f in ('thumb', 'index', 'middle', 'ring', 'pinky') for j in ('01', '02', '03')],
    'thigh_l': ['thigh_l'], 'thigh_r': ['thigh_r'],
    'calf_l': ['calf_l'], 'calf_r': ['calf_r'],
    'foot_l': ['foot_l', 'ball_l'], 'foot_r': ['foot_r', 'ball_r'],
}
PARTS = list(PART_BONES)


class Info:
    """体の形・部位・目印を調べた結果。"""

    def __init__(self, body, arm, mask_dir):
        me = body.data
        n = len(me.vertices)
        self.body, self.arm = body, arm
        self.P = np.array([v.co[:] for v in me.vertices])
        self.N = np.array([v.normal[:] for v in me.vertices])
        # 部位: 部位ごとのウェイト合計が最大のもの
        W = np.zeros((n, len(PARTS)))
        gi = {g.index: g.name for g in body.vertex_groups}
        b2p = {b: k for k, (p, bs) in enumerate(PART_BONES.items()) for b in bs}
        for v in me.vertices:
            for g in v.groups:
                k = b2p.get(gi[g.group])
                if k is not None:
                    W[v.index, k] += g.weight
        self.part = W.argmax(axis=1)
        self.partname = np.array(PARTS)[self.part]
        B = {b.name: (np.array(b.head_local[:]), np.array(b.tail_local[:])) for b in arm.data.bones}
        self.B = B
        self.z = {
            'pelvis': B['pelvis'][0][2], 'waist': B['spine_01'][0][2], 'chest': B['spine_03'][0][2],
            'neck': B['neck_01'][0][2], 'head': B['head'][0][2], 'shoulder': B['upperarm_l'][0][2],
        }
        # 腕・脚に沿った位置 t（肩/股=0、肘/膝=1、手首/足首=2）
        self.t = np.zeros(n)
        for s in ('l', 'r'):
            self._limb(f'upperarm_{s}', f'lowerarm_{s}', [f'uarm_{s}', f'larm_{s}', f'hand_{s}'])
            self._limb(f'thigh_{s}', f'calf_{s}', [f'thigh_{s}', f'calf_{s}', f'foot_{s}'])
        # 面
        self.faces = [list(p.vertices) for p in me.polygons]
        self.fc = np.array([self.P[f].mean(axis=0) for f in self.faces])
        uv = me.uv_layers.active.data
        self.fuvs = [[uv[li].uv[:] for li in p.loop_indices] for p in me.polygons]
        self.fuv = np.array([np.mean(f, axis=0) for f in self.fuvs])
        fp = np.zeros((len(self.faces), len(PARTS)))
        for i, f in enumerate(self.faces):
            for v in f:
                fp[i, self.part[v]] += 1
        self.fpart = np.array(PARTS)[fp.argmax(axis=1)]
        self.ft = np.array([self.t[f].mean() for f in self.faces])
        # 耳の形（UV では左端の二つの円）
        self.ear_geo = (self.fpart == 'head') & (self.fuv[:, 0] < 0.17) & (self.fuv[:, 1] > 0.5) & (self.fuv[:, 1] < 0.7)
        # UV 上の領域マスク（MPFB2 の CC0 テクスチャ）
        self.mask = {}
        from PIL import Image
        for k in ('face', 'ears', 'lips', 'eyelids', 'fingernails'):
            im = np.asarray(Image.open(os.path.join(mask_dir, f'mpfb_{k}.jpg')).convert('L'), dtype=np.float32) / 255
            h, w = im.shape
            xs = np.clip((self.fuv[:, 0] * w).astype(int), 0, w - 1)
            ys = np.clip(((1 - self.fuv[:, 1]) * h).astype(int), 0, h - 1)
            self.mask[k] = im[ys, xs]
        # 顔の目印（頭のボーンと顔の面から推定）
        head = B['head'][0]
        face = (self.fpart == 'head') & (self.mask['face'] > 0.5)
        fcf = self.fc[face]
        self.face_front = fcf[:, 1].max()
        self.lm = {'head': head, 'eye_z': head[2] + 0.075, 'nose_z': head[2] + 0.035, 'mouth_z': head[2] + 0.005,
                   'chin_z': fcf[:, 2].min(), 'top_z': self.P[:, 2].max()}

    def _limb(self, b1, b2, parts):
        h1, t1 = self.B[b1]
        h2, t2 = self.B[b2]
        d1, L1 = (t1 - h1), np.linalg.norm(t1 - h1)
        d2, L2 = (t2 - h2), np.linalg.norm(t2 - h2)
        sel = np.isin(self.partname, parts)
        p = self.P[sel]
        a = ((p - h1) @ d1) / (L1 * L1)
        b = 1 + ((p - h2) @ d2) / (L2 * L2)
        self.t[sel] = np.where(a < 1, a, b)

    def azimuth(self, pts):
        """頭の軸まわりの角度（0=正面、±π=後ろ）。"""
        h = self.lm['head']
        return np.arctan2(pts[:, 0] - h[0], pts[:, 1] - h[1])


# ------------------------------------------------------------ 服ごとの「覆う範囲」
def cover(info, kind, o):
    """kind の服が覆う面（bool 配列）を返す。o は服の設定。"""
    P, fp, ft, z = info.fc, info.fpart, info.ft, info.z
    isin = lambda *names: np.isin(fp, names)  # noqa: E731
    arms = isin('uarm_l', 'uarm_r', 'larm_l', 'larm_r')
    legs = isin('thigh_l', 'thigh_r', 'calf_l', 'calf_r')
    hands = isin('hand_l', 'hand_r')
    feet = isin('foot_l', 'foot_r')
    head = isin('head')
    neckline = z['neck'] + o.get('collar', 0.02)
    if kind in ('shirt', 'coat'):
        sleeve = o.get('sleeve', 1.95)
        hem = z['pelvis'] - o.get('hem', 0.08)
        c = (isin('torso') & (P[:, 2] < neckline)) | (isin('pelvis') & (P[:, 2] > hem)) | (arms & (ft < sleeve))
        c |= head & (P[:, 2] < neckline) & (info.mask['face'] < 0.5)
        c |= legs & (ft < o.get('leg', 0.0))
        return c
    if kind == 'pants':
        top = z['waist'] + o.get('rise', 0.03)
        return (isin('pelvis', 'torso') & (P[:, 2] < top)) | (legs & (ft < o.get('end', 1.97)))
    if kind == 'boots':
        return feet | (legs & (ft > o.get('top', 1.62)))
    if kind == 'gloves':
        return hands | (arms & (ft > o.get('cuff', 1.86)))
    if kind == 'vest':
        top = z['shoulder'] - 0.02
        armpit = z['shoulder'] - 0.13
        neck_open = np.hypot(P[:, 0], (P[:, 2] - z['neck']) * 1.3) < 0.085
        arm_l = np.linalg.norm(P - info.B['upperarm_l'][0], axis=1) < o.get('armhole', 0.13)
        arm_r = np.linalg.norm(P - info.B['upperarm_r'][0], axis=1) < o.get('armhole', 0.13)
        c = isin('torso', 'pelvis') & (P[:, 2] > z['pelvis'] - 0.03) & (P[:, 2] < top) & ~neck_open & ~arm_l & ~arm_r
        del armpit
        return c
    if kind == 'scarf':
        nb = info.B['neck_01'][0]
        d = np.linalg.norm((P - nb) * np.array([1, 1, 1.6]), axis=1)
        jaw = info.lm['chin_z'] + 0.01
        return (head & (P[:, 2] < jaw) & (info.mask['face'] < 0.5)) | (isin('torso') & (d < o.get('r', 0.11)))
    if kind in ('hair', 'beanie', 'hood'):
        lm = info.lm
        # 前の生え際は顔のマスク（UV 上で顔の輪に沿う）で切ると、メッシュの流れに沿ったなめらかな線になる
        ruv = np.hypot(info.fuv[:, 0] - 0.862, info.fuv[:, 1] - 0.4832)
        if kind == 'hair':
            # 顔のマスクは額の上の方まで含むので、生え際は顔の中心からの輪で決める
            line = (info.mask['face'] < 0.5) | (ruv > o.get('hairline', 0.075))
            return head & ~info.ear_geo & line & (info.mask['ears'] < 0.3) & (P[:, 2] > info.z['head'] - o.get('nape', 0.0))
        if kind == 'beanie':
            # 額の上では顔の中心（UV）からの距離の輪で切る。輪はメッシュの流れに沿うので縁がなめらか
            return head & ~info.ear_geo & (info.mask['ears'] < 0.3) & (P[:, 2] > lm['eye_z'] + 0.005) & ((info.mask['face'] < 0.3) | (ruv > o.get('ring', 0.068)))
        # hood: 顔以外の頭と首
        return (head & (info.mask['face'] < 0.35)) | (isin('torso') & (P[:, 2] > z['shoulder'] - 0.03) & (np.abs(P[:, 0]) < 0.12))
    if kind == 'beard':
        lm = info.lm
        front = P[:, 1] > info.lm['head'][1] - 0.01
        c = head & front & (P[:, 2] < lm['nose_z'] - 0.012) & (info.mask['lips'] < 0.3)
        c &= (P[:, 2] > lm['chin_z'] - o.get('neck', 0.03))
        if o.get('style') == 'moustache':
            c &= (P[:, 2] > lm['mouth_z'] - 0.01)
        return c
    if kind == 'mask':
        return head & ((info.mask['face'] > 0.3) | ((P[:, 2] < info.lm['chin_z'] + 0.02) & (P[:, 1] > info.lm['head'][1])))
    raise ValueError(kind)


# ------------------------------------------------------------ 殻（服のメッシュ）を作る
def shell(body, faces, name, offset, fold=None, info=None):
    """body の faces（面番号の集合）を複製し、法線方向へ offset（関数 or 数値）だけずらす。"""
    ob = body.copy()
    ob.data = body.data.copy()
    ob.name = name
    ob.data.name = name
    bpy.context.scene.collection.objects.link(ob)
    for m in list(ob.modifiers):
        ob.modifiers.remove(m)
    me = ob.data
    # 元の頂点番号を属性として残す
    src = me.attributes.new('src', 'INT', 'POINT')
    src.data.foreach_set('value', list(range(len(me.vertices))))
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    keep = set(faces)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES_ONLY')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(me)
    bm.free()
    me.update()
    idx = np.zeros(len(me.vertices), dtype=np.int64)
    me.attributes['src'].data.foreach_get('value', idx)
    P = info.P[idx]
    N = info.N[idx]
    off = offset(info, idx) if callable(offset) else np.full(len(idx), offset)
    if fold:
        off = off + fold(info, idx)
    newp = P + N * off[:, None]
    me.vertices.foreach_set('co', newp.ravel())
    me.update()
    ob['src_count'] = len(idx)
    return ob


def rim(ob, depth, info):
    """殻の縁に、体へ向かう帯を足して厚みがあるように見せる（UV・ウェイトは縁の頂点から写す）。"""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    dl = bm.verts.layers.deform.verify()
    src = bm.verts.layers.int.get('src')
    uvl = bm.loops.layers.uv.active
    bm.verts.ensure_lookup_table()
    edges = [e for e in bm.edges if len(e.link_faces) == 1]
    inner = {}
    vuv = {}
    for e in edges:
        f = e.link_faces[0]
        for lo in f.loops:
            vuv.setdefault(lo.vert.index, lo[uvl].uv.copy())
    for e in edges:
        for v in e.verts:
            if v.index in inner:
                continue
            n = Vector(info.N[v[src]])
            nv = bm.verts.new(v.co - n * depth)
            for k, w in v[dl].items():
                nv[dl][k] = w
            nv[src] = v[src]
            inner[v.index] = nv
    for e in edges:
        f = e.link_faces[0]
        # 面の巡回順で a→b となる向きを探す
        a, b = e.verts
        for lo in f.loops:
            if lo.vert == a and lo.link_loop_next.vert == b:
                break
            if lo.vert == b and lo.link_loop_next.vert == a:
                a, b = b, a
                break
        try:
            nf = bm.faces.new((b, a, inner[a.index], inner[b.index]))
        except ValueError:
            continue
        nf.smooth = True
        for lo in nf.loops:
            key = lo.vert.index if lo.vert.index in vuv else None
            if key is None:
                orig = a if lo.vert is inner[a.index] else b
                key = orig.index
            lo[uvl].uv = vuv[key]
    bm.to_mesh(me)
    bm.free()
    me.update()


def loose(base, limb=0.0, cuff=0.0, torso=None):
    """体からの距離を部位ごとに変える。limb: 腕・脚の中ほどのふくらみ、cuff: 手首・足首のたるみ。"""
    def f(info, idx):
        t = info.t[idx]
        part = info.partname[idx]
        lim = ~np.isin(part, ['head', 'torso', 'pelvis'])
        bul = np.sin(np.clip(t / 2, 0, 1) * math.pi) ** 0.7
        end = np.clip((t - 1.75) / 0.25, 0, 1)
        off = np.full(len(idx), base if torso is None else torso)
        off[lim] = base + limb * bul[lim] + cuff * end[lim]
        return off
    return f


# ------------------------------------------------------------ しわ（形のゆらぎ）
def folds(amp=0.004, freq=14.0, seed=0.0, bunch=None):
    """腕・脚は長さ方向に詰まった輪のようなしわ、胴は横じわ。"""
    def f(info, idx):
        P = info.P[idx]
        t = info.t[idx]
        part = info.partname[idx]
        out = np.zeros(len(idx))
        for i in range(len(idx)):
            p = P[i]
            limb = part[i] not in ('head', 'torso', 'pelvis')
            if limb:
                q = Vector((t[i] * freq * 0.45, p[0] * 6 + seed, p[1] * 6))
                k = 1.0
                if bunch:
                    k += bunch * max(0.0, 1 - abs(t[i] - 1.0) * 3)  # 肘・膝
                    k += bunch * max(0.0, 1 - abs(t[i] - 1.9) * 5)  # 手首・足首
            else:
                q = Vector((p[0] * 5 + seed, p[1] * 5, p[2] * freq * 0.5))
                k = 0.7
            out[i] = noise.noise(q) * amp * k
        return out
    return f


# ------------------------------------------------------------ UV の空き（右上の補助メッシュ用の区画）
FREE_UV = (0.77, 0.83, 0.95, 1.0)  # (u0, v0, u1, v1)


# ------------------------------------------------------------ 体の UV を写す（後から足した形用）
def project_uv(ob, info, face_sel, shrink=1.0):
    """ob の各面に、面の中心にいちばん近い体の面（face_sel の中から）の UV を写す。
    面ごとに一つの三角形の対応を外挿して使うので、ひとつの面が UV の島をまたぐことはない。"""
    from mathutils.bvhtree import BVHTree
    from mathutils.geometry import barycentric_transform, intersect_point_tri
    sel = np.nonzero(face_sel)[0]
    polys = [info.faces[i] for i in sel]
    bvh = BVHTree.FromPolygons([Vector(p) for p in info.P], polys)
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        loc, _, k, _ = bvh.find_nearest(poly.center)
        fi = sel[k]
        vs = info.faces[fi]
        uvs = info.fuvs[fi]
        tri = None
        for j in range(1, len(vs) - 1):
            a, b, c = (Vector(info.P[vs[0]]), Vector(info.P[vs[j]]), Vector(info.P[vs[j + 1]]))
            if tri is None or intersect_point_tri(loc, a, b, c) is not None:
                tri = (a, b, c, Vector((*uvs[0], 0)), Vector((*uvs[j], 0)), Vector((*uvs[j + 1], 0)))
        rc = barycentric_transform(loc, *tri)
        rs = [barycentric_transform(me.vertices[me.loops[li].vertex_index].co, *tri) for li in poly.loop_indices]
        # 外挿で隣の領域へはみ出さないよう、写し先の面の大きさ（UV）より小さく収める
        fu = np.array(uvs)
        mid = fu.mean(axis=0)
        lim = np.linalg.norm(fu - mid, axis=1).min() * 0.5
        ext = max((r - rc).length for r in rs) or 1.0
        k = min(shrink, lim / ext)
        if shrink < 1.0:
            # 写し先の面の中心に寄せる（縁の面でも隣の領域へはみ出さない）
            rc = Vector((mid[0], mid[1], 0))
            rs = [rc + (r - barycentric_transform(loc, *tri)) for r in rs]
        for li, r in zip(poly.loop_indices, rs):
            uv[li].uv = (rc.x + (r.x - rc.x) * k, rc.y + (r.y - rc.y) * k)


def _superellipse(cx, cz, w, h, n, m=14, y=0.0):
    pts = []
    for i in range(m):
        a = 2 * math.pi * i / m
        c, s = math.cos(a), math.sin(a)
        x = cx + w * math.copysign(abs(c) ** (2 / n), c)
        z = cz + h * math.copysign(abs(s) ** (2 / n), s)
        pts.append((x, y, z))
    return pts


def boot_block(info, side, margin=0.012):
    """足先を包む、指の形の出ないブーツ。足の頂点から断面ごとの幅と高さを測って作る。"""
    ankle = Vector(info.B[f'foot_{side}'][0])
    toe = Vector(info.B[f'ball_{side}'][1])
    f = Vector((toe.x - ankle.x, toe.y - ankle.y, 0)).normalized()
    w = Vector((0, 0, 1)).cross(f).normalized()
    sel = info.partname == f'foot_{side}'
    p = info.P[sel]
    rel = p - np.array(ankle[:])
    a = rel @ np.array(f[:])
    b = rel @ np.array(w[:])
    zz = p[:, 2]
    a0, a1 = a.min() - margin * 0.8, a.max() + margin * 1.2
    secs = 12
    rings = []
    for i in range(secs + 1):
        t = i / secs
        aa = a0 + (a1 - a0) * t
        near = np.abs(a - aa) < (a1 - a0) / secs
        if near.sum() < 3:
            near = np.abs(a - aa) < (a1 - a0) / secs * 2
        bmin, bmax = b[near].min() - margin, b[near].max() + margin
        top = min(zz[near].max() + margin * 0.8, ankle.z + 0.07)
        if t < 0.35:
            top = ankle.z + 0.07  # かかと〜足首は高く（筒につなぐ）
        bot = 0.0
        # つま先は丸く絞る
        k = 1.0 if t < 0.8 else max(0.35, 1 - (t - 0.8) / 0.2 * 0.65)
        cw = (bmax - bmin) / 2 * (k ** 0.5)
        cb = (bmax + bmin) / 2
        h = (top - bot) / 2 * (k if t > 0.85 else 1.0)
        ring = []
        for x, _, z in _superellipse(0, bot + h, cw, h, 3.2):
            q = ankle + f * aa + w * (cb + x)
            ring.append((q.x, q.y, z))
        rings.append(ring)
    verts = [v for r in rings for v in r]
    m = len(rings[0])
    faces = []
    for i in range(len(rings) - 1):
        for j in range(m):
            a_, b_ = i * m + j, i * m + (j + 1) % m
            faces.append((a_, b_, b_ + m, a_ + m))
    # 両端のふた
    c0 = len(verts)
    verts.append(tuple(np.mean(rings[0], axis=0)))
    c1 = len(verts)
    verts.append(tuple(np.mean(rings[-1], axis=0)))
    for j in range(m):
        faces.append((c0, (j + 1) % m, j))
        faces.append((c1, (len(rings) - 1) * m + j, (len(rings) - 1) * m + (j + 1) % m))
    me = bpy.data.meshes.new(f'bootfoot_{side}')
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(f'bootfoot_{side}', me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('sub', 'SUBSURF')
    mod.levels = 2
    from blender_common import apply_mods
    apply_mods(ob)
    for pp in ob.data.polygons:
        pp.use_smooth = True
    # 面の向きを外向きにそろえる
    import bmesh as _bm
    bm = _bm.new()
    bm.from_mesh(ob.data)
    _bm.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def scarf_rolls(info, thick=0.026, rolls=2, seed=0.0):
    """首に巻いた布のふくらみ（筒を首まわりに重ねる）。"""
    nb = Vector(info.B['neck_01'][0])
    obs = []
    for k in range(rolls):
        z = nb.z - 0.015 + k * 0.032
        sel = (np.isin(info.partname, ['head', 'torso'])) & (np.abs(info.P[:, 2] - z) < 0.012)
        p = info.P[sel]
        d = p[:, :2] - np.array([nb.x, nb.y])
        rx = np.abs(d[:, 0]).max() + thick * 0.8
        ry = np.abs(d[:, 1]).max() + thick * 0.8
        seg, rs = 28, 8
        verts, faces = [], []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            c = Vector((nb.x + math.sin(a) * rx, nb.y + math.cos(a) * ry, z))
            out = Vector((math.sin(a), math.cos(a), 0))
            r = thick * (0.75 + 0.5 * (noise.noise(Vector((a * 1.7, k * 3.1, seed))) + 0.5))
            c.z += noise.noise(Vector((a * 1.3, k * 5.7 + 1, seed))) * 0.012
            for j in range(rs):
                b = 2 * math.pi * j / rs
                q = c + out * math.cos(b) * r + Vector((0, 0, math.sin(b) * r * 0.75))
                verts.append(q[:])
        for i in range(seg):
            for j in range(rs):
                a_ = i * rs + j
                b_ = i * rs + (j + 1) % rs
                c_ = ((i + 1) % seg) * rs + (j + 1) % rs
                d_ = ((i + 1) % seg) * rs + j
                faces.append((a_, d_, c_, b_))
        me = bpy.data.meshes.new('roll')
        me.from_pydata(verts, [], faces)
        ob = bpy.data.objects.new('roll', me)
        bpy.context.scene.collection.objects.link(ob)
        for pp in me.polygons:
            pp.use_smooth = True
        obs.append(ob)
    return obs


def hair_curtain(hair, info, length=0.09, flare=0.012, front_cut=0.9):
    """髪の殻の下の縁（横と後ろ）を下へ伸ばして、肩までの髪の房にする。"""
    import bmesh as _bm
    me = hair.data
    bm = _bm.new()
    bm.from_mesh(me)
    head = info.lm['head']
    edges = [e for e in bm.edges if len(e.link_faces) == 1]
    keep = []
    for e in edges:
        c = (e.verts[0].co + e.verts[1].co) / 2
        az = abs(math.atan2(c.x - head[0], c.y - head[1]))
        if az > front_cut and c.z < info.lm['eye_z'] + 0.03:
            keep.append(e)
    verts, faces = [], []
    vid = {}
    rings = 5
    for e in keep:
        for v in e.verts:
            if v.index in vid:
                continue
            out = Vector((v.co.x - head[0], v.co.y - head[1], 0)).normalized()
            vid[v.index] = len(verts)
            for k in range(rings + 1):
                t = k / rings
                q = v.co + Vector((0, 0, -length * t)) + out * (flare * math.sin(t * math.pi * 0.7) + 0.004 * t)
                q += out * noise.noise(Vector((v.co.x * 40, v.co.y * 40, t * 3))) * 0.006 * t
                verts.append(q[:])
    for e in keep:
        a, b = (vid[e.verts[0].index], vid[e.verts[1].index])
        for k in range(rings):
            faces.append((a + k, b + k, b + k + 1, a + k + 1))
    bm.free()
    m = bpy.data.meshes.new('curtain')
    m.from_pydata(verts, [], faces)
    ob = bpy.data.objects.new('curtain', m)
    bpy.context.scene.collection.objects.link(ob)
    solid = ob.modifiers.new('s', 'SOLIDIFY')
    solid.thickness = 0.008
    from blender_common import apply_mods
    apply_mods(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def hair_bun(info, size=0.045):
    head = info.lm['head']
    top = info.lm['top_z']
    c = Vector((head[0], head[1] - 0.08, top - 0.05))
    from blender_common import uv_sphere, displace, apply_mods
    ob = uv_sphere('bun', 1, c, (size, size * 0.85, size * 0.8), 16, 10)
    displace(ob, 0.006, 0.02)
    apply_mods(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def relax(ob, iters=12, factor=0.6):
    """殻の内側の頂点をならして細かな凹凸（鼻や唇の形など）を消す。縁は動かさない。"""
    import bmesh as _bm
    bm = _bm.new()
    bm.from_mesh(ob.data)
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(iters):
        _bm.ops.smooth_vert(bm, verts=inner, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
