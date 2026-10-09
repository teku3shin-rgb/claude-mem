"""深層線のモデルを Blender で生成して glb に書き出す。

使い方: python tools/build_models.py <出力ディレクトリ>
（bpy 5.2 が入った Python で実行する。tools/README.md 参照）
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402,F401
from blender_common import (  # noqa: E402
    apply_mods, assign, bevel, cone, cube, cylinder, delete_verts, displace, empty, export_glb, finish, ico, join,
    material, reset_scene, rotate, scale_mesh, set_parent, skin, smooth, solidify, stats, subsurf, torus, translate,
    unwrap, uv_sphere, warp,
)
from mathutils import Vector  # noqa: E402

PI = math.pi
OUT = sys.argv[1] if len(sys.argv) > 1 else 'assets/build'
os.makedirs(OUT, exist_ok=True)


def part(o, mat, pivot, unit=0.35, sub=0, smooth_angle=None, flat_shade=False):
    if sub:
        subsurf(o, sub)
    finish(o, mat, unit=unit, smooth_angle=smooth_angle, flat_shade=flat_shade)
    set_parent(o, pivot, (0, 0, 0))
    return o


def tube(name, pts, radii, mat, pivot, sub=1, unit=0.35, extra=None):
    """点列に沿った有機的なチューブ（スキンモディファイア + サブディビジョン）。"""
    edges = [(i, i + 1) for i in range(len(pts) - 1)]
    o = skin(name, pts, edges, radii)
    subsurf(o, sub)
    if extra:
        extra(o)
    return part(o, mat, pivot, unit=unit)


def done(name):
    v, t = stats()
    path = os.path.join(OUT, name + '.glb')
    export_glb(path)
    print(f'[{name}] verts={v} tris={t} -> {path}')


# ================================================================ 人物
def build_human():
    reset_scene()
    M = material
    skin_m = M('skin', (0.72, 0.55, 0.45), 0.65)
    cloth = M('cloth', (0.45, 0.44, 0.38), 0.95)
    pants = M('pants', (0.32, 0.32, 0.3), 0.95)
    boots = M('boots', (0.14, 0.11, 0.09), 0.75)
    vest = M('vest', (0.35, 0.34, 0.26), 0.9)
    hair = M('hair', (0.1, 0.08, 0.07), 0.9)
    beard = M('beard', (0.12, 0.1, 0.08), 0.95)
    hat = M('hat', (0.2, 0.18, 0.16), 0.95)
    helmet = M('helmet', (0.23, 0.26, 0.2), 0.55, 0.2)
    scarf = M('scarf', (0.4, 0.25, 0.18), 0.95)
    pack = M('pack', (0.3, 0.26, 0.18), 0.95)
    gear = M('gear', (0.08, 0.08, 0.08), 0.55, 0.1)
    rubber = M('rubber', (0.09, 0.09, 0.085), 0.7)
    glass = M('glass', (0.06, 0.08, 0.09), 0.1, 0.6)
    eye = M('eye', (0.06, 0.05, 0.04), 0.3)
    glove = M('glove', (0.12, 0.1, 0.09), 0.8)
    metal = M('metal', (0.16, 0.16, 0.17), 0.4, 0.8)
    wood = M('wood', (0.42, 0.27, 0.15), 0.6)
    glow = M('lampglow', (1, 0.8, 0.5), 0.5, 0, (1, 0.75, 0.4), 4)

    root = empty('root')
    hips = empty('hips', (0, 0, 0.92), root)
    torso = empty('torso', (0, 0, 0), hips)
    head = empty('head', (0, 0, 0.66), torso)
    sh = {s: empty('sh' + s, (sx * 0.28, 0, 0.58), torso) for s, sx in (('L', -1), ('R', 1))}
    el = {s: empty('el' + s, (0, 0, -0.30), sh[s]) for s in 'LR'}
    hp = {s: empty('hip' + s, (sx * 0.11, 0, 0), hips) for s, sx in (('L', -1), ('R', 1))}
    kn = {s: empty('kn' + s, (0, 0, -0.45), hp[s]) for s in 'LR'}

    def wrinkles(o):
        displace(o, 0.006, 0.05)

    # ---- 胴体 ----
    o = skin('chest', [(0, 0, 0.05), (0, 0.01, 0.22), (0, 0.012, 0.42), (0, 0, 0.55), (0, 0, 0.63),
                       (-0.14, 0, 0.56), (-0.245, 0, 0.555), (0.14, 0, 0.56), (0.245, 0, 0.555)],
             [(0, 1), (1, 2), (2, 3), (3, 4), (3, 5), (5, 6), (3, 7), (7, 8)],
             [(0.162, 0.108), (0.17, 0.115), (0.19, 0.12), (0.165, 0.105), (0.07, 0.065), (0.085, 0.085), (0.072, 0.074), (0.085, 0.085), (0.072, 0.074)])
    subsurf(o, 2)
    wrinkles(o)
    part(o, cloth, torso)
    zip_ = cube('zip', (0.012, 0.01, 0.48), (0, 0.13, 0.32))
    pk1 = cube('pk1', (0.09, 0.012, 0.08), (-0.09, 0.128, 0.36))
    pk2 = cube('pk2', (0.09, 0.012, 0.08), (0.09, 0.128, 0.36))
    for p in (zip_, pk1, pk2):
        bevel(p, 0.004, 2)
        apply_mods(p)
        assign(p, cloth)
    deco = join([zip_, pk1, pk2], 'chestDeco')
    smooth(deco, 40)
    unwrap(deco, 0.35)
    set_parent(deco, torso, (0, 0, 0))
    col = torus('collar', 0.095, 0.03, (0, 0, 0.61), (0, 0, 0), 20, 8)
    scale_mesh(col, (1, 0.85, 1))
    part(col, cloth, torso)
    o = skin('pelvis', [(0, 0, -0.07), (0, 0, 0.1)], [(0, 1)], [(0.165, 0.115), (0.175, 0.12)])
    subsurf(o, 2)
    part(o, pants, torso)
    belt = cylinder('belt', 0.185, 0.05, (0, 0, 0.08), verts=24)
    scale_mesh(belt, (1, 0.68, 1))
    translate(belt, (0, 0.0, 0))
    buckle = cube('buckle', (0.05, 0.012, 0.04), (0, 0.128, 0.08))
    assign(belt, gear)
    assign(buckle, metal)
    belt = join([belt, buckle], 'belt')
    smooth(belt, 35)
    unwrap(belt, 0.3)
    set_parent(belt, torso, (0, 0, 0))
    # ---- オプション（コート・ベスト・背嚢・マフラー） ----
    o = cylinder('opt_coat', 0.235, 0.56, (0, 0, -0.16), verts=32, r2=0.205, fill='NOTHING')
    scale_mesh(o, (1, 0.72, 1))
    delete_verts(o, lambda c: abs(c.x) < 0.03 and c.y > 0)
    solidify(o, 0.012)
    subsurf(o, 1)
    displace(o, 0.012, 0.12)
    part(o, cloth, torso)
    o = skin('opt_vest', [(0, 0.004, 0.18), (0, 0.008, 0.52)], [(0, 1)], [(0.205, 0.138), (0.222, 0.143)])
    subsurf(o, 2)
    apply_mods(o)
    delete_verts(o, lambda c: c.z < 0.17 or c.z > 0.53)
    solidify(o, 0.015)
    part(o, vest, torso)
    pouches = []
    for i, x in enumerate((-0.1, 0, 0.1)):
        p = cube(f'pouch{i}', (0.075, 0.04, 0.09), (x, 0.155, 0.3))
        bevel(p, 0.01, 2)
        apply_mods(p)
        assign(p, vest)
        pouches.append(p)
    pj = join(pouches, 'opt_vestPouch')
    smooth(pj, 40)
    unwrap(pj, 0.3)
    set_parent(pj, torso, (0, 0, 0))
    bag = cube('bag', (0.32, 0.17, 0.42), (0, -0.21, 0.36))
    bevel(bag, 0.04, 3)
    subsurf(bag, 1)
    apply_mods(bag)
    assign(bag, pack)
    roll = cylinder('roll', 0.065, 0.36, (0, -0.21, 0.62), (0, PI / 2, 0), 16)
    assign(roll, pack)
    straps = []
    for x in (-0.1, 0.1):
        s = cube('strap', (0.04, 0.3, 0.012), (x, -0.02, 0.62))
        assign(s, gear)
        straps.append(s)
    pk = join([bag, roll] + straps, 'opt_pack')
    smooth(pk, 40)
    unwrap(pk, 0.35)
    set_parent(pk, torso, (0, 0, 0))
    o = torus('opt_scarf', 0.1, 0.045, (0, 0.005, 0.62), (0, 0, 0), 20, 8)
    scale_mesh(o, (1, 0.85, 1))
    displace(o, 0.01, 0.05)
    part(o, scarf, torso)
    # ---- 頭 ----
    neck = cylinder('neck', 0.055, 0.14, (0, 0, 0.05), verts=12)
    face = uv_sphere('face', 1, (0, 0.005, 0.175), (0.098, 0.112, 0.125), 20, 14)

    def sculpt(c):
        z = c.z - 0.175
        if z < -0.03:
            k = 1 - min(0.35, (-0.03 - z) * 2.6)
            c.x *= k
        if c.y > 0.07 and 0.035 < z < 0.06:
            c.y += 0.006
        for sx in (-1, 1):
            d = math.dist((c.x, c.z), (sx * 0.036, 0.19))
            if c.y > 0.07 and d < 0.03:
                c.y -= (0.03 - d) * 0.35
        return c

    warp(face, sculpt)
    nose = uv_sphere('nose', 1, (0, 0.108, 0.158), (0.017, 0.026, 0.03), 10, 8)
    ears = [uv_sphere('ear', 1, (sx * 0.097, 0.0, 0.17), (0.012, 0.024, 0.034), 10, 8) for sx in (-1, 1)]
    for p in [neck, face, nose] + ears:
        assign(p, skin_m)
    fj = join([neck, face, nose] + ears, 'face')
    subsurf(fj, 1)
    part(fj, skin_m, head, unit=0.25)
    eyes = [uv_sphere('eye', 0.011, (sx * 0.035, 0.093, 0.19), (1, 1, 1), 10, 8) for sx in (-1, 1)]
    mouth = cube('mouth', (0.03, 0.004, 0.004), (0, 0.105, 0.118))
    for p in eyes + [mouth]:
        assign(p, eye)
    ej = join(eyes + [mouth], 'eyes')
    smooth(ej)
    unwrap(ej, 0.2)
    set_parent(ej, head, (0, 0, 0))
    o = uv_sphere('opt_hair', 1, (0, -0.004, 0.182), (0.104, 0.118, 0.13), 20, 14)
    delete_verts(o, lambda c: (c.y > 0.035 and c.z < 0.235) or c.z < 0.125)
    solidify(o, 0.008)
    displace(o, 0.008, 0.03)
    part(o, hair, head, unit=0.2)
    o = uv_sphere('opt_beard', 1, (0, 0.03, 0.105), (0.093, 0.098, 0.075), 18, 12)
    delete_verts(o, lambda c: c.y < 0.0 or c.z > 0.14)
    solidify(o, 0.008)
    displace(o, 0.008, 0.02)
    part(o, beard, head, unit=0.2)
    o = uv_sphere('opt_beanie', 1, (0, -0.004, 0.2), (0.108, 0.12, 0.118), 20, 12)
    delete_verts(o, lambda c: c.z < 0.205)
    rim = torus('rim', 0.106, 0.018, (0, -0.004, 0.215), (0, 0, 0), 24, 8)
    scale_mesh(rim, (1, 1.11, 1))
    translate(rim, (0, 0, 0))
    assign(o, hat)
    assign(rim, hat)
    o = join([o, rim], 'opt_beanie')
    displace(o, 0.004, 0.012)
    part(o, hat, head, unit=0.2)
    o = uv_sphere('opt_helmet', 1, (0, 0, 0.2), (0.128, 0.142, 0.13), 22, 12)
    delete_verts(o, lambda c: c.z < 0.205)
    rim = torus('hrim', 0.13, 0.012, (0, 0, 0.206), (0, 0, 0), 24, 6)
    scale_mesh(rim, (1, 1.1, 1))
    assign(o, helmet)
    assign(rim, helmet)
    o = join([o, rim], 'opt_helmet')
    solidify(o, 0.01)
    part(o, helmet, head, unit=0.3)
    o = uv_sphere('opt_hood', 1, (0, -0.012, 0.17), (0.128, 0.142, 0.155), 22, 14)
    delete_verts(o, lambda c: (c.y > 0.05 and 0.05 < c.z < 0.27) or c.z < 0.04)
    solidify(o, 0.012)
    displace(o, 0.008, 0.06)
    part(o, cloth, head, unit=0.3)
    o = uv_sphere('cap', 1, (0, -0.004, 0.215), (0.106, 0.118, 0.085), 20, 12)
    delete_verts(o, lambda c: c.z < 0.216)
    vis = cylinder('visor', 0.075, 0.01, (0, 0.115, 0.222), verts=20)
    scale_mesh(vis, (1, 0.8, 1))
    translate(vis, (0, 0.02, 0))
    delete_verts(vis, lambda c: c.y < 0.1)
    assign(o, hat)
    assign(vis, hat)
    o = join([o, vis], 'opt_cap')
    solidify(o, 0.006)
    part(o, hat, head, unit=0.2)
    # ガスマスク
    shell = uv_sphere('mshell', 1, (0, 0.022, 0.15), (0.104, 0.104, 0.118), 22, 14)
    delete_verts(shell, lambda c: c.y < 0.03)
    solidify(shell, 0.01)
    apply_mods(shell)
    assign(shell, rubber)
    parts = [shell]
    for sx in (-1, 1):
        r = torus('erim', 0.025, 0.006, (sx * 0.038, 0.118, 0.19), (PI / 2, 0, 0), 20, 6)
        assign(r, gear)
        g = cylinder('eglass', 0.022, 0.004, (sx * 0.038, 0.117, 0.19), (PI / 2, 0, 0), 20)
        assign(g, glass)
        parts += [r, g]
    can = cylinder('filter', 0.04, 0.075, (0, 0.16, 0.095), (PI / 2 - 0.45, 0, 0), 20)
    assign(can, metal)
    for k in range(3):
        rg = torus('rib', 0.041, 0.004, (0, 0.16 + 0.012 * (k - 1) * math.cos(0.45), 0.095 - 0.012 * (k - 1) * math.sin(0.45)), (PI / 2 - 0.45, 0, 0), 20, 4)
        assign(rg, gear)
        parts.append(rg)
    strap = torus('mstrap', 0.112, 0.006, (0, -0.01, 0.19), (0, 0, 0), 24, 4)
    assign(strap, gear)
    parts += [can, strap]
    mk = join(parts, 'opt_mask')
    smooth(mk, 45)
    unwrap(mk, 0.25)
    set_parent(mk, head, (0, 0, 0))
    # ---- 腕 ----
    for s, sx in (('L', -1), ('R', 1)):
        tube('upper' + s, [(0, 0, -0.01), (0, 0, -0.15), (0, 0, -0.3)], [(0.064, 0.066), (0.06, 0.062), (0.051, 0.053)], cloth, sh[s], extra=wrinkles)
        tube('fore' + s, [(0, 0, 0.01), (0, 0.004, -0.24)], [(0.055, 0.056), (0.044, 0.046)], cloth, el[s], extra=wrinkles)
        cuff = torus('cuff' + s, 0.046, 0.012, (0, 0.004, -0.235), (0, 0, 0), 16, 6)
        part(cuff, cloth, el[s])
        for kind, mat in (('skin', skin_m), ('glove', glove)):
            pts = [(0, 0.002, -0.262), (0, 0.006, -0.32), (0, 0.012, -0.375), (-sx * 0.035, 0.03, -0.31)]
            o = skin(f'hand_{kind}{s}', pts, [(0, 1), (1, 2), (1, 3)], [(0.033, 0.022), (0.043, 0.021), (0.036, 0.016), 0.012])
            subsurf(o, 2)
            part(o, mat, el[s], unit=0.2)
    # ---- 脚 ----
    for s in 'LR':
        tube('thigh' + s, [(0, 0, 0.03), (0, 0.004, -0.22), (0, 0, -0.45)], [(0.088, 0.09), (0.08, 0.082), (0.064, 0.066)], pants, hp[s], extra=wrinkles)
        tube('shin' + s, [(0, 0, 0.02), (0, -0.004, -0.31)], [(0.064, 0.066), (0.05, 0.052)], pants, kn[s], extra=wrinkles)
        b = skin('boot' + s, [(0, 0, -0.29), (0, -0.015, -0.43), (0, 0.12, -0.44)], [(0, 1), (1, 2)], [(0.056, 0.06), (0.052, 0.054), (0.046, 0.034)])
        subsurf(b, 2)
        apply_mods(b)
        warp(b, lambda c: Vector((c.x, c.y, max(c.z, -0.468))))
        part(b, boots, kn[s], unit=0.25)
    # ---- 持ち物 ----
    gp = []
    rec = cube('rec', (0.05, 0.075, 0.32), (0, 0.06, -0.42))
    bevel(rec, 0.008, 2)
    apply_mods(rec)
    assign(rec, metal)
    brl = cylinder('brl', 0.013, 0.24, (0, 0.075, -0.69), verts=12)
    assign(brl, metal)
    mag = cube('gmag', (0.03, 0.055, 0.12), (0, -0.005, -0.47))
    warp(mag, lambda c: Vector((c.x, c.y - (c.z + 0.47) * 0.35, c.z)))
    assign(mag, metal)
    stock = cube('gstock', (0.04, 0.06, 0.24), (0, 0.045, -0.16))
    bevel(stock, 0.01, 2)
    apply_mods(stock)
    assign(stock, wood)
    sight = cube('gsight', (0.01, 0.025, 0.012), (0, 0.105, -0.76))
    assign(sight, metal)
    gun = join([rec, brl, mag, stock, sight], 'opt_gun')
    smooth(gun, 35)
    unwrap(gun, 0.25)
    set_parent(gun, el['R'], (0, 0, 0))
    # ギター
    d = Vector((-0.8, 0, 0.6)).normalized()
    b1 = uv_sphere('gb1', 1, (0.07, 0.24, 0.08), (0.17, 0.05, 0.16), 20, 10)
    b2 = uv_sphere('gb2', 1, (0.07 + d.x * 0.17, 0.24, 0.08 + d.z * 0.17), (0.13, 0.048, 0.12), 20, 10)
    nk = cube('gneck', (0.05, 0.025, 0.46), (0, 0, 0))
    rotate(nk, math.atan2(d.x, d.z), (0, 1, 0))
    translate(nk, (0.07 + d.x * 0.5, 0.25, 0.08 + d.z * 0.5))
    hole = cylinder('ghole', 0.04, 0.01, (0.07 + d.x * 0.08, 0.29, 0.08 + d.z * 0.08), (PI / 2, 0, 0), 20)
    for p in (b1, b2, nk):
        assign(p, wood)
    assign(hole, eye)
    gt = join([b1, b2, nk, hole], 'opt_guitar')
    smooth(gt, 40)
    unwrap(gt, 0.3)
    set_parent(gt, torso, (0, 0, 0))
    # ランタン
    fr = cube('lfr', (0.08, 0.08, 0.13), (0, 0.01, -0.44))
    solidify(fr, 0.01)
    apply_mods(fr)
    assign(fr, gear)
    gl = uv_sphere('lgl', 1, (0, 0.01, -0.44), (0.032, 0.032, 0.045), 12, 8)
    assign(gl, glow)
    hd = torus('lhd', 0.03, 0.004, (0, 0.01, -0.36), (PI / 2, 0, 0), 12, 4)
    assign(hd, gear)
    lt = join([fr, gl, hd], 'opt_lantern')
    smooth(lt, 35)
    unwrap(lt, 0.2)
    set_parent(lt, el['L'], (0, 0, 0))
    done('human')


# ================================================================ 変異体
def creature_legs(body, front, hind, front_len, hind_len, skin_m, claw, thick=1.0):
    legs = {}
    for name, pos, is_front, ul, ll in (
        ('FL', (-front[0], front[1], front[2]), True, front_len[0], front_len[1]),
        ('FR', (front[0], front[1], front[2]), True, front_len[0], front_len[1]),
        ('BL', (-hind[0], hind[1], hind[2]), False, hind_len[0], hind_len[1]),
        ('BR', (hind[0], hind[1], hind[2]), False, hind_len[0], hind_len[1]),
    ):
        top = empty('leg' + name, pos, body)
        knee = empty('knee' + name, (0, 0, -ul), top)
        t = thick
        if is_front:
            tube('up' + name, [(0, 0, 0.04), (0, 0.015, -ul * 0.47), (0, 0, -ul)], [(0.085 * t, 0.09 * t), (0.075 * t, 0.08 * t), (0.05 * t, 0.052 * t)], skin_m, top, sub=2, unit=0.5)
            tube('lo' + name, [(0, 0, 0.01), (0, 0.0, -ll * 0.8), (0, 0.06, -ll)], [(0.052 * t, 0.054 * t), (0.04 * t, 0.042 * t), (0.06 * t, 0.035 * t)], skin_m, knee, sub=2, unit=0.5)
            toe_y, toe_z = 0.06, -ll
        else:
            tube('up' + name, [(0, 0, 0.04), (0, -0.05, -ul * 0.5), (0, 0, -ul)], [(0.095 * t, 0.1 * t), (0.08 * t, 0.085 * t), (0.05 * t, 0.052 * t)], skin_m, top, sub=2, unit=0.5)
            tube('lo' + name, [(0, 0, 0.01), (0, -0.06, -ll * 0.55), (0, 0.04, -ll), (0, 0.12, -ll - 0.005)], [(0.05 * t, 0.052 * t), (0.038 * t, 0.04 * t), (0.045 * t, 0.03 * t), (0.028 * t, 0.02 * t)], skin_m, knee, sub=2, unit=0.5)
            toe_y, toe_z = 0.12, -ll - 0.005
        cl = []
        for dx in ((-0.035, -0.012, 0.012, 0.035) if is_front else (-0.024, 0, 0.024)):
            c = cone('claw', 0.012 * t, (0.1 if is_front else 0.075) * t, (0, 0, 0), (0, 0, 0), 6)
            rotate(c, -PI / 2 - 0.5, (1, 0, 0))
            translate(c, (dx * t, toe_y + 0.04, toe_z - 0.01))
            assign(c, claw)
            cl.append(c)
        cj = join(cl, 'claws' + name)
        smooth(cj)
        unwrap(cj, 0.3)
        set_parent(cj, knee, (0, 0, 0))
        legs[name] = (top, knee)
    return legs


def build_mukuro():
    reset_scene()
    skin_m = material('mskin', (0.62, 0.55, 0.52), 0.6)
    claw = material('claw', (0.2, 0.17, 0.14), 0.4)
    teeth = material('teeth', (0.78, 0.74, 0.6), 0.35)
    eye = material('eye', (0.9, 0.95, 0.5), 0.3, 0, (0.9, 0.95, 0.5), 3)
    mouth = material('mouth', (0.08, 0.02, 0.02), 0.6)
    root = empty('root')
    inner = empty('inner', (0, 0, 0), root)
    body = empty('body', (0, 0, 0.72), inner)
    head = empty('head', (0, 0.48, 0.1), body)
    jaw = empty('jaw', (0, 0.05, -0.08), head)
    # 胴体
    pts = [(0, -0.46, -0.08), (0, -0.33, -0.01), (0, -0.15, 0.03), (0, 0.05, 0.08), (0, 0.22, 0.1), (0, 0.32, 0.17), (0, 0.43, 0.14), (0, 0.51, 0.11),
           (-0.15, 0.26, 0.2), (0.15, 0.26, 0.2), (-0.21, 0.31, 0.0), (0.21, 0.31, 0.0), (-0.12, -0.33, 0.07), (0.12, -0.33, 0.07),
           (-0.17, -0.36, -0.02), (0.17, -0.36, -0.02)]
    edges = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 7), (4, 8), (4, 9), (4, 10), (4, 11), (1, 12), (1, 13), (1, 14), (1, 15)]
    radii = [(0.06, 0.06), (0.15, 0.14), (0.13, 0.12), (0.2, 0.19), (0.23, 0.2), (0.17, 0.14), (0.09, 0.085), (0.075, 0.075),
             0.07, 0.07, (0.085, 0.09), (0.085, 0.09), 0.06, 0.06, (0.085, 0.09), (0.085, 0.09)]
    o = skin('torso', pts, edges, radii)
    subsurf(o, 2)
    apply_mods(o)

    def ribs(c):
        # 肋骨・背骨のでこぼこ
        if -0.08 < c.y < 0.28 and c.z < 0.16 and abs(c.x) > 0.06:
            d = Vector((c.x, 0, c.z - 0.06))
            if d.length > 1e-4:
                amp = max(0.0, math.sin((c.y + 0.08) * 2 * PI / 0.06)) ** 4 * 0.02
                c += d.normalized() * amp
        if c.z > 0.16 and abs(c.x) < 0.05:
            c.z += max(0.0, math.sin(c.y * 2 * PI / 0.075)) ** 2 * 0.022
        if c.z < -0.08 and -0.2 < c.y < 0.0:
            c.z += 0.02
        return c

    warp(o, ribs)
    displace(o, 0.012, 0.08)
    part(o, skin_m, body, unit=0.5)
    # とげ（ヌシのみ表示）
    sp = []
    for i in range(7):
        c = cone('spike', 0.035, 0.22, (0, 0, 0), (0, 0, 0), 6)
        rotate(c, -0.45, (1, 0, 0))
        translate(c, ((0.045 if i % 2 else -0.045), -0.3 + i * 0.1, 0.27 + math.sin(i * 0.9) * 0.02))
        assign(c, claw)
        sp.append(c)
    sj = join(sp, 'opt_spikes')
    smooth(sj)
    unwrap(sj, 0.3)
    set_parent(sj, body, (0, 0, 0))
    # 頭蓋
    o = skin('skull', [(0, -0.09, 0.05), (0, 0.04, 0.06), (0, 0.16, 0.03), (0, 0.28, -0.015), (0, 0.34, -0.025)], [(0, 1), (1, 2), (2, 3), (3, 4)],
             [(0.12, 0.12), (0.15, 0.13), (0.12, 0.09), (0.075, 0.06), (0.05, 0.045)])
    subsurf(o, 2)
    apply_mods(o)

    def skull(c):
        for sx in (-1, 1):
            d = math.dist((c.x, c.y, c.z), (sx * 0.08, 0.19, 0.055))
            if d < 0.05:
                c.x -= sx * (0.05 - d) * 0.6
        if c.z > 0.08 and 0.1 < c.y < 0.22:
            c.z += 0.015
        if c.z < -0.05:
            c.z = -0.05 + (c.z + 0.05) * 0.5
        return c

    warp(o, skull)
    ears = []
    for sx in (-1, 1):
        e = cone('ear', 0.03, 0.12, (0, 0, 0), (0, 0, 0), 6)
        rotate(e, -0.8, (1, 0, 0))
        rotate(e, sx * 0.5, (0, 1, 0))
        translate(e, (sx * 0.1, -0.04, 0.12))
        assign(e, skin_m)
        ears.append(e)
    assign(o, skin_m)
    sk = join([o] + ears, 'skull')
    displace(sk, 0.006, 0.04)
    part(sk, skin_m, head, unit=0.4)
    ev = [uv_sphere('eyeball', 0.03, (sx * 0.08, 0.19, 0.05), (1, 0.8, 0.9), 12, 8) for sx in (-1, 1)]
    for e in ev:
        assign(e, eye)
    ej = join(ev, 'eyes')
    smooth(ej)
    unwrap(ej, 0.2)
    set_parent(ej, head, (0, 0, 0))
    mo = uv_sphere('mouthIn', 1, (0, 0.17, -0.055), (0.07, 0.14, 0.04), 12, 8)
    part(mo, mouth, head)
    th = []
    for i in range(7):
        for sx in (-1, 1):
            t = cone('tooth', 0.011, 0.045, (0, 0, 0), (PI, 0, 0), 6)
            translate(t, (sx * (0.058 - i * 0.006), 0.1 + i * 0.03, -0.06))
            assign(t, teeth)
            th.append(t)
    tj = join(th, 'teethU')
    smooth(tj)
    unwrap(tj, 0.2)
    set_parent(tj, head, (0, 0, 0))
    # 下あご
    o = skin('jawbone', [(0, -0.06, 0), (0, 0.13, -0.015), (0, 0.27, 0.0)], [(0, 1), (1, 2)], [(0.085, 0.04), (0.075, 0.035), (0.05, 0.028)])
    subsurf(o, 2)
    part(o, skin_m, jaw, unit=0.4)
    th = []
    for i in range(6):
        for sx in (-1, 1):
            t = cone('toothL', 0.01, 0.04, (0, 0, 0), (0, 0, 0), 6)
            translate(t, (sx * (0.05 - i * 0.006), 0.06 + i * 0.034, 0.03))
            assign(t, teeth)
            th.append(t)
    tj = join(th, 'teethL')
    smooth(tj)
    unwrap(tj, 0.2)
    set_parent(tj, jaw, (0, 0, 0))
    creature_legs(body, (0.22, 0.3, -0.04), (0.2, -0.36, -0.02), (0.36, 0.36), (0.32, 0.38), skin_m, claw)
    done('mukuro')


def build_hagure():
    reset_scene()
    fur = material('fur', (0.27, 0.23, 0.2), 0.95)
    claw = material('claw', (0.12, 0.1, 0.08), 0.4)
    teeth = material('teeth', (0.75, 0.7, 0.58), 0.35)
    eye = material('eye', (1.0, 0.25, 0.15), 0.3, 0, (1, 0.25, 0.15), 3)
    mouth = material('mouth', (0.1, 0.02, 0.02), 0.6)
    root = empty('root')
    inner = empty('inner', (0, 0, 0), root)
    body = empty('body', (0, 0, 0.62), inner)
    head = empty('head', (0, 0.55, 0.1), body)
    jaw = empty('jaw', (0, 0.06, -0.06), head)
    pts = [(0, -0.5, 0.03), (0, -0.36, 0.04), (0, -0.12, 0.01), (0, 0.14, -0.03), (0, 0.3, 0.04), (0, 0.44, 0.1), (0, 0.55, 0.11)]
    radii = [(0.08, 0.08), (0.13, 0.14), (0.12, 0.11), (0.15, 0.2), (0.14, 0.15), (0.085, 0.085), (0.075, 0.075)]
    o = skin('torso', pts, [(i, i + 1) for i in range(len(pts) - 1)], radii)
    subsurf(o, 2)
    apply_mods(o)

    def ribs(c):
        if -0.05 < c.y < 0.25 and c.z < 0.0:
            d = Vector((c.x, 0, c.z + 0.02))
            if d.length > 1e-4:
                c += d.normalized() * max(0.0, math.sin(c.y * 2 * PI / 0.055)) ** 4 * 0.01
        if c.z > 0.12 and abs(c.x) < 0.04:
            c.z += max(0.0, math.sin(c.y * 2 * PI / 0.07)) ** 2 * 0.012
        return c

    warp(o, ribs)
    displace(o, 0.016, 0.03)
    part(o, fur, body, unit=0.4)
    tl = skin('tail', [(0, -0.5, 0.04), (0, -0.66, 0.0), (0, -0.78, -0.12)], [(0, 1), (1, 2)], [0.04, 0.03, 0.015])
    subsurf(tl, 2)
    displace(tl, 0.01, 0.03)
    part(tl, fur, body, unit=0.3)
    o = skin('skull', [(0, -0.06, 0.03), (0, 0.05, 0.03), (0, 0.2, -0.01), (0, 0.31, -0.02)], [(0, 1), (1, 2), (2, 3)], [(0.085, 0.085), (0.095, 0.085), (0.052, 0.048), (0.032, 0.032)])
    subsurf(o, 2)
    ears = []
    for sx in (-1, 1):
        e = cone('ear', 0.035, 0.13, (0, 0, 0), (0, 0, 0), 6)
        rotate(e, -0.35, (1, 0, 0))
        rotate(e, sx * 0.3, (0, 1, 0))
        translate(e, (sx * 0.06, -0.02, 0.14))
        assign(e, fur)
        ears.append(e)
    apply_mods(o)
    assign(o, fur)
    sk = join([o] + ears, 'skull')
    displace(sk, 0.008, 0.03)
    part(sk, fur, head, unit=0.3)
    ev = [uv_sphere('eyeball', 0.02, (sx * 0.06, 0.13, 0.05), (1, 0.8, 0.8), 12, 8) for sx in (-1, 1)]
    for e in ev:
        assign(e, eye)
    ej = join(ev, 'eyes')
    smooth(ej)
    unwrap(ej, 0.2)
    set_parent(ej, head, (0, 0, 0))
    mo = uv_sphere('mouthIn', 1, (0, 0.2, -0.035), (0.035, 0.1, 0.025), 12, 8)
    part(mo, mouth, head)
    th = []
    for i in range(6):
        for sx in (-1, 1):
            t = cone('tooth', 0.007, 0.03, (0, 0, 0), (PI, 0, 0), 6)
            translate(t, (sx * (0.035 - i * 0.004), 0.16 + i * 0.026, -0.038))
            assign(t, teeth)
            th.append(t)
    tj = join(th, 'teethU')
    smooth(tj)
    unwrap(tj, 0.2)
    set_parent(tj, head, (0, 0, 0))
    o = skin('jawbone', [(0, -0.02, 0), (0, 0.12, -0.005), (0, 0.24, 0.0)], [(0, 1), (1, 2)], [(0.05, 0.025), (0.042, 0.022), (0.028, 0.016)])
    subsurf(o, 2)
    part(o, fur, jaw, unit=0.3)
    creature_legs(body, (0.16, 0.3, -0.06), (0.15, -0.36, -0.02), (0.3, 0.32), (0.28, 0.32), fur, claw, thick=0.8)
    done('hagure')


# ================================================================ 一人称の武器
def hand_fist(name, center, mat, pivot):
    cx, cy, cz = center
    o = skin(name, [(cx, cy - 0.01, cz + 0.02), (cx, cy + 0.005, cz - 0.03), (cx - 0.03, cy + 0.03, cz + 0.02)], [(0, 1), (0, 2)], [(0.044, 0.05), (0.04, 0.045), 0.013])
    subsurf(o, 2)
    return part(o, mat, pivot, unit=0.2)


def sleeve(name, a, b, mat, pivot, ra=0.043, rb=0.05):
    o = skin(name, [a, b], [(0, 1)], [ra, rb])
    subsurf(o, 2)
    displace(o, 0.004, 0.04)
    part(o, mat, pivot, unit=0.3)
    d = (Vector(b) - Vector(a)).normalized()
    cf = torus(name + 'Cuff', ra + 0.004, 0.01, (0, 0, 0), (0, 0, 0), 16, 6)
    cf.data.transform(Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4())
    translate(cf, (a[0] + d.x * 0.01, a[1] + d.y * 0.01, a[2] + d.z * 0.01))
    part(cf, mat, pivot, unit=0.3)


def build_weapons():
    reset_scene()
    gun = material('gunmetal', (0.11, 0.115, 0.12), 0.38, 0.85)
    gun2 = material('gunmetal2', (0.2, 0.2, 0.19), 0.5, 0.7)
    wood = material('wood', (0.38, 0.22, 0.11), 0.55)
    glove = material('glove', (0.12, 0.1, 0.09), 0.8)
    sleeve_m = material('sleeve', (0.22, 0.22, 0.18), 0.95)
    dark = material('dark', (0.02, 0.02, 0.02), 0.6)
    tape = material('tape', (0.12, 0.11, 0.09), 0.9)
    blade = material('blade', (0.7, 0.72, 0.74), 0.2, 1.0)
    red = material('red', (0.5, 0.1, 0.06), 0.6)

    def J(objs, name, pivot, unit=0.15, ang=35):
        o = join(objs, name)
        smooth(o, ang)
        unwrap(o, unit)
        set_parent(o, pivot, (0, 0, 0))
        return o

    def bx(name, size, loc, mat, bev=0.004, seg=2):
        o = cube(name, size, loc)
        if bev:
            bevel(o, bev, seg)
            apply_mods(o)
        assign(o, mat)
        return o

    def cy(name, r, depth, loc, mat, axis='Y', verts=16, r2=None):
        rot = {'Y': (PI / 2, 0, 0), 'X': (0, PI / 2, 0), 'Z': (0, 0, 0)}[axis]
        o = cylinder(name, r, depth, loc, rot, verts, r2)
        assign(o, mat)
        return o

    # ---- リボルバー ----
    R = empty('revolver')
    frame = bx('frame', (0.03, 0.14, 0.055), (0, 0.065, 0.03), gun)
    strap = bx('tstrap', (0.022, 0.09, 0.014), (0, 0.07, 0.062), gun)
    barrel = cy('barrel', 0.0125, 0.2, (0, 0.225, 0.05), gun, verts=20)
    rib = bx('rib', (0.014, 0.2, 0.012), (0, 0.225, 0.065), gun, 0.003)
    ejr = cy('ejr', 0.007, 0.12, (0, 0.19, 0.033), gun, verts=12)
    fs = bx('fsight', (0.004, 0.012, 0.012), (0, 0.32, 0.075), gun2, 0)
    ham = bx('hammer', (0.01, 0.025, 0.02), (0, 0.0, 0.07), gun2, 0.002)
    tg = torus('tguard', 0.018, 0.003, (0, 0.045, -0.008), (0, PI / 2, 0), 16, 4)
    assign(tg, gun)
    trig = bx('trigger', (0.005, 0.006, 0.02), (0, 0.04, -0.005), gun2, 0)
    J([frame, strap, barrel, rib, ejr, fs, ham, tg, trig], 'revFrame', R, 0.1)
    grip = skin('grip', [(0, 0.0, 0.008), (0, -0.028, -0.05), (0, -0.044, -0.095)], [(0, 1), (1, 2)], [(0.016, 0.022), (0.017, 0.025), (0.018, 0.026)])
    subsurf(grip, 2)
    part(grip, wood, R, unit=0.08)
    drum = empty('drum', (0, 0.07, 0.03), R)
    dc = cy('drumBody', 0.031, 0.065, (0, 0, 0), gun2, verts=24)
    holes = []
    for i in range(6):
        a = i / 6 * 2 * PI
        holes.append(cy('ch', 0.0065, 0.004, (math.cos(a) * 0.019, 0.033, math.sin(a) * 0.019), dark, verts=10))
        fl = bx('flute', (0.006, 0.04, 0.006), (math.cos(a + PI / 6) * 0.031, 0, math.sin(a + PI / 6) * 0.031), dark, 0)
        holes.append(fl)
    J([dc] + holes, 'drumMesh', drum, 0.1)
    hand_fist('handR', (0.004, -0.03, -0.045), glove, R)
    sleeve('sleeveR', (0.012, -0.07, -0.07), (0.06, -0.46, -0.16), sleeve_m, R)
    empty('muzzle', (0, 0.33, 0.05), R)

    # ---- 継ぎ接ぎ（SMG） ----
    S = empty('smg')
    rec = bx('rec', (0.052, 0.32, 0.075), (0, 0.1, 0.02), gun, 0.006)
    port = bx('port', (0.006, 0.06, 0.025), (0.027, 0.12, 0.035), dark, 0)
    chg = bx('chg', (0.02, 0.012, 0.012), (0.034, 0.06, 0.04), gun2, 0.002)
    shroud = cy('shroud', 0.024, 0.24, (0, 0.38, 0.035), gun2, verts=20)
    tip = cy('tip', 0.01, 0.07, (0, 0.53, 0.035), gun, verts=12)
    parts = [rec, port, chg, shroud, tip]
    for row in range(3):
        for k in range(6):
            a = -PI / 2 + row * (PI / 3)
            parts.append(cy('hole', 0.0045, 0.004, (math.cos(a) * 0.0245, 0.29 + k * 0.035, 0.035 + math.sin(a) * 0.0245), dark, 'X' if row == 1 else 'Z', 8))
    for k in range(4):
        parts.append(cy('tape', 0.0258, 0.018, (0, 0.28 + k * 0.06, 0.035), tape, verts=20))
    for z in (0.0, 0.05):
        parts.append(cy('wire', 0.005, 0.26, (0, -0.17, z), gun2, verts=8))
    parts.append(bx('butt', (0.012, 0.012, 0.08), (0, -0.29, 0.025), gun2, 0.002))
    parts.append(bx('rsight', (0.02, 0.012, 0.025), (0, 0.04, 0.07), gun, 0.003))
    parts.append(bx('fsight', (0.004, 0.012, 0.016), (0, 0.47, 0.065), gun, 0))
    parts.append(bx('pad', (0.06, 0.04, 0.02), (0, -0.03, 0.03), material('canvas', (0.42, 0.36, 0.24), 0.95), 0.004))
    J(parts, 'smgBody', S, 0.12)
    g = bx('sgrip', (0.032, 0.045, 0.1), (0, -0.03, -0.065), wood, 0.008)
    rotate(g, -0.3, (1, 0, 0))
    translate(g, (0, -0.02, -0.02))
    J([g], 'smgGrip', S, 0.08)
    magN = empty('mag', (0, 0.12, -0.09), S)
    m = bx('magBody', (0.03, 0.05, 0.17), (0, 0, 0), gun2, 0.004)
    warp(m, lambda c: Vector((c.x, c.y + (-c.z) * 0.25, c.z)))
    J([m], 'magMesh', magN, 0.1)
    hand_fist('handR', (0.0, -0.04, -0.06), glove, S)
    hand_fist('handL', (-0.01, 0.3, -0.03), glove, S)
    sleeve('sleeveR', (0.01, -0.08, -0.09), (0.07, -0.45, -0.16), sleeve_m, S)
    sleeve('sleeveL', (-0.03, 0.27, -0.06), (-0.22, -0.02, -0.17), sleeve_m, S)
    empty('muzzle', (0, 0.56, 0.035), S)

    # ---- 二連散弾銃「鴉」 ----
    H = empty('shotgun')
    parts = [cy('b1', 0.017, 0.56, (-0.017, 0.32, 0.035), gun, verts=20), cy('b2', 0.017, 0.56, (0.017, 0.32, 0.035), gun, verts=20),
             bx('vrib', (0.01, 0.56, 0.01), (0, 0.32, 0.054), gun, 0.002), bx('recv', (0.055, 0.12, 0.065), (0, 0.02, 0.025), gun2, 0.008),
             cy('bead', 0.003, 0.006, (0, 0.598, 0.062), material('brass', (0.8, 0.6, 0.25), 0.3, 1.0), 'Z', 8)]
    for sx in (-1, 1):
        parts.append(cy('bore', 0.012, 0.004, (sx * 0.017, 0.6, 0.035), dark, verts=14))
    J(parts, 'sgMetal', H, 0.12)
    fe = bx('fore', (0.06, 0.22, 0.035), (0, 0.26, 0.005), wood, 0.012)
    st = skin('stock', [(0, -0.03, 0.01), (0, -0.18, -0.03), (0, -0.33, -0.07)], [(0, 1), (1, 2)], [(0.024, 0.03), (0.022, 0.038), (0.024, 0.05)])
    subsurf(st, 2)
    apply_mods(st)
    assign(st, wood)
    J([fe, st], 'sgWood', H, 0.12)
    hand_fist('handR', (0.0, -0.05, -0.06), glove, H)
    hand_fist('handL', (-0.012, 0.26, -0.035), glove, H)
    sleeve('sleeveR', (0.012, -0.09, -0.09), (0.07, -0.46, -0.16), sleeve_m, H)
    sleeve('sleeveL', (-0.03, 0.23, -0.06), (-0.22, -0.03, -0.17), sleeve_m, H)
    empty('muzzle', (0, 0.62, 0.035), H)

    # ---- ナイフ ----
    K = empty('knife')
    bl = cube('blade', (0.006, 0.2, 0.032), (0, 0.14, 0))

    def taper(c):
        k = (c.y - 0.04) / 0.2
        if k > 0.55:
            c.z = c.z * max(0.05, 1 - (k - 0.55) / 0.45) - (k - 0.55) * 0.01
        if c.z > 0:
            c.x *= 0.4
        return c

    warp(bl, taper)
    assign(bl, blade)
    gd = bx('guard', (0.042, 0.01, 0.014), (0, 0.04, 0), gun2, 0.002)
    hd = cy('handle', 0.012, 0.1, (0, -0.015, 0), tape, verts=12)
    J([bl, gd, hd], 'knifeMesh', K, 0.1, 30)
    hand_fist('handK', (0.0, -0.015, -0.01), glove, K)
    sleeve('sleeveK', (-0.01, -0.06, -0.02), (-0.06, -0.44, -0.06), sleeve_m, K)

    # ---- 手回し充電器 ----
    C = empty('charger')
    J([bx('box', (0.08, 0.1, 0.06), (0, 0, 0), material('olive', (0.25, 0.27, 0.2), 0.7, 0.3), 0.01)], 'chBody', C, 0.1)
    crank = empty('crank', (0.05, 0, 0), C)
    J([bx('arm', (0.01, 0.012, 0.08), (0.005, 0, 0.035), gun2, 0.002), cy('knob', 0.009, 0.03, (0.02, 0, 0.075), red, 'X', 10)], 'crankMesh', crank, 0.1)
    hand_fist('handC', (-0.02, -0.0, -0.06), glove, C)
    sleeve('sleeveC', (-0.04, -0.04, -0.09), (-0.12, -0.42, -0.14), sleeve_m, C)

    # ---- パイプ爆弾 ----
    B = empty('bomb')
    J([cy('pipe', 0.026, 0.14, (0, 0, 0), gun2, verts=16), cy('cap1', 0.03, 0.02, (0, 0.075, 0), gun, verts=16), cy('cap2', 0.03, 0.02, (0, -0.075, 0), gun, verts=16),
       cy('fuse', 0.003, 0.05, (0, 0.105, 0.012), material('fuse', (0.75, 0.6, 0.35), 0.8), verts=6)], 'bombMesh', B, 0.1)
    hand_fist('handB', (0.0, -0.02, -0.035), glove, B)
    sleeve('sleeveB', (0.02, -0.06, -0.06), (0.04, -0.44, -0.12), sleeve_m, B)
    done('weapons')


# ================================================================ 小道具
def build_props():
    reset_scene()
    random.seed(7)
    paint = material('barrel', (0.6, 0.6, 0.6), 0.55, 0.45)
    crate_m = material('crate', (0.6, 0.45, 0.3), 0.85)
    burlap = material('sandbag', (0.55, 0.48, 0.34), 1.0)
    rock = material('rock', (0.45, 0.43, 0.4), 0.95)
    body_m = material('carbody', (0.5, 0.5, 0.48), 0.5, 0.4)
    stripe = material('stripe', (0.6, 0.45, 0.15), 0.55, 0.3)
    inner = material('interior', (0.55, 0.55, 0.5), 0.9)
    seat = material('seat', (0.4, 0.18, 0.12), 0.95)
    floor_m = material('carfloor', (0.2, 0.2, 0.18), 0.9)
    metal = material('metal', (0.2, 0.2, 0.2), 0.5, 0.8)
    glass = material('glass', (0.05, 0.07, 0.08), 0.08, 0.6)
    rubber = material('tire', (0.05, 0.05, 0.05), 0.9)
    ash = material('ash', (0.55, 0.54, 0.5), 1.0)
    light = material('headlight', (0.7, 0.7, 0.65), 0.2, 0.2)

    # ---- ドラム缶 ----
    P = empty('barrel')
    b = cylinder('drum', 0.3, 0.9, (0, 0, 0.45), verts=28)
    parts = [b]
    for z in (0.04, 0.3, 0.6, 0.86):
        t = torus('ring', 0.302, 0.009, (0, 0, z), (0, 0, 0), 28, 6)
        parts.append(t)
    parts.append(cylinder('bung', 0.035, 0.02, (0.17, 0.0, 0.905), verts=10))
    for p in parts:
        assign(p, paint)
    o = join(parts, 'barrelMesh')
    displace(o, 0.006, 0.15)
    apply_mods(o)
    smooth(o, 40)
    unwrap(o, 0.6)
    set_parent(o, P, (0, 0, 0))

    # ---- 木箱（1m 立方。実行時に拡大縮小） ----
    P = empty('crate')
    boards = []
    t = 0.07
    for x in (-0.5 + t / 2, 0.5 - t / 2):
        for y in (-0.5 + t / 2, 0.5 - t / 2):
            boards.append(cube('post', (t, t, 1), (x, y, 0.5)))
    for z in (t / 2, 1 - t / 2):
        for x in (-0.5 + t / 2, 0.5 - t / 2):
            boards.append(cube('rail', (t, 1 - 2 * t, t), (x, 0, z)))
        for y in (-0.5 + t / 2, 0.5 - t / 2):
            boards.append(cube('rail', (1 - 2 * t, t, t), (0, y, z)))
    for axis in range(4):
        for k in range(3):
            h = (1 - 2 * t) / 3
            z = t + h * (k + 0.5)
            if axis < 2:
                boards.append(cube('plank', (1 - 2 * t, 0.03, h - 0.012), (0, (0.485 if axis else -0.485), z)))
            else:
                boards.append(cube('plank', (0.03, 1 - 2 * t, h - 0.012), ((0.485 if axis == 3 else -0.485), 0, z)))
    for k in range(3):
        boards.append(cube('lid', (1 - 2 * t, (1 - 2 * t) / 3 - 0.01, 0.03), (0, -0.5 + t + (1 - 2 * t) / 3 * (k + 0.5), 0.985)))
    for p in boards:
        bevel(p, 0.006, 1)
        apply_mods(p)
        assign(p, crate_m)
    o = join(boards, 'crateMesh')
    smooth(o, 30)
    unwrap(o, 0.5)
    set_parent(o, P, (0, 0, 0))

    # ---- 土嚢 ----
    P = empty('sandbag')
    s = cube('bag', (0.56, 0.34, 0.2), (0, 0, 0.1))
    subsurf(s, 3)
    apply_mods(s)

    def pillow(c):
        k = abs(c.x) / 0.28
        c.y *= 1 - 0.35 * k ** 3
        c.z = 0.1 + (c.z - 0.1) * (1 - 0.5 * k ** 3)
        if c.z < 0.02:
            c.z = 0.02 + (c.z - 0.02) * 0.3
        return c

    warp(s, pillow)
    displace(s, 0.012, 0.06)
    finish(s, burlap, unit=0.4)
    set_parent(s, P, (0, 0, 0))

    # ---- 岩（瓦礫用に 3 種） ----
    for i in range(3):
        P = empty(f'rock{i}')
        r = ico(f'rockMesh{i}', 0.5, (0, 0, 0), 3)
        scale_mesh(r, (1.0 + 0.3 * i, 0.8, 0.65 - 0.1 * i))
        displace(r, 0.22, 0.6 + 0.2 * i, 'CLOUDS', 2)
        displace(r, 0.06, 0.15, 'VORONOI')
        finish(r, rock, unit=0.6, smooth_angle=35)
        set_parent(r, P, (0, 0, 0))

    # ---- 地下鉄車両（長さ 18m） ----
    P = empty('trainCar')
    L, W, H, F = 18.0, 2.8, 3.4, 1.0
    prof = [(-W / 2, 0.92), (-W / 2, 3.05), (-W / 2 + 0.25, 3.32), (-0.7, 3.43), (0.7, 3.43), (W / 2 - 0.25, 3.32), (W / 2, 3.05), (W / 2, 0.92)]
    verts = [(x, y, z) for y in (-L / 2, L / 2) for (x, z) in prof]
    n = len(prof)
    faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
    from blender_common import mesh_obj
    shell = mesh_obj('shell', verts, faces)
    # 窓と扉の開口部
    cuts = []
    for sx in (-1, 1):
        for i in range(6):
            y = -L / 2 + 1.9 + i * 2.84
            cuts.append(cube('win', (0.4, 1.5, 0.95), (sx * W / 2, y, 2.05)))
    solidify(shell, 0.06)
    apply_mods(shell)
    for c in cuts:
        m = shell.modifiers.new('cut', 'BOOLEAN')
        m.object = c
        m.operation = 'DIFFERENCE'
        try:
            m.solver = 'EXACT'
        except Exception:
            pass
    apply_mods(shell)
    for c in cuts:
        bpy_remove(c)
    smooth(shell, 30)
    assign(shell, body_m)
    unwrap(shell, 2.0)
    set_parent(shell, P, (0, 0, 0))
    deco = []
    for sx in (-1, 1):
        deco.append(cube('stripe', (0.02, L, 0.12), (sx * (W / 2 + 0.035), 0, 1.55)))
    for d in deco:
        assign(d, stripe)
    sj = join(deco, 'stripe')
    unwrap(sj, 1.0)
    set_parent(sj, P, (0, 0, 0))
    ins = [cube('floor', (W - 0.1, L - 0.1, 0.06), (0, 0, F))]
    for sz in (-1, 1):
        for x in (-0.95, 0.95):
            ins.append(cube('end', (0.9, 0.06, H - F - 0.1), (x, sz * (L / 2 - 0.05), F + (H - F) / 2)))
        ins.append(cube('endTop', (1.0, 0.06, 0.5), (0, sz * (L / 2 - 0.05), H - 0.3)))
    under = [cube('under', (W - 0.3, L - 1.0, 0.25), (0, 0, 0.82))]
    for sz in (-1, 1):
        under.append(cube('bogie', (2.0, 2.6, 0.3), (0, sz * (L / 2 - 2.6), 0.55)))
        for sy in (-1, 1):
            for sx in (-1, 1):
                w = cylinder('wheel', 0.42, 0.12, (sx * 0.72, sz * (L / 2 - 2.6) + sy * 0.9, 0.42), (0, PI / 2, 0), 20)
                under.append(w)
    for p in ins:
        assign(p, floor_m if p.name.startswith('floor') else body_m)
    fl = join(ins, 'carInner')
    smooth(fl, 30)
    unwrap(fl, 1.5)
    set_parent(fl, P, (0, 0, 0))
    for p in under:
        assign(p, metal)
    uj = join(under, 'carUnder')
    smooth(uj, 30)
    unwrap(uj, 1.0)
    set_parent(uj, P, (0, 0, 0))
    seats = []
    for sx in (-1, 1):
        for i in range(3):
            y = -L / 2 + 2.5 + i * ((L - 5) / 2)
            s1 = cube('seat', (0.5, 3.2, 0.12), (sx * 1.05, y, F + 0.42))
            s2 = cube('back', (0.12, 3.2, 0.5), (sx * 1.27, y, F + 0.72))
            for s in (s1, s2):
                bevel(s, 0.03, 2)
                apply_mods(s)
                seats.append(s)
    for s in seats:
        assign(s, seat)
    st = join(seats, 'seats')
    smooth(st, 30)
    unwrap(st, 0.6)
    set_parent(st, P, (0, 0, 0))
    poles = []
    for sx in (-1, 1):
        poles.append(cylinder('rail', 0.018, L - 1, (sx * 0.7, 0, H - 0.45), (PI / 2, 0, 0), 8))
        for i in range(5):
            poles.append(cylinder('pole', 0.02, H - F - 0.2, (sx * 0.62, -L / 2 + 2 + i * 3.5, F + (H - F) / 2), (0, 0, 0), 8))
    for p in poles:
        assign(p, metal)
    pj = join(poles, 'poles')
    smooth(pj)
    unwrap(pj, 0.5)
    set_parent(pj, P, (0, 0, 0))
    panes = []
    for sx in (-1, 1):
        for i in range(6):
            if random.random() < 0.35:
                continue
            y = -L / 2 + 1.9 + i * 2.84
            panes.append(cube('pane', (0.01, 1.5, 0.95), (sx * (W / 2 - 0.02), y, 2.05)))
    for p in panes:
        assign(p, glass)
    gj = join(panes, 'panes')
    unwrap(gj, 1.0)
    set_parent(gj, P, (0, 0, 0))
    inner_lin = cube('lining', (W - 0.16, L - 0.2, 0.02), (0, 0, H - 0.04))
    part(inner_lin, inner, P, unit=1.0)

    # ---- 乗用車（廃車） ----
    P = empty('car')
    lower = cube('lower', (1.8, 4.2, 0.62), (0, 0, 0.6))
    bevel(lower, 0.08, 3)
    cab = cube('cab', (1.62, 2.2, 0.56), (0, -0.15, 1.18))
    warp(cab, lambda c: Vector((c.x * (0.86 if c.z > 1.2 else 1.0), c.y * (0.82 if c.z > 1.2 else 1.0), c.z)))
    bevel(cab, 0.06, 3)
    for p in (lower, cab):
        apply_mods(p)
        assign(p, body_m)
    bj = join([lower, cab], 'carBody')
    displace(bj, 0.02, 0.4)
    apply_mods(bj)
    smooth(bj, 35)
    unwrap(bj, 1.0)
    set_parent(bj, P, (0, 0, 0))
    gl = []
    for sx in (-1, 1):
        gl.append(cube('sidewin', (0.02, 1.8, 0.38), (sx * 0.765, -0.15, 1.2)))
    gl.append(cube('front', (1.3, 0.02, 0.36), (0, 0.84, 1.2)))
    gl.append(cube('rear', (1.3, 0.02, 0.34), (0, -1.12, 1.2)))
    for p in gl:
        assign(p, glass)
    gj = join(gl, 'carGlass')
    unwrap(gj, 1.0)
    set_parent(gj, P, (0, 0, 0))
    wh = []
    for x, y in ((-0.82, 1.3), (0.82, 1.3), (-0.82, -1.3), (0.82, -1.3)):
        wh.append(cylinder('tire', 0.33, 0.24, (x, y, 0.33), (0, PI / 2, 0), 20))
    for p in wh:
        assign(p, rubber)
    hl = [cylinder('hl', 0.08, 0.04, (sx * 0.62, 2.1, 0.72), (PI / 2, 0, 0), 14) for sx in (-1, 1)]
    for p in hl:
        assign(p, light)
    wj = join(wh + hl, 'carWheels')
    smooth(wj, 30)
    unwrap(wj, 0.5)
    set_parent(wj, P, (0, 0, 0))
    a1 = cube('ashRoof', (1.3, 1.7, 0.04), (0, -0.15, 1.47))
    a2 = cube('ashHood', (1.6, 1.0, 0.04), (0, 1.5, 0.93))
    for a in (a1, a2):
        subsurf(a, 2)
        displace(a, 0.03, 0.15)
        apply_mods(a)
        assign(a, ash)
    aj = join([a1, a2], 'carAsh')
    smooth(aj)
    unwrap(aj, 0.5)
    set_parent(aj, P, (0, 0, 0))
    done('props')


def bpy_remove(o):
    import bpy
    bpy.data.objects.remove(o, do_unlink=True)


if __name__ == '__main__':
    which = sys.argv[2].split(',') if len(sys.argv) > 2 else ['human', 'mukuro', 'hagure', 'weapons', 'props']
    for w in which:
        globals()['build_' + w]()
