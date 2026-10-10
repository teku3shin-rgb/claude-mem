"""人物のテクスチャをシェーダーノードで描き、Cycles で体の UV 配置の 1 枚に焼く。

座標はオブジェクト空間（基本姿勢の体）を使うので、UV の島の境目でも模様がつながる。
服の縁からの距離（属性 bd）や腕・脚に沿った位置（属性 tlimb）も使って、縫い目や肘の擦れを描く。
"""
import os

import bpy
import numpy as np


# ------------------------------------------------------------ ノード組み立ての小道具
class NB:
    def __init__(self, mat):
        self.m = mat
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.L = self.nt.links
        self.x = 0
        self._co = None

    def node(self, kind, **inputs):
        n = self.nt.nodes.new(kind)
        n.location = (self.x, 0)
        self.x += 30
        for k, v in inputs.items():
            self.set(n, k, v)
        return n

    def set(self, n, k, v):
        sock = n.inputs[k]
        if hasattr(v, 'is_output') or isinstance(v, bpy.types.NodeSocket):
            self.L.new(v, sock)
        else:
            sock.default_value = v

    def co(self):
        if self._co is None:
            self._co = self.node('ShaderNodeTexCoord').outputs['Object']
        return self._co

    def attr(self, name):
        n = self.node('ShaderNodeAttribute')
        n.attribute_type = 'GEOMETRY'
        n.attribute_name = name
        return n.outputs['Fac']

    def uv_image(self, img):
        n = self.node('ShaderNodeTexImage')
        n.image = img
        n.interpolation = 'Linear'
        return n.outputs['Color']

    def math(self, op, a, b=0.0, clamp=False):
        n = self.node('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        self.set(n, 0, a)
        self.set(n, 1, b)
        return n.outputs[0]

    def vmath(self, op, a, b=(0, 0, 0)):
        n = self.node('ShaderNodeVectorMath')
        n.operation = op
        self.set(n, 0, a)
        self.set(n, 1, b)
        return n.outputs['Value'] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else n.outputs['Vector']

    def sep(self, v):
        n = self.node('ShaderNodeSeparateXYZ')
        self.set(n, 0, v)
        return n.outputs['X'], n.outputs['Y'], n.outputs['Z']

    def xyz(self, x, y, z):
        n = self.node('ShaderNodeCombineXYZ')
        for i, v in enumerate((x, y, z)):
            self.set(n, i, v)
        return n.outputs[0]

    def noise(self, vec, scale, detail=2.0, rough=0.5, dist=0.0, w=None):
        n = self.node('ShaderNodeTexNoise')
        if w is not None:
            n.noise_dimensions = '4D'
            self.set(n, 'W', w)
        self.set(n, 'Vector', vec)
        self.set(n, 'Scale', scale)
        self.set(n, 'Detail', detail)
        self.set(n, 'Roughness', rough)
        self.set(n, 'Distortion', dist)
        return n.outputs['Fac']

    def voronoi(self, vec, scale, feature='F1', out='Distance'):
        n = self.node('ShaderNodeTexVoronoi')
        n.feature = feature
        self.set(n, 'Vector', vec)
        self.set(n, 'Scale', scale)
        return n.outputs[out]

    def ramp(self, fac, a, b, lo=0.0, hi=1.0):
        """lo..hi を 0..1 にのばして a..b の色を返す。"""
        n = self.node('ShaderNodeMapRange')
        n.clamp = True
        self.set(n, 'Value', fac)
        self.set(n, 'From Min', lo)
        self.set(n, 'From Max', hi)
        return self.mix(n.outputs[0], a, b)

    def maprange(self, fac, lo, hi, to_lo=0.0, to_hi=1.0):
        n = self.node('ShaderNodeMapRange')
        n.clamp = True
        self.set(n, 'Value', fac)
        self.set(n, 'From Min', lo)
        self.set(n, 'From Max', hi)
        self.set(n, 'To Min', to_lo)
        self.set(n, 'To Max', to_hi)
        return n.outputs[0]

    def mix(self, fac, a, b, blend='MIX'):
        n = self.node('ShaderNodeMix')
        n.data_type = 'RGBA'
        n.blend_type = blend
        n.clamp_result = True
        self.set(n, 'Factor', fac)
        self.set(n, 6, a if not isinstance(a, tuple) or len(a) == 4 else (*a, 1.0))
        self.set(n, 7, b if not isinstance(b, tuple) or len(b) == 4 else (*b, 1.0))
        return n.outputs[2]

    def bsdf(self, color, rough, height=None, bump=1.0, dist=0.002, metal=0.0):
        p = self.node('ShaderNodeBsdfPrincipled')
        self.set(p, 'Base Color', color)
        self.set(p, 'Roughness', rough)
        self.set(p, 'Metallic', metal)
        if height is not None:
            b = self.node('ShaderNodeBump')
            self.set(b, 'Height', height)
            self.set(b, 'Strength', bump)
            self.set(b, 'Distance', dist)
            self.L.new(b.outputs['Normal'], p.inputs['Normal'])
        out = self.node('ShaderNodeOutputMaterial')
        self.L.new(p.outputs['BSDF'], out.inputs['Surface'])
        return p


def col(c):
    return (*c, 1.0) if len(c) == 3 else c


def srgb(h):
    """0xRRGGBB を Blender のリニア色に。"""
    def f(x):
        x /= 255
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return (f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255))


