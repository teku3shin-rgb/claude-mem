"""人物の持ち物・装備（硬いもの）。体の寸法に合わせて置き、ボーンに 100% のウェイトで載せる。

マテリアル名はゲーム側（js/gfx.js の ROLE 表）の役割名で、タイル用テクスチャが割り当てられる。
"""
import math

import bpy  # noqa: F401
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

from blender_common import (apply_mods, assign, bevel, cube, cylinder, delete_verts, displace, join, material, rotate,
                            scale_mesh, smooth, solidify, subsurf, torus, translate, unwrap, uv_sphere, warp)

PI = math.pi


def M(name):
    return material(name)


def rigid(ob, bone):
    """全頂点を一本のボーンに載せる。"""
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
    return ob


def follow_body(ob, info, parts=None):
    """各頂点に、いちばん近い体の頂点のウェイトを写す（ベルトや肩紐など、体に沿うもの）。"""
    body = info.body
    sel = np.arange(len(info.P)) if parts is None else np.nonzero(np.isin(info.partname, parts))[0]
    kd = KDTree(len(sel))
    for i in sel:
        kd.insert(Vector(info.P[i]), int(i))
    kd.balance()
    names = {g.index: g.name for g in body.vertex_groups}
    groups = {}
    for v in ob.data.vertices:
        _, j, _ = kd.find(v.co)
        for g in body.data.vertices[j].groups:
            nm = names[g.group]
            if nm not in groups:
                groups[nm] = ob.vertex_groups.get(nm) or ob.vertex_groups.new(name=nm)
            groups[nm].add([v.index], g.weight, 'REPLACE')
    return ob


def head_frame(info):
    """頭の中心と半径（耳から上の頭部の頂点から）。半径の z は中心から頭頂まで。"""
    sel = (info.partname == 'head') & (info.P[:, 2] > info.lm['eye_z'] - 0.03)
    p = info.P[sel]
    lo, hi = p.min(axis=0), p.max(axis=0)
    c = (lo + hi) / 2
    r = (hi - lo) / 2
    r[2] = hi[2] - c[2]
    return Vector(c), Vector(r)


def eye_centers(base, verts):
    return {s: Vector(verts[base.group_verts(f'joint-{s}-eye')].mean(axis=0)) for s in ('l', 'r')}


# ------------------------------------------------------------ 頭
def helmet(info):
    c, r = head_frame(info)
    # 髪の上にかぶるよう、頭頂より 3cm ほど上まで
    o = uv_sphere('helmet', 1, (c.x, c.y - 0.004, c.z - 0.025), (r.x + 0.04, r.y + 0.04, r.z + 0.05), 28, 16)
    delete_verts(o, lambda q: q.z < c.z - 0.02)
    rim = torus('hrim', 1, 0.011, (0, 0, 0), (0, 0, 0), 32, 6)
    scale_mesh(rim, (r.x + 0.042, r.y + 0.042, 1))
    translate(rim, (c.x, c.y - 0.004, c.z - 0.019))
    assign(o, M('helmet'))
    solidify(o, 0.008)
    apply_mods(o)
    assign(rim, M('helmet'))
    strap = torus('hstrap', 1, 0.005, (c.x, c.y + 0.01, c.z - 0.07), (0.25, PI / 2, 0), 20, 4)
    scale_mesh(strap, (1, r.y * 0.25, r.z * 0.95))
    assign(strap, M('gear'))
    h = join([o, rim, strap], 'helmet')
    smooth(h, 40)
    unwrap(h, 0.3)
    return rigid(h, 'head')