def shade(c, k):
    return tuple(min(1.0, x * k) for x in c)


# ------------------------------------------------------------ 素材
def skin_mat(name, o, masks):
    """肌。o: tone, red, age(0..1), dirt, stubble, brow, lip"""
    m = bpy.data.materials.new(name)
    g = NB(m)
    P = g.co()
    tone = o['tone']
    c = col(tone)
    mott = g.noise(P, 14.0, 3.0, 0.55)
    c = g.mix(g.maprange(mott, 0.35, 0.7, 0.0, 0.22), c, col(shade(tone, 0.82)))
    blot = g.noise(P, 40.0, 2.0, 0.6)
    c = g.mix(g.maprange(blot, 0.5, 0.75, 0.0, 0.18), c, col((tone[0] * 1.05, tone[1] * 0.78, tone[2] * 0.72)))
    speck = g.noise(P, 380.0, 1.0, 0.5)
    c = g.mix(g.maprange(speck, 0.55, 0.8, 0.0, 0.12), c, col(shade(tone, 0.7)))
    red = col((tone[0] * 1.08, tone[1] * 0.72, tone[2] * 0.68))
    c = g.mix(g.math('MULTIPLY', g.uv_image(masks['cheeks']), o.get('red', 0.35)), c, red)
    c = g.mix(g.math('MULTIPLY', g.uv_image(masks['ears']), 0.35), c, red)
    lip = col(o.get('lip', (tone[0] * 0.85, tone[1] * 0.5, tone[2] * 0.48)))
    c = g.mix(g.math('MULTIPLY', g.uv_image(masks['lips']), 0.85), c, lip)
    c = g.mix(g.math('MULTIPLY', g.uv_image(masks['eyelids']), 0.55), c, col(shade(tone, 0.45)))
    c = g.mix(g.math('MULTIPLY', g.uv_image(masks['fingernails']), 0.6), c, col((tone[0] * 1.05, tone[1] * 0.85, tone[2] * 0.8)))
    # 無精ひげ
    if o.get('stubble', 0) > 0:
        st = g.noise(P, 900.0, 0.0, 0.5)
        dots = g.maprange(st, 0.5, 0.62)
        amt = g.math('MULTIPLY', g.uv_image(masks['beard']), o['stubble'])
        c = g.mix(g.math('MULTIPLY', dots, amt), c, col(o.get('stubble_col', (0.05, 0.045, 0.045))))
        c = g.mix(g.math('MULTIPLY', amt, 0.25), c, col(shade(tone, 0.72)))
    # 眉
    bn = g.noise(g.vmath('MULTIPLY', P, (1.0, 1.0, 3.0)), 700.0, 1.0, 0.5)
    brow = g.math('MULTIPLY', g.uv_image(masks['brows']), g.maprange(bn, 0.3, 0.55, 0.55, 1.0))
    c = g.mix(brow, c, col(o.get('brow', (0.03, 0.025, 0.02))))
    # 汚れ（煤）
    if o.get('dirt', 0) > 0:
        d = g.noise(P, 7.0, 4.0, 0.6)
        dm = g.math('MULTIPLY', g.maprange(d, 0.5, 0.72), o['dirt'])
        c = g.mix(dm, c, col((0.12, 0.1, 0.085)))
    # 凹凸: 毛穴、年齢のしわ
    h = g.math('MULTIPLY', g.noise(P, 450.0, 1.0, 0.5), 0.3)
    if o.get('age', 0) > 0:
        z = g.sep(P)[2]
        lines = g.math('SINE', g.math('MULTIPLY', z, 900.0))
        wr = g.math('MULTIPLY', g.math('MULTIPLY', g.uv_image(masks['forehead']), lines), o['age'] * 0.6)
        h = g.math('ADD', h, wr)
        h = g.math('ADD', h, g.math('MULTIPLY', g.noise(P, 120.0, 3.0, 0.7, 0.4), o['age'] * 0.6))
    rough = g.math('ADD', 0.5, g.math('MULTIPLY', g.noise(P, 30.0, 2.0, 0.5), 0.2))
    g.bsdf(c, rough, h, 0.25, 0.0015)
    return m


def fabric_mat(name, o):
    """布。o: color, kind(plain/check/quilt/rib/canvas/denim), wear, dirt, mud, zip, buttons, pockets, seam"""
    m = bpy.data.materials.new(name)
    g = NB(m)
    P = g.co()
    x, y, z = g.sep(P)
    base = o['color']
    c = col(base)
    mott = g.noise(P, 6.0, 3.0, 0.6)
    c = g.mix(g.maprange(mott, 0.3, 0.7), col(shade(base, 0.82)), col(shade(base, 1.12)))
    fine = g.noise(P, 220.0, 2.0, 0.6)
    c = g.mix(g.maprange(fine, 0.3, 0.7, 0.0, 0.25), c, col(shade(base, 1.25)))
    h = g.math('MULTIPLY', fine, 0.15)
    kind = o.get('kind', 'plain')
    if kind == 'check':
        a = g.math('ABSOLUTE', g.math('SINE', g.math('MULTIPLY', x, 70.0)))
        b = g.math('ABSOLUTE', g.math('SINE', g.math('MULTIPLY', z, 70.0)))
        line = g.math('MAXIMUM', g.maprange(a, 0.82, 0.95), g.maprange(b, 0.82, 0.95))
        c = g.mix(g.math('MULTIPLY', line, 0.55), c, col(o.get('check', shade(base, 0.55))))
    elif kind == 'quilt':
        k = 38.0
        d1 = g.math('ABSOLUTE', g.math('SINE', g.math('MULTIPLY', g.math('ADD', x, z), k)))
        d2 = g.math('ABSOLUTE', g.math('SINE', g.math('MULTIPLY', g.math('SUBTRACT', x, z), k)))
        q = g.math('MINIMUM', d1, d2)
        h = g.math('ADD', h, g.math('MULTIPLY', g.maprange(q, 0.0, 0.35), 1.5))
        c = g.mix(g.maprange(q, 0.0, 0.12, 0.35, 0.0), c, col(shade(base, 0.6)))
    elif kind == 'rib':
        az = g.math('ARCTAN2', x, g.math('SUBTRACT', y, o.get('cy', 0.0)))
        r = g.math('SINE', g.math('MULTIPLY', az, o.get('ribs', 60.0)))
        h = g.math('ADD', h, g.math('MULTIPLY', r, 0.6))
        c = g.mix(g.maprange(r, -1, 1, 0.0, 0.2), c, col(shade(base, 0.75)))
    elif kind in ('denim', 'canvas'):
        tw = g.math('SINE', g.math('MULTIPLY', g.math('ADD', z, g.math('MULTIPLY', x, 0.6)), 900.0))
        h = g.math('ADD', h, g.math('MULTIPLY', tw, 0.15))
        c = g.mix(g.maprange(tw, -1, 1, 0.0, 0.12), c, col(shade(base, 1.3)))
    # 肘・膝の擦れ
    t = g.attr('tlimb')
    knee = g.math('SUBTRACT', 1.0, g.math('MULTIPLY', g.math('ABSOLUTE', g.math('SUBTRACT', t, 1.0)), 6.0), True)
    wear = g.math('MULTIPLY', g.math('MULTIPLY', knee, g.maprange(g.noise(P, 18.0, 3.0, 0.6), 0.4, 0.7)), o.get('wear', 0.4))
    c = g.mix(wear, c, col(tuple(min(1, v * 1.35 + 0.03) for v in base)))
    # 縁（裾・袖口）の縫い代と縫い目
    bd = g.attr('bd')
    hem = g.maprange(bd, 0.006, 0.014, 1.0, 0.0)
    c = g.mix(g.math('MULTIPLY', hem, 0.25), c, col(shade(base, 0.7)))
    stitch = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bd, 0.016)), 0.0, 0.0012, 1.0, 0.0),
                    g.maprange(g.math('SINE', g.math('MULTIPLY', g.math('ADD', g.math('ADD', x, y), z), 1400.0)), -0.2, 0.4))
    c = g.mix(g.math('MULTIPLY', stitch, o.get('seam', 0.5)), c, col(shade(base, 1.6)))
    h = g.math('SUBTRACT', h, g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bd, 0.012)), 0.0, 0.002, 1.0, 0.0), 0.6))
    # 前立て（ファスナー / ボタン）
    front = g.maprange(y, 0.02, 0.06)
    if o.get('zip'):
        zl = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', x), 0.0, 0.007, 1.0, 0.0), front)
        teeth = g.maprange(g.math('SINE', g.math('MULTIPLY', z, 1500.0)), -0.3, 0.3)
        c = g.mix(zl, c, g.mix(teeth, col((0.04, 0.04, 0.04)), col((0.25, 0.24, 0.22))))
        h = g.math('SUBTRACT', h, g.math('MULTIPLY', zl, 0.6))
    if o.get('buttons'):
        bz = g.math('FRACT', g.math('MULTIPLY', z, 10.0))
        bpos = g.xyz(g.math('SUBTRACT', g.math('ABSOLUTE', x), 0.035), 0.0, g.math('MULTIPLY', g.math('SUBTRACT', bz, 0.5), 0.1))
        bdist = g.vmath('LENGTH', bpos)
        btn = g.math('MULTIPLY', g.maprange(bdist, 0.008, 0.011, 1.0, 0.0), front)
        c = g.mix(btn, c, col((0.05, 0.045, 0.04)))
        h = g.math('ADD', h, g.math('MULTIPLY', btn, 1.0))
        pl = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', g.math('ABSOLUTE', x), 0.012)), 0.0, 0.0015, 1.0, 0.0), front)
        c = g.mix(g.math('MULTIPLY', pl, 0.6), c, col(shade(base, 0.55)))
    for (cx, cz, w, hh) in o.get('pockets', []):
        # 正面のポケット（中心 x, z と幅・高さ）。左右対称に置く
        dx = g.math('ABSOLUTE', g.math('SUBTRACT', g.math('ABSOLUTE', x), cx))
        dz = g.math('ABSOLUTE', g.math('SUBTRACT', z, cz))
        edge = g.math('MAXIMUM', g.math('SUBTRACT', dx, w / 2), g.math('SUBTRACT', dz, hh / 2))
        outline = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', edge), 0.0, 0.0018, 1.0, 0.0), front)
        flap = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', z, cz + hh / 2 - 0.018)), 0.0, 0.0015, 1.0, 0.0),
                      g.math('MULTIPLY', g.maprange(dx, w / 2, w / 2 + 0.001, 1.0, 0.0), front))
        line = g.math('MAXIMUM', outline, flap)
        c = g.mix(g.math('MULTIPLY', line, 0.7), c, col(shade(base, 0.5)))
        h = g.math('SUBTRACT', h, g.math('MULTIPLY', line, 0.8))
    # 腕章（赤環の印など）: 上腕の帯
    if o.get('armband'):
        z0, z1 = o['armband_z']
        band = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', x), 0.15, 0.17),
                      g.math('MULTIPLY', g.maprange(z, z0 - 0.004, z0), g.maprange(z, z1, z1 + 0.004, 1.0, 0.0)))
        c = g.mix(band, c, g.mix(g.maprange(g.noise(P, 30.0, 2.0, 0.6), 0.3, 0.7), col(o['armband']), col(shade(o['armband'], 0.7))))
    # 汚れ・泥（下ほど濃い）
    d = g.noise(P, 5.0, 4.0, 0.6)
    dirt = g.math('MULTIPLY', g.maprange(d, 0.48, 0.75), o.get('dirt', 0.35))
    c = g.mix(dirt, c, col((0.09, 0.08, 0.065)))
    if o.get('mud', 0):
        mud = g.math('MULTIPLY', g.maprange(z, 0.45, 0.05), g.maprange(g.noise(P, 9.0, 3.0, 0.6), 0.35, 0.6))
        c = g.mix(g.math('MULTIPLY', mud, o['mud']), c, col((0.13, 0.11, 0.085)))
    # しわ（大きな折り目は形で、細かいものはここで）
    wr = g.noise(g.vmath('MULTIPLY', P, (1.0, 1.0, 2.2)), 26.0, 3.0, 0.55, 0.3)
    h = g.math('ADD', h, g.math('MULTIPLY', wr, 1.2))
    rough = o.get('rough', 0.9)
    g.bsdf(c, rough, h, o.get('bump', 0.35), 0.003)
    return m