def cap(info):
    c, r = head_frame(info)
    z0 = c.z + 0.015
    o = uv_sphere('cap', 1, (c.x, c.y - 0.006, z0), (r.x + 0.022, r.y + 0.022, r.z - 0.015 + 0.03), 24, 14)
    delete_verts(o, lambda q: q.z < z0)
    band = cylinder('cband', 1, 0.03, (0, 0, 0), verts=24, fill='NOTHING')
    scale_mesh(band, (r.x + 0.024, r.y + 0.024, 1))
    translate(band, (c.x, c.y - 0.006, z0 + 0.012))
    # つば: 原点で作って傾けてから額の前へ
    vis = cylinder('visor', 1, 0.008, (0, 0, 0), verts=24)
    scale_mesh(vis, (r.x * 0.9, r.y * 0.75, 1))
    delete_verts(vis, lambda q: q.y < r.y * 0.1)
    rotate(vis, -0.2, 'X')
    translate(vis, (c.x, c.y + r.y * 0.62, z0 + 0.004))
    for p in (o, band, vis):
        assign(p, M('hat'))
    h = join([o, band, vis], 'cap')
    solidify(h, 0.005)
    apply_mods(h)
    smooth(h, 40)
    unwrap(h, 0.2)
    return rigid(h, 'head')


def mask_parts(info, eyes):
    """ガスマスクの金具（ゴムの面は服の層として別に作る）。"""
    c, r = head_frame(info)
    parts = []
    front = info.face_front
    for s, ec in eyes.items():
        pos = Vector((ec.x, ec.y + 0.03, ec.z + 0.002))
        rim = torus('erim', 0.023, 0.006, pos, (PI / 2, 0, 0), 24, 8)
        assign(rim, M('gear'))
        gl = cylinder('eglass', 0.021, 0.004, pos, (PI / 2, 0, 0), 24)
        assign(gl, M('glass'))
        parts += [rim, gl]
    mouth = Vector((0, front + 0.012, info.lm['mouth_z'] - 0.022))
    can = cylinder('filter', 0.038, 0.07, mouth + Vector((0, 0.05, -0.015)), (PI / 2 - 0.5, 0, 0), 24)
    bevel(can, 0.004, 2)
    apply_mods(can)
    assign(can, M('olive'))
    neck = cylinder('fneck', 0.024, 0.04, mouth + Vector((0, 0.02, -0.004)), (PI / 2 - 0.5, 0, 0), 16)
    assign(neck, M('rubber'))
    parts += [can, neck]
    for k in range(3):
        d = 0.012 * (k - 1)
        rg = torus('rib', 0.039, 0.003, mouth + Vector((0, 0.05 + d * math.cos(0.5), -0.015 - d * math.sin(0.5))), (PI / 2 - 0.5, 0, 0), 24, 4)
        assign(rg, M('gear'))
        parts.append(rg)
    for z in (0.02, -0.04):
        st = torus('mstrap', 1, 0.006, (c.x, c.y - 0.005, c.z + z), (0, 0, 0), 28, 4)
        scale_mesh(st, (r.x * 1.06, r.y * 1.06, 1))
        delete_verts(st, lambda q: q.y > c.y + r.y * 0.4)
        assign(st, M('rubber'))
        parts.append(st)
    m = join(parts, 'mask_gear')
    smooth(m, 45)
    unwrap(m, 0.2)
    return rigid(m, 'head')


# ------------------------------------------------------------ 胴
def torso_section(info, z):
    sel = (np.isin(info.partname, ['torso', 'pelvis'])) & (np.abs(info.P[:, 2] - z) < 0.02)
    p = info.P[sel]
    return p[:, 1].min(), p[:, 1].max(), np.abs(p[:, 0]).max()