def leather_mat(name, o):
    m = bpy.data.materials.new(name)
    g = NB(m)
    P = g.co()
    x, y, z = g.sep(P)
    base = o['color']
    c = g.mix(g.maprange(g.noise(P, 10.0, 3.0, 0.6), 0.3, 0.7), col(shade(base, 0.8)), col(shade(base, 1.2)))
    crease = g.noise(g.vmath('MULTIPLY', P, (1.0, 1.0, 3.0)), 60.0, 3.0, 0.6, 0.6)
    scuff = g.maprange(g.noise(P, 35.0, 2.0, 0.7), 0.6, 0.72)
    c = g.mix(g.math('MULTIPLY', scuff, 0.45), c, col(tuple(min(1, v * 1.8 + 0.04) for v in base)))
    h = g.math('ADD', g.math('MULTIPLY', crease, 0.8), g.math('MULTIPLY', g.noise(P, 300.0, 1.0, 0.5), 0.2))
    if o.get('boot'):
        sole = g.maprange(z, 0.035, 0.025)
        c = g.mix(sole, c, col((0.025, 0.022, 0.02)))
        lace = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SINE', g.math('MULTIPLY', z, 320.0))), 0.85, 0.95),
                      g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', g.math('ABSOLUTE', x), 0.1)), 0.012, 0.004),
                                 g.math('MULTIPLY', g.maprange(z, 0.06, 0.08), g.maprange(z, 0.2, 0.18))))
        c = g.mix(lace, c, col((0.06, 0.05, 0.04)))
        mud = g.math('MULTIPLY', g.maprange(z, 0.12, 0.02), g.maprange(g.noise(P, 12.0, 3.0, 0.6), 0.3, 0.55))
        c = g.mix(g.math('MULTIPLY', mud, 0.7), c, col((0.12, 0.1, 0.08)))
    bd = g.attr('bd')
    hem = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bd, 0.008)), 0.0, 0.0015, 1.0, 0.0)
    c = g.mix(g.math('MULTIPLY', hem, 0.4), c, col(shade(base, 1.5)))
    rough = g.math('ADD', o.get('rough', 0.55), g.math('MULTIPLY', scuff, 0.3))
    g.bsdf(c, rough, h, 0.3, 0.002)
    return m