def pack(info, color_mat='pack'):
    z = info.z['chest']
    back, front, half = torso_section(info, z)
    cz = z - 0.04
    bag = cube('bag', (0.32, 0.16, 0.40), (0, back - 0.1, cz))
    bevel(bag, 0.035, 3)
    subsurf(bag, 1)
    apply_mods(bag)
    warp(bag, lambda q: Vector((q.x, q.y - 0.02 * max(0, 1 - abs(q.x) / 0.16) * (1 if q.y < back - 0.1 else 0), q.z)))
    displace(bag, 0.006, 0.08)
    apply_mods(bag)
    assign(bag, M(color_mat))
    flap = cube('flap', (0.3, 0.17, 0.1), (0, back - 0.1, cz + 0.17))
    bevel(flap, 0.02, 2)
    apply_mods(flap)
    assign(flap, M(color_mat))
    roll = cylinder('roll', 0.06, 0.38, (0, back - 0.1, cz + 0.27), (0, PI / 2, 0), 18)
    displace(roll, 0.005, 0.05)
    apply_mods(roll)
    assign(roll, M('canvas'))
    parts = [bag, flap, roll]
    for x in (-0.07, 0.07):
        b = cube('buckle', (0.035, 0.012, 0.05), (x, back - 0.19, cz + 0.08))
        assign(b, M('gear'))
        parts.append(b)
    pk = join(parts, 'pack')
    smooth(pk, 40)
    unwrap(pk, 0.3)
    rigid(pk, 'spine_03')
    straps = shoulder_straps(info, back - 0.04, cz + 0.2, cz - 0.12)
    return [pk, straps]


def shoulder_straps(info, back_y, top_z, bottom_z):
    """背中から肩を越えて胸へ回る肩紐。体の表面に沿わせる。"""
    from mathutils.bvhtree import BVHTree
    me = info.body.data
    bvh = BVHTree.FromPolygons([Vector(p) for p in info.P], info.faces)
    ribbons = []
    for sx in (-1, 1):
        x0 = sx * 0.085
        sh = Vector(info.B[f'upperarm_{"l" if sx < 0 else "r"}'][0])
        pts = []
        # 背中 → 肩の上 → 胸 → わきの下
        ctrl = [Vector((x0, back_y, top_z - 0.02)), Vector((sx * 0.1, back_y + 0.06, sh.z + 0.08)),
                Vector((sx * 0.11, sh.y + 0.02, sh.z + 0.09)), Vector((sx * 0.11, sh.y + 0.13, sh.z + 0.01)),
                Vector((sx * 0.12, sh.y + 0.15, sh.z - 0.12)), Vector((sx * 0.15, sh.y + 0.08, sh.z - 0.2))]
        for a, b in zip(ctrl, ctrl[1:]):
            for i in range(6):
                pts.append(a.lerp(b, i / 6))
        pts.append(ctrl[-1])
        verts, faces = [], []
        for i, p in enumerate(pts):
            loc, nrm, _, _ = bvh.find_nearest(p)
            q = loc + nrm * 0.03
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            side = t.cross(nrm).normalized() * 0.022
            verts += [q - side, q + side]
            if i:
                k = 2 * i
                faces.append((k - 2, k - 1, k + 1, k))
        ob = bpy.data.meshes.new('strap')
        ob.from_pydata(verts, [], faces)
        o = bpy.data.objects.new('strap', ob)
        bpy.context.scene.collection.objects.link(o)
        solidify(o, 0.006)
        apply_mods(o)
        assign(o, M('gear'))
        ribbons.append(o)
    s = join(ribbons, 'straps')
    smooth(s, 50)
    unwrap(s, 0.2)
    return follow_body(s, info, ['torso', 'uarm_l', 'uarm_r', 'pelvis'])


def pouches(info):
    z = info.z['chest'] - 0.1
    back, front, half = torso_section(info, z)
    ps = []
    for i, x in enumerate((-0.085, 0.0, 0.085)):
        p = cube(f'pouch{i}', (0.072, 0.045, 0.1), (x, front + 0.045, z))
        bevel(p, 0.01, 2)
        apply_mods(p)
        assign(p, M('vest'))
        f = cube(f'pflap{i}', (0.076, 0.05, 0.03), (x, front + 0.047, z + 0.045))
        bevel(f, 0.006, 2)
        apply_mods(f)
        assign(f, M('vest'))
        ps += [p, f]
    pj = join(ps, 'pouches')
    smooth(pj, 40)
    unwrap(pj, 0.25)
    return rigid(pj, 'spine_02')


# ------------------------------------------------------------ 手に持つもの
def _hand_frame(info, side):
    h, t = info.B[f'lowerarm_{side}']
    hand = Vector(info.B[f'hand_{side}'][0])
    d = Vector(t - h).normalized()  # 前腕の向き（下向き）
    return hand, d