def hair_mat(name, o):
    """髪・ひげ。毛流れに沿って伸ばしたノイズ。"""
    m = bpy.data.materials.new(name)
    g = NB(m)
    P = g.co()
    x, y, z = g.sep(P)
    base = o['color']
    head = o.get('head', (0, 0, 1.6))
    rel = g.vmath('SUBTRACT', P, head)
    rx, ry, rz = g.sep(rel)
    az = g.math('ARCTAN2', rx, ry)
    # 毛流れ: 頭のまわりの角度方向に細かく、上下方向に長く伸ばしたノイズ
    strand = g.noise(g.xyz(g.math('MULTIPLY', az, 160.0), g.math('MULTIPLY', rz, 6.0), 0.0), 3.0, 2.0, 0.5)
    clump = g.noise(g.xyz(g.math('MULTIPLY', az, 12.0), g.math('MULTIPLY', rz, 2.0), 3.0), 4.0, 2.0, 0.5)
    c = g.mix(g.maprange(clump, 0.35, 0.65), col(shade(base, 0.75)), col(tuple(min(1, v * 1.3 + 0.01) for v in base)))
    c = g.mix(g.maprange(strand, 0.3, 0.7, 0.0, 0.6), c, col(tuple(min(1, v * 1.6 + 0.02) for v in base)))
    if o.get('grey', 0) > 0:
        gr = g.maprange(g.noise(g.xyz(g.math('MULTIPLY', az, 90.0), g.math('MULTIPLY', rz, 6.0), 1.0), 5.0, 2.0, 0.6), 0.55, 0.62)
        c = g.mix(g.math('MULTIPLY', gr, o['grey']), c, col((0.55, 0.53, 0.5)))
    bd = g.attr('bd')
    # 縁は肌になじむように薄く
    edge = g.maprange(bd, 0.0, o.get('soft', 0.012), 1.0, 0.0)
    if o.get('skin'):
        c = g.mix(g.math('MULTIPLY', edge, 0.6), c, col(o['skin']))
    h = g.math('ADD', g.math('MULTIPLY', strand, 0.5), g.math('MULTIPLY', clump, 0.5))
    g.bsdf(c, 0.5, h, 0.25, 0.002)
    return m


def rubber_mat(name, o):
    m = bpy.data.materials.new(name)
    g = NB(m)
    P = g.co()
    base = o['color']
    c = g.mix(g.maprange(g.noise(P, 20.0, 3.0, 0.6), 0.3, 0.7), col(shade(base, 0.85)), col(shade(base, 1.2)))
    dust = g.maprange(g.noise(P, 8.0, 3.0, 0.6), 0.55, 0.75)
    c = g.mix(g.math('MULTIPLY', dust, 0.35), c, col((0.2, 0.19, 0.17)))
    h = g.math('MULTIPLY', g.noise(P, 200.0, 2.0, 0.5), 0.3)
    g.bsdf(c, g.math('ADD', 0.45, g.math('MULTIPLY', dust, 0.4)), h, 0.2, 0.002)
    return m


def eye_mat(name, o, center, fwd):
    """目玉: 前向きからの角度で虹彩と瞳孔を描く。"""
    m = bpy.data.materials.new(name)
    g = NB(m)
    P = g.co()
    d = g.vmath('NORMALIZE', g.vmath('SUBTRACT', P, center))
    cosang = g.vmath('DOT_PRODUCT', d, fwd)
    iris_c = o.get('iris', (0.06, 0.035, 0.02))
    sclera = (0.62, 0.58, 0.54)
    c = g.mix(g.maprange(cosang, 0.80, 0.86), col(sclera), col(iris_c))
    rays = g.noise(g.vmath('MULTIPLY', d, (30.0, 4.0, 30.0)), 8.0, 2.0, 0.6)
    c = g.mix(g.math('MULTIPLY', g.maprange(cosang, 0.86, 0.9), g.maprange(rays, 0.3, 0.7, 0.0, 0.5)), c, col(shade(iris_c, 1.8)))
    c = g.mix(g.maprange(cosang, 0.955, 0.965), c, col((0.01, 0.01, 0.01)))
    vein = g.maprange(g.noise(P, 300.0, 3.0, 0.7, 1.0), 0.62, 0.7)
    c = g.mix(g.math('MULTIPLY', vein, g.maprange(cosang, 0.7, 0.4, 0.0, 0.5)), c, col((0.5, 0.15, 0.12)))
    g.bsdf(c, 0.15, None)
    return m