def rifle(info):
    """右手に握る小銃。基本姿勢では前腕に沿って下を向き、腕を上げると前を向く。"""
    hand, d = _hand_frame(info, 'r')
    parts = []
    # 銃のローカル座標: -Z が銃口、+Y が上（後で前腕に合わせて回す）
    rec = cube('rec', (0.05, 0.07, 0.3), (0, 0.0, -0.05))
    bevel(rec, 0.006, 2)
    apply_mods(rec)
    assign(rec, M('metal'))
    cover = cube('cover', (0.044, 0.03, 0.22), (0, 0.045, -0.02))
    bevel(cover, 0.012, 3)
    apply_mods(cover)
    assign(cover, M('metal'))
    brl = cylinder('brl', 0.011, 0.36, (0, 0.012, -0.38), verts=14)
    assign(brl, M('metal'))
    gas = cylinder('gas', 0.012, 0.22, (0, 0.04, -0.29), verts=12)
    assign(gas, M('metal'))
    hg = cube('hguard', (0.05, 0.05, 0.16), (0, 0.012, -0.27))
    bevel(hg, 0.015, 3)
    apply_mods(hg)
    assign(hg, M('wood'))
    mz = cylinder('muzzle', 0.016, 0.06, (0, 0.012, -0.58), verts=14)
    assign(mz, M('metal'))
    fs = cube('fsight', (0.008, 0.035, 0.012), (0, 0.035, -0.53))
    assign(fs, M('metal'))
    mag = cube('mag', (0.03, 0.15, 0.06), (0, -0.09, -0.12))
    warp(mag, lambda q: Vector((q.x, q.y, q.z - (q.y + 0.02) ** 2 * 2.5 + (q.y + 0.02) * 0.25)))
    bevel(mag, 0.004, 2)
    apply_mods(mag)
    assign(mag, M('metal'))
    grip = cube('grip', (0.03, 0.1, 0.04), (0, -0.07, 0.07))
    rotate(grip, -0.3, 'X')
    bevel(grip, 0.008, 2)
    apply_mods(grip)
    assign(grip, M('wood'))
    stock = cube('stock', (0.04, 0.07, 0.26), (0, -0.02, 0.2))
    warp(stock, lambda q: Vector((q.x, q.y - max(0, q.z - 0.1) * 0.25, q.z)))
    bevel(stock, 0.012, 3)
    apply_mods(stock)
    assign(stock, M('wood'))
    parts = [rec, cover, brl, gas, hg, mz, fs, mag, grip, stock]
    g = join(parts, 'gun')
    smooth(g, 35)
    unwrap(g, 0.25)
    # 握りの位置を手のひらへ。前腕の向き（下）に銃口を向け、上面を体の外側へ
    q = Vector((0, 0, -1)).rotation_difference(d)
    g.data.transform(Matrix.Translation(Vector((0, 0.07, -0.06))))
    g.data.transform(q.to_matrix().to_4x4())
    g.data.transform(Matrix.Rotation(-PI / 2, 4, d))
    g.data.transform(Matrix.Translation(hand + d * 0.06 + Vector((0.0, 0.035, 0.0))))
    return rigid(g, 'hand_r')