# ------------------------------------------------------------ 焼き込み
def ensure_image(name, size, data=False):
    im = bpy.data.images.get(name)
    if im is None:
        im = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False, is_data=data)
        if data:
            im.colorspace_settings.name = 'Non-Color'
    return im


def add_target(mat, image):
    n = mat.node_tree.nodes.new('ShaderNodeTexImage')
    n.name = 'bake_target'
    n.image = image
    n.location = (-400, -400)
    mat.node_tree.nodes.active = n
    return n


def bake(objects, kind, image, samples=1, margin=0):
    """余白（margin）は 0 で焼き、あとで dilate() で空いた画素だけを埋める。
    Blender の余白は隣の島を上書きすることがあるため。"""
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = samples
    scn.render.bake.margin = margin
    scn.render.bake.use_clear = False
    w, h = image.size
    image.pixels.foreach_set(np.zeros(w * h * 4, dtype=np.float32))
    scn.render.bake.use_selected_to_active = False
    for ob in objects:
        for slot in ob.material_slots:
            if slot.material:
                n = slot.material.node_tree.nodes.get('bake_target')
                n.image = image
                slot.material.node_tree.nodes.active = n
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if kind == 'DIFFUSE':
        scn.render.bake.use_pass_direct = False
        scn.render.bake.use_pass_indirect = False
        scn.render.bake.use_pass_color = True
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=False, margin=margin)
    elif kind == 'NORMAL':
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_clear=False, margin=margin)
    else:
        bpy.ops.object.bake(type=kind, use_clear=False, margin=margin)


def dilate(a, iters=12):
    """アルファ 0 の画素を、まわりの焼けた画素の平均で埋める（島の外側へ広げる）。"""
    a = a.copy()
    filled = a[..., 3] > 0.5
    for _ in range(iters):
        acc = np.zeros_like(a[..., :3])
        cnt = np.zeros(filled.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            f = np.roll(np.roll(filled, dy, 0), dx, 1)
            acc += np.roll(np.roll(a[..., :3], dy, 0), dx, 1) * f[..., None]
            cnt += f
        new = (~filled) & (cnt > 0)
        a[new, :3] = acc[new] / cnt[new][:, None]
        filled = filled | new
    a[..., 3] = 1
    return a


def image_array(image):
    w, h = image.size
    a = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def save_png(arr, path, srgb_out=False):
    from PIL import Image
    a = np.clip(arr[..., :3], 0, 1)
    if srgb_out:
        a = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
    im = Image.fromarray((np.flipud(a) * 255 + 0.5).astype(np.uint8))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