def guitar(info):
    z = info.z['pelvis'] + 0.12
    back, front, half = torso_section(info, z)
    cen = Vector((0.02, front + 0.06, z))
    dvec = Vector((-0.8, 0, 0.6)).normalized()
    b1 = uv_sphere('gb1', 1, cen, (0.19, 0.05, 0.17), 28, 12)
    b2 = uv_sphere('gb2', 1, cen + dvec * 0.19, (0.14, 0.048, 0.13), 24, 12)
    for b in (b1, b2):
        warp(b, lambda q: Vector((q.x, cen.y + max(-0.045, min(0.045, (q.y - cen.y) * 1.6)), q.z)))
        assign(b, M('wood'))
    nk = cube('gneck', (0.05, 0.025, 0.5), (0, 0, 0))
    rotate(nk, math.atan2(dvec.x, dvec.z), (0, 1, 0))
    translate(nk, cen + dvec * 0.52 + Vector((0, 0.02, 0)))
    assign(nk, M('wood'))
    hd = cube('ghead', (0.07, 0.02, 0.15), (0, 0, 0))
    rotate(hd, math.atan2(dvec.x, dvec.z), (0, 1, 0))
    translate(hd, cen + dvec * 0.83 + Vector((0, 0.015, 0)))
    assign(hd, M('wood'))
    hole = cylinder('ghole', 0.045, 0.006, cen + dvec * 0.09 + Vector((0, 0.047, 0)), (PI / 2, 0, 0), 24)
    assign(hole, M('dark'))
    br = cube('gbridge', (0.1, 0.012, 0.02), cen + Vector((0, 0.05, -0.08)))
    assign(br, M('dark'))
    strs = cube('gstrings', (0.03, 0.003, 0.7), (0, 0, 0))
    rotate(strs, math.atan2(dvec.x, dvec.z), (0, 1, 0))
    translate(strs, cen + dvec * 0.3 + Vector((0, 0.05, 0)))
    assign(strs, M('brass'))
    g = join([b1, b2, nk, hd, hole, br, strs], 'guitar')
    smooth(g, 40)
    unwrap(g, 0.3)
    return rigid(g, 'spine_01')


def lantern(info):
    hand, d = _hand_frame(info, 'l')
    p = hand + d * 0.2
    fr = cube('lfr', (0.08, 0.08, 0.13), p)
    solidify(fr, 0.008)
    apply_mods(fr)
    assign(fr, M('gear'))
    top = cylinder('ltop', 0.05, 0.02, p + Vector((0, 0, 0.075)), verts=16, r2=0.02)
    assign(top, M('metal'))
    gl = uv_sphere('lgl', 1, p, (0.03, 0.03, 0.045), 12, 8)
    assign(gl, M('lampglow'))
    hd = torus('lhd', 0.035, 0.004, p + Vector((0, 0, 0.11)), (0, PI / 2, 0), 16, 4)
    assign(hd, M('metal'))
    lt = join([fr, top, gl, hd], 'lantern')
    smooth(lt, 35)
    unwrap(lt, 0.2)
    return rigid(lt, 'hand_l')


def headphones(info):
    """無線士のヘッドホン。耳あてと、頭の上を回る帯。"""
    c, r = head_frame(info)
    parts = []
    for sx in (-1, 1):
        p = Vector((c.x + sx * (r.x + 0.012), c.y - 0.01, c.z - 0.03))
        cup = cylinder('cup', 0.036, 0.03, p, (0, PI / 2, 0), 20)
        bevel(cup, 0.008, 2)
        apply_mods(cup)
        assign(cup, M('dark'))
        pad = torus('pad', 0.03, 0.009, p - Vector((sx * 0.016, 0, 0)), (0, PI / 2, 0), 20, 6)
        assign(pad, M('rubber'))
        parts += [cup, pad]
    seg = 20
    verts, faces = [], []
    for i in range(seg + 1):
        a = PI * i / seg
        q = Vector((c.x - math.cos(a) * (r.x + 0.016), c.y - 0.01, c.z - 0.03 + math.sin(a) * (r.z + 0.03)))
        verts += [(q.x, q.y - 0.012, q.z), (q.x, q.y + 0.012, q.z)]
        if i:
            k = 2 * i
            faces.append((k - 2, k - 1, k + 1, k))
    me = bpy.data.meshes.new('hband')
    me.from_pydata(verts, [], faces)
    hb = bpy.data.objects.new('hband', me)
    bpy.context.scene.collection.objects.link(hb)
    solidify(hb, 0.006)
    apply_mods(hb)
    assign(hb, M('dark'))
    h = join(parts + [hb], 'headphones')
    smooth(h, 40)
    unwrap(h, 0.2)
    return rigid(h, 'head')
