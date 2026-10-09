"""深層線のテクスチャを Blender のシェーダーノードから焼き出す。

各マテリアルはタイル可能（UV 0..1 で継ぎ目が出ない）になるよう、
ノイズは UV をトーラス状の 4D 座標に写して評価し、レンガやタイルは周期が 1 で割り切れる設定にしている。

使い方: python tools/build_textures.py <出力ディレクトリ> [サイズ] [名前,名前,...]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402

TAU = 2 * math.pi
OUT = sys.argv[1] if len(sys.argv) > 1 else 'assets/build/tex'
SIZE = int(sys.argv[2]) if len(sys.argv) > 2 else 512
ONLY = sys.argv[3].split(',') if len(sys.argv) > 3 else None
os.makedirs(OUT, exist_ok=True)


class G:
    """ノードを組み立てる小さなヘルパー。"""

    def __init__(self, mat):
        self.t = mat.node_tree
        self.n = self.t.nodes
        for node in list(self.n):
            self.n.remove(node)
        self.y = 0

    def node(self, kind, **props):
        nd = self.n.new(kind)
        nd.location = (-200 * (len(self.n) % 12), -200 * (len(self.n) // 12))
        for k, v in props.items():
            setattr(nd, k, v)
        return nd

    def put(self, sock, val):
        if isinstance(val, (int, float)):
            sock.default_value = val
        elif isinstance(val, tuple):
            sock.default_value = val if len(val) == 4 or sock.type != 'RGBA' else (*val, 1.0)
        else:
            self.t.links.new(val, sock)

    def inp(self, nd, ident):
        for s in nd.inputs:
            if s.identifier == ident or s.name == ident:
                if s.enabled:
                    return s
        for s in nd.inputs:
            if s.identifier == ident or s.name == ident:
                return s
        raise KeyError(ident)

    def out(self, nd, ident):
        for s in nd.outputs:
            if s.identifier == ident or s.name == ident:
                return s
        raise KeyError(ident)

    # ---- 基本 ----
    def uv(self):
        tc = self.node('ShaderNodeTexCoord')
        sep = self.node('ShaderNodeSeparateXYZ')
        self.t.links.new(tc.outputs['UV'], sep.inputs[0])
        return sep.outputs['X'], sep.outputs['Y']

    def m(self, op, a, b=0.0, clamp=False):
        nd = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.put(nd.inputs[0], a)
        self.put(nd.inputs[1], b)
        return nd.outputs[0]

    def add(self, a, b):
        return self.m('ADD', a, b)

    def mul(self, a, b):
        return self.m('MULTIPLY', a, b)

    def sub(self, a, b):
        return self.m('SUBTRACT', a, b)

    def clamp01(self, a):
        return self.m('MULTIPLY', a, 1.0, True)

    def mapr(self, a, f0, f1, t0=0.0, t1=1.0):
        nd = self.node('ShaderNodeMapRange', clamp=True)
        self.put(nd.inputs['Value'], a)
        nd.inputs['From Min'].default_value = f0
        nd.inputs['From Max'].default_value = f1
        nd.inputs['To Min'].default_value = t0
        nd.inputs['To Max'].default_value = t1
        return nd.outputs['Result']

    def combine(self, x, y, z):
        nd = self.node('ShaderNodeCombineXYZ')
        self.put(nd.inputs[0], x)
        self.put(nd.inputs[1], y)
        self.put(nd.inputs[2], z)
        return nd.outputs[0]

    def torus(self, u, v, ru=1.0, rv=1.0, ou=0.0, ov=0.0):
        """UV を 4D トーラスに写す。ru/rv が大きいほどその方向に細かく変化する。"""
        au = self.mul(self.add(u, ou), TAU)
        av = self.mul(self.add(v, ov), TAU)
        x = self.mul(self.m('COSINE', au), ru)
        y = self.mul(self.m('SINE', au), ru)
        z = self.mul(self.m('COSINE', av), rv)
        w = self.mul(self.m('SINE', av), rv)
        return self.combine(x, y, z), w

    def noise(self, tc, scale, detail=4.0, rough=0.5, distortion=0.0):
        vec, w = tc
        nd = self.node('ShaderNodeTexNoise', noise_dimensions='4D')
        self.put(nd.inputs['Vector'], vec)
        self.put(nd.inputs['W'], w)
        nd.inputs['Scale'].default_value = scale
        nd.inputs['Detail'].default_value = detail
        nd.inputs['Roughness'].default_value = rough
        nd.inputs['Distortion'].default_value = distortion
        return nd.outputs['Fac']

    def voronoi(self, tc, scale, feature='F1', rand=1.0, out='Distance'):
        vec, w = tc
        nd = self.node('ShaderNodeTexVoronoi', voronoi_dimensions='4D', feature=feature)
        self.put(nd.inputs['Vector'], vec)
        self.put(nd.inputs['W'], w)
        nd.inputs['Scale'].default_value = scale
        nd.inputs['Randomness'].default_value = rand
        return nd.outputs[out]

    def white(self, a, b):
        nd = self.node('ShaderNodeTexWhiteNoise', noise_dimensions='2D')
        self.put(nd.inputs['Vector'], self.combine(a, b, 0.0))
        return nd.outputs['Value']

    def brick(self, scale, w, h, offset=0.5, freq=2, mortar=0.02, smooth=0.1, uvsock=None):
        nd = self.node('ShaderNodeTexBrick', offset=offset, offset_frequency=freq, squash=1.0, squash_frequency=1)
        if uvsock is not None:
            self.put(nd.inputs['Vector'], uvsock)
        else:
            tc = self.node('ShaderNodeTexCoord')
            self.t.links.new(tc.outputs['UV'], nd.inputs['Vector'])
        nd.inputs['Color1'].default_value = (0, 0, 0, 1)
        nd.inputs['Color2'].default_value = (1, 1, 1, 1)
        nd.inputs['Mortar'].default_value = (0, 0, 0, 1)
        nd.inputs['Scale'].default_value = scale
        nd.inputs['Mortar Size'].default_value = mortar
        nd.inputs['Mortar Smooth'].default_value = smooth
        nd.inputs['Bias'].default_value = 0.0
        nd.inputs['Brick Width'].default_value = w
        nd.inputs['Row Height'].default_value = h
        rnd = self.bw(nd.outputs['Color'])
        return rnd, nd.outputs['Fac']

    def bw(self, col):
        nd = self.node('ShaderNodeRGBToBW')
        self.put(nd.inputs[0], col)
        return nd.outputs[0]

    def ramp(self, fac, stops):
        nd = self.node('ShaderNodeValToRGB')
        self.put(nd.inputs['Fac'], fac)
        el = nd.color_ramp.elements
        while len(el) > 1:
            el.remove(el[-1])
        el[0].position = stops[0][0]
        el[0].color = (*stops[0][1], 1.0)
        for pos, col in stops[1:]:
            e = el.new(pos)
            e.color = (*col, 1.0)
        return nd.outputs['Color']

    def mix(self, a, b, fac, blend='MIX'):
        nd = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_result=True)
        self.put(self.inp(nd, 'Factor_Float'), fac)
        self.put(self.inp(nd, 'A_Color'), a)
        self.put(self.inp(nd, 'B_Color'), b)
        return self.out(nd, 'Result_Color')

    def col(self, rgb):
        nd = self.node('ShaderNodeRGB')
        nd.outputs[0].default_value = (*rgb, 1.0)
        return nd.outputs[0]

    def shade(self, color, rough, height, bump=0.5, metal=0.0):
        bsdf = self.node('ShaderNodeBsdfPrincipled')
        self.put(bsdf.inputs['Base Color'], color)
        self.put(bsdf.inputs['Roughness'], rough)
        bsdf.inputs['Metallic'].default_value = metal
        bp = self.node('ShaderNodeBump')
        bp.inputs['Strength'].default_value = bump
        bp.inputs['Distance'].default_value = 0.02
        self.put(bp.inputs['Height'], height)
        self.t.links.new(bp.outputs['Normal'], bsdf.inputs['Normal'])
        out = self.node('ShaderNodeOutputMaterial')
        self.t.links.new(bsdf.outputs[0], out.inputs['Surface'])


# ================================================================ マテリアル定義
# 各関数は (color, roughness, height, bump強度) を返す

def concrete(g, base=(0.33, 0.33, 0.31), dark=False):
    u, v = g.uv()
    big = g.noise(g.torus(u, v, 1, 1), 1.6, 6, 0.55)
    fine = g.noise(g.torus(u, v, 1, 1, 0.3, 0.7), 18, 4, 0.6)
    streak = g.noise(g.torus(u, v, 5, 0.25, 0.1), 2.4, 3, 0.5)
    pits = g.voronoi(g.torus(u, v, 1, 1, 0.5), 28)
    crack = g.voronoi(g.torus(u, v, 1, 1, 0.2, 0.4), 3.5, 'DISTANCE_TO_EDGE')
    crackmask = g.mapr(g.noise(g.torus(u, v, 1, 1, 0.7), 2.2, 2), 0.52, 0.6)
    cr = g.mul(g.mapr(crack, 0.0, 0.012, 1.0, 0.0), crackmask)
    c = g.ramp(big, [(0.25, tuple(x * 0.62 for x in base)), (0.55, base), (0.8, tuple(min(1, x * 1.2) for x in base))])
    c = g.mix(c, g.col((0.08, 0.07, 0.06)), g.mul(g.mapr(streak, 0.55, 0.75), 0.6))
    c = g.mix(c, g.col(tuple(x * 0.7 for x in base)), g.mul(g.mapr(fine, 0.35, 0.75), 0.4))
    c = g.mix(c, g.col((0.05, 0.05, 0.045)), g.mul(cr, 0.85))
    pit = g.mapr(pits, 0.0, 0.08, 1.0, 0.0)
    c = g.mix(c, g.col((0.08, 0.08, 0.07)), g.mul(pit, 0.6))
    h = g.sub(g.add(g.mul(fine, 0.45), g.mul(big, 0.3)), g.add(g.mul(cr, 0.6), g.mul(pit, 0.35)))
    r = g.mapr(streak, 0.5, 0.8, 0.88, 0.7)
    return c, r, h, 0.55


def tiles(g, col=(0.75, 0.75, 0.68), n=8, grout=(0.16, 0.15, 0.13)):
    u, v = g.uv()
    rnd, fac = g.brick(1.0, 1.0 / n, 1.0 / n, 0.0, 1, 0.0045, 0.35)
    dirt = g.noise(g.torus(u, v, 1, 1), 2.2, 5, 0.6)
    fine = g.noise(g.torus(u, v, 1, 1, 0.4), 30, 3, 0.5)
    missing = g.mapr(rnd, 0.93, 0.94)
    tile_c = g.mix(g.col(tuple(x * 0.84 for x in col)), g.col(col), rnd)
    tile_c = g.mix(tile_c, g.col((0.22, 0.2, 0.16)), g.mul(g.mapr(dirt, 0.5, 0.85), 0.6))
    c = g.mix(tile_c, g.col(grout), fac)
    c = g.mix(c, g.col((0.28, 0.27, 0.25)), missing)
    chip = g.mul(g.mapr(g.voronoi(g.torus(u, v, 1, 1, 0.3), 40), 0.0, 0.05, 1, 0), g.mapr(fine, 0.6, 0.7))
    c = g.mix(c, g.col(grout), chip)
    h = g.sub(g.sub(1.0, g.mul(fac, 1.0)), g.add(g.mul(missing, 0.8), g.mul(chip, 0.4)))
    h = g.add(h, g.mul(fine, 0.06))
    r = g.add(g.mul(fac, 0.65), g.add(0.22, g.mul(g.mapr(dirt, 0.4, 0.8), 0.45)))
    r = g.clamp01(g.add(r, g.mul(missing, 0.6)))
    return c, r, h, 0.6


def slabs(g):
    u, v = g.uv()
    rnd, fac = g.brick(1.0, 0.25, 0.25, 0.0, 1, 0.006, 0.4)
    stone = g.noise(g.torus(u, v, 1, 1), 9, 6, 0.6)
    wear = g.noise(g.torus(u, v, 1, 1, 0.5), 1.8, 4, 0.5)
    c = g.ramp(stone, [(0.3, (0.27, 0.26, 0.24)), (0.6, (0.42, 0.4, 0.37)), (0.85, (0.5, 0.48, 0.44))])
    c = g.mix(c, g.col((0.33, 0.31, 0.28)), g.mul(rnd, 0.4))
    c = g.mix(c, g.col((0.12, 0.11, 0.1)), g.mul(g.mapr(wear, 0.55, 0.85), 0.6))
    c = g.mix(c, g.col((0.08, 0.075, 0.07)), fac)
    h = g.sub(g.add(g.mul(stone, 0.3), 0.6), g.mul(fac, 0.9))
    r = g.mapr(wear, 0.4, 0.8, 0.8, 0.6)
    return c, r, h, 0.5


def gravel(g):
    u, v = g.uv()
    tc = g.torus(u, v, 1, 1)
    d = g.voronoi(tc, 26, 'F1', 1.0)
    cc = g.voronoi(tc, 26, 'F1', 1.0, 'Color')
    shade = g.bw(cc)
    fine = g.noise(g.torus(u, v, 1, 1, 0.2), 60, 3)
    c = g.ramp(shade, [(0.0, (0.12, 0.11, 0.1)), (0.5, (0.3, 0.28, 0.25)), (1.0, (0.45, 0.42, 0.38))])
    c = g.mix(c, g.col((0.05, 0.045, 0.04)), g.mapr(d, 0.35, 0.6))
    h = g.add(g.mapr(d, 0.0, 0.55, 1.0, 0.0), g.mul(fine, 0.15))
    return c, 0.95, h, 0.9


def bricks(g):
    u, v = g.uv()
    rnd, fac = g.brick(1.0, 1.0 / 8, 1.0 / 24, 0.5, 2, 0.008, 0.2)
    n = g.noise(g.torus(u, v, 1, 1), 12, 5, 0.6)
    grime = g.noise(g.torus(u, v, 1, 1, 0.6), 1.6, 4)
    c = g.mix(g.col((0.32, 0.12, 0.07)), g.col((0.48, 0.22, 0.13)), rnd)
    c = g.mix(c, g.col((0.18, 0.09, 0.06)), g.mul(g.mapr(n, 0.4, 0.8), 0.6))
    c = g.mix(c, g.col((0.26, 0.24, 0.21)), fac)
    c = g.mix(c, g.col((0.06, 0.05, 0.04)), g.mul(g.mapr(grime, 0.5, 0.85), 0.7))
    h = g.add(g.sub(1.0, fac), g.mul(n, 0.25))
    return c, 0.9, h, 0.7


def metal(g, paint=(0.27, 0.3, 0.28)):
    u, v = g.uv()
    rust = g.noise(g.torus(u, v, 1, 1), 2.2, 7, 0.65)
    fine = g.noise(g.torus(u, v, 1, 1, 0.3), 40, 4, 0.6)
    rnd, fac = g.brick(1.0, 0.5, 0.5, 0.0, 1, 0.004, 0.0)
    # リベット
    ru = g.m('FRACT', g.mul(u, 2.0))
    rv = g.m('FRACT', g.mul(v, 2.0))
    dist = g.m('MINIMUM', g.m('MINIMUM', g.m('ABSOLUTE', g.sub(ru, 0.04)), g.m('ABSOLUTE', g.sub(ru, 0.96))), 1.0)
    dv = g.m('MINIMUM', g.m('ABSOLUTE', g.sub(rv, 0.04)), g.m('ABSOLUTE', g.sub(rv, 0.96)))
    rivet = g.mul(g.mapr(dist, 0.0, 0.012, 1, 0), g.mapr(dv, 0.0, 0.012, 1, 0))
    rmask = g.mapr(rust, 0.48, 0.62)
    c = g.mix(g.col(paint), g.col((0.3, 0.13, 0.05)), rmask)
    c = g.mix(c, g.col((0.14, 0.06, 0.03)), g.mul(g.mapr(fine, 0.5, 0.8), rmask))
    c = g.mix(c, g.col((0.05, 0.05, 0.05)), fac)
    h = g.sub(g.add(g.mul(rivet, 0.8), g.mul(rmask, g.mul(fine, 0.5))), g.mul(fac, 0.6))
    r = g.mapr(rmask, 0, 1, 0.45, 0.92)
    return c, r, h, 0.6


def asphalt(g):
    u, v = g.uv()
    agg = g.voronoi(g.torus(u, v, 1, 1), 70)
    n = g.noise(g.torus(u, v, 1, 1, 0.4), 6, 5)
    ash = g.noise(g.torus(u, v, 1, 1, 0.8), 1.4, 6, 0.6)
    crack = g.voronoi(g.torus(u, v, 1, 1, 0.1), 2.4, 'DISTANCE_TO_EDGE')
    cmask = g.mapr(g.noise(g.torus(u, v, 1, 1, 0.9), 2, 2), 0.5, 0.58)
    cr = g.mul(g.mapr(crack, 0, 0.008, 1, 0), cmask)
    c = g.ramp(n, [(0.3, (0.07, 0.07, 0.075)), (0.7, (0.13, 0.13, 0.13))])
    c = g.mix(c, g.col((0.22, 0.21, 0.2)), g.mapr(agg, 0.0, 0.12, 0.5, 0.0))
    c = g.mix(c, g.col((0.3, 0.295, 0.28)), g.mul(g.mapr(ash, 0.52, 0.75), 0.55))
    c = g.mix(c, g.col((0.02, 0.02, 0.02)), cr)
    h = g.sub(g.mapr(agg, 0.0, 0.3, 0.8, 0.0), g.mul(cr, 1.0))
    return c, 0.95, h, 0.6


def rubble(g):
    u, v = g.uv()
    tc = g.torus(u, v, 1, 1)
    d = g.voronoi(tc, 9)
    shade = g.bw(g.voronoi(tc, 9, 'F1', 1.0, 'Color'))
    n = g.noise(g.torus(u, v, 1, 1, 0.5), 20, 5)
    c = g.ramp(shade, [(0.0, (0.2, 0.18, 0.15)), (1.0, (0.4, 0.37, 0.33))])
    c = g.mix(c, g.col((0.12, 0.1, 0.08)), g.mapr(d, 0.3, 0.6))
    c = g.mix(c, g.col((0.25, 0.22, 0.18)), g.mul(n, 0.3))
    h = g.add(g.mapr(d, 0, 0.6, 1, 0), g.mul(n, 0.3))
    return c, 0.97, h, 0.8


def marble(g):
    u, v = g.uv()
    n = g.noise(g.torus(u, v, 1, 1), 1.5, 8, 0.6, 1.5)
    vein = g.m('ABSOLUTE', g.m('SINE', g.add(g.mul(n, 22.0), g.mul(u, TAU * 2))))
    vein = g.m('POWER', g.sub(1.0, vein), 7.0)
    rnd, fac = g.brick(1.0, 0.5, 0.5, 0.0, 1, 0.002, 0.0)
    c = g.mix(g.col((0.82, 0.81, 0.78)), g.col((0.7, 0.69, 0.66)), g.mul(rnd, 0.6))
    c = g.mix(c, g.col((0.2, 0.19, 0.19)), g.clamp01(g.mul(vein, 1.3)))
    cloud = g.noise(g.torus(u, v, 1, 1, 0.5), 2.0, 5, 0.6)
    c = g.mix(c, g.col((0.62, 0.6, 0.57)), g.mul(g.mapr(cloud, 0.45, 0.7), 0.5))
    c = g.mix(c, g.col((0.25, 0.24, 0.22)), fac)
    r = g.add(0.12, g.mul(vein, 0.15))
    h = g.sub(0.5, g.mul(fac, 0.8))
    return c, r, h, 0.25


def wood(g, base=(0.33, 0.22, 0.13), planks=8):
    u, v = g.uv()
    rnd, fac = g.brick(1.0, 0.5, 1.0 / planks, 0.25, 2, 0.006, 0.2)
    gr = g.noise(g.torus(u, v, 1.5, 2.5), 1.6, 4, 0.5, 0.5)
    tone = g.noise(g.torus(u, v, 2, 6, 0.4), 4, 4, 0.5)
    nlines = 6.0 * planks if planks > 2 else 30.0
    grain = g.m('ABSOLUTE', g.m('SINE', g.mul(g.add(v, g.mul(gr, 0.7 / nlines)), nlines * math.pi)))
    line = g.mapr(grain, 0.0, 0.5, 1.0, 0.0)
    knot = g.mapr(g.voronoi(g.torus(u, v, 1, 1, 0.3), 2.2), 0.0, 0.16, 1.0, 0.0)
    c = g.mix(g.col(tuple(x * 0.7 for x in base)), g.col(base), rnd)
    c = g.mix(c, g.col(tuple(min(1, x * 1.25) for x in base)), g.mul(tone, 0.6))
    c = g.mix(c, g.col(tuple(x * 0.38 for x in base)), g.mul(line, 0.75))
    c = g.mix(c, g.col((0.08, 0.05, 0.025)), g.mul(knot, 0.8))
    c = g.mix(c, g.col((0.05, 0.035, 0.02)), fac)
    h = g.sub(g.sub(0.7, g.mul(line, 0.25)), g.mul(fac, 0.9))
    return c, g.add(0.6, g.mul(line, 0.2)), h, 0.6


def facade(g):
    u, v = g.uv()
    con = g.noise(g.torus(u, v, 1, 1), 5, 6, 0.55)
    streak = g.noise(g.torus(u, v, 6, 0.3), 2.5, 3)
    fu = g.m('FRACT', g.mul(u, 2.0))
    fv = g.m('FRACT', g.mul(v, 2.0))
    win = g.mul(g.mul(g.mapr(fu, 0.16, 0.17), g.mapr(fu, 0.84, 0.83)), g.mul(g.mapr(fv, 0.22, 0.23), g.mapr(fv, 0.84, 0.83)))
    frame = g.sub(g.mul(g.mul(g.mapr(fu, 0.12, 0.13), g.mapr(fu, 0.88, 0.87)), g.mul(g.mapr(fv, 0.18, 0.19), g.mapr(fv, 0.88, 0.87))), win)
    mull = g.mul(g.mapr(g.m('ABSOLUTE', g.sub(fu, 0.5)), 0.012, 0.0), win)
    broken = g.mapr(g.white(g.m('FLOOR', g.mul(u, 2.0)), g.m('FLOOR', g.mul(v, 2.0))), 0.55, 0.56)
    c = g.ramp(con, [(0.3, (0.24, 0.235, 0.22)), (0.7, (0.4, 0.39, 0.37))])
    c = g.mix(c, g.col((0.08, 0.075, 0.07)), g.mul(g.mapr(streak, 0.55, 0.75), 0.6))
    glass = g.mix(g.col((0.05, 0.06, 0.07)), g.col((0.01, 0.01, 0.01)), broken)
    c = g.mix(c, g.col((0.16, 0.15, 0.14)), frame)
    c = g.mix(c, glass, win)
    c = g.mix(c, g.col((0.18, 0.17, 0.16)), mull)
    h = g.sub(g.add(0.6, g.mul(frame, 0.3)), g.mul(win, g.add(0.5, g.mul(broken, 0.4))))
    r = g.mix(g.col((0.9, 0.9, 0.9)), g.mix(g.col((0.12, 0.12, 0.12)), g.col((0.95, 0.95, 0.95)), broken), win)
    return c, g.bw(r), h, 0.5


def ceiling(g):
    c, r, h, b = concrete(g, (0.2, 0.2, 0.19))
    u, v = g.uv()
    stain = g.noise(g.torus(u, v, 1, 1, 0.33), 1.2, 5, 0.6)
    c = g.mix(c, g.col((0.04, 0.035, 0.03)), g.mul(g.mapr(stain, 0.5, 0.75), 0.8))
    return c, r, h, b


# ---- 人物・小道具用 ----
def fabric(g):
    u, v = g.uv()
    wu = g.m('ABSOLUTE', g.m('SINE', g.mul(u, TAU * 48)))
    wv = g.m('ABSOLUTE', g.m('SINE', g.mul(v, TAU * 48)))
    weave = g.mul(g.add(wu, wv), 0.5)
    dirt = g.noise(g.torus(u, v, 1, 1), 2.5, 5, 0.6)
    fine = g.noise(g.torus(u, v, 1, 1, 0.5), 20, 3)
    c = g.ramp(dirt, [(0.3, (0.55, 0.55, 0.55)), (0.75, (0.82, 0.82, 0.82))])
    c = g.mix(c, g.col((0.4, 0.4, 0.4)), g.mul(weave, 0.25))
    c = g.mix(c, g.col((0.3, 0.28, 0.25)), g.mul(g.mapr(fine, 0.55, 0.8), 0.5))
    h = g.add(g.mul(weave, 0.6), g.mul(fine, 0.3))
    return c, 0.95, h, 0.35


def burlap(g):
    u, v = g.uv()
    wu = g.m('ABSOLUTE', g.m('SINE', g.mul(u, TAU * 24)))
    wv = g.m('ABSOLUTE', g.m('SINE', g.mul(v, TAU * 24)))
    dirt = g.noise(g.torus(u, v, 1, 1), 3, 5)
    c = g.ramp(dirt, [(0.3, (0.32, 0.27, 0.18)), (0.75, (0.52, 0.45, 0.31))])
    c = g.mix(c, g.col((0.2, 0.17, 0.11)), g.mul(g.mul(wu, wv), 0.5))
    return c, 1.0, g.add(wu, wv), 0.5


def leather(g):
    u, v = g.uv()
    w = g.voronoi(g.torus(u, v, 1, 1), 18, 'DISTANCE_TO_EDGE')
    n = g.noise(g.torus(u, v, 1, 1, 0.3), 3, 5)
    c = g.ramp(n, [(0.3, (0.45, 0.45, 0.45)), (0.7, (0.7, 0.7, 0.7))])
    c = g.mix(c, g.col((0.25, 0.25, 0.25)), g.mapr(w, 0.0, 0.03, 0.6, 0.0))
    return c, g.mapr(n, 0.3, 0.7, 0.55, 0.85), g.mapr(w, 0.0, 0.05), 0.4


def skin_t(g):
    u, v = g.uv()
    pores = g.voronoi(g.torus(u, v, 1, 1), 80)
    blot = g.noise(g.torus(u, v, 1, 1), 3, 5)
    c = g.ramp(blot, [(0.3, (0.8, 0.74, 0.72)), (0.7, (0.95, 0.9, 0.86))])
    c = g.mix(c, g.col((0.7, 0.6, 0.58)), g.mapr(pores, 0.0, 0.1, 0.3, 0.0))
    return c, 0.6, g.mapr(pores, 0, 0.2), 0.15


def mskin(g):
    u, v = g.uv()
    vein = g.voronoi(g.torus(u, v, 1, 1), 5, 'DISTANCE_TO_EDGE')
    vein2 = g.voronoi(g.torus(u, v, 1, 1, 0.37), 11, 'DISTANCE_TO_EDGE')
    blot = g.noise(g.torus(u, v, 1, 1), 2.6, 6, 0.6)
    wr = g.noise(g.torus(u, v, 3, 1, 0.2), 9, 5, 0.6, 1.0)
    c = g.ramp(blot, [(0.25, (0.62, 0.52, 0.5)), (0.6, (0.82, 0.74, 0.7)), (0.85, (0.7, 0.58, 0.55))])
    c = g.mix(c, g.col((0.35, 0.16, 0.2)), g.mapr(vein, 0.0, 0.025, 0.9, 0.0))
    c = g.mix(c, g.col((0.45, 0.25, 0.3)), g.mapr(vein2, 0.0, 0.015, 0.6, 0.0))
    c = g.mix(c, g.col((0.4, 0.32, 0.28)), g.mul(g.mapr(wr, 0.5, 0.75), 0.5))
    h = g.add(g.mapr(vein, 0.0, 0.03, 0.6, 0.0), g.mul(wr, 0.6))
    return c, g.mapr(blot, 0.3, 0.8, 0.45, 0.7), h, 0.55


def fur(g):
    u, v = g.uv()
    strands = g.noise(g.torus(u, v, 18, 1.2), 6, 4, 0.7)
    patch = g.noise(g.torus(u, v, 1, 1), 2.5, 4)
    c = g.ramp(strands, [(0.3, (0.32, 0.3, 0.28)), (0.7, (0.85, 0.8, 0.75))])
    c = g.mix(c, g.col((0.35, 0.2, 0.18)), g.mul(g.mapr(patch, 0.55, 0.7), 0.6))
    return c, 0.95, strands, 0.7


def gunmetal(g):
    u, v = g.uv()
    brush = g.noise(g.torus(u, v, 30, 1), 4, 3, 0.5)
    wear = g.noise(g.torus(u, v, 1, 1), 4, 6, 0.6)
    scratch = g.voronoi(g.torus(u, v, 1, 1, 0.3), 14, 'DISTANCE_TO_EDGE')
    c = g.ramp(wear, [(0.4, (0.55, 0.56, 0.58)), (0.75, (0.8, 0.8, 0.82))])
    c = g.mix(c, g.col((1, 1, 1)), g.mul(g.mapr(scratch, 0.0, 0.006, 1, 0), 0.4))
    r = g.add(g.mapr(wear, 0.4, 0.8, 0.5, 0.3), g.mul(brush, 0.15))
    return c, r, g.add(g.mul(brush, 0.2), g.mapr(scratch, 0, 0.008, 0, 1)), 0.2


def paint(g):
    u, v = g.uv()
    rust = g.noise(g.torus(u, v, 1, 1), 2.5, 7, 0.65)
    chip = g.noise(g.torus(u, v, 1, 1, 0.4), 9, 5, 0.6)
    run = g.noise(g.torus(u, v, 6, 0.3), 2.0, 3)
    rmask = g.clamp01(g.add(g.mapr(rust, 0.52, 0.66), g.mapr(chip, 0.66, 0.7)))
    c = g.mix(g.col((0.8, 0.8, 0.78)), g.col((0.28, 0.13, 0.05)), rmask)
    c = g.mix(c, g.col((0.2, 0.1, 0.04)), g.mul(g.mapr(run, 0.55, 0.75), 0.5))
    return c, g.mapr(rmask, 0, 1, 0.45, 0.95), g.mul(rmask, 0.6), 0.4


def rubber(g):
    u, v = g.uv()
    n = g.noise(g.torus(u, v, 1, 1), 25, 3)
    return g.ramp(n, [(0.3, (0.5, 0.5, 0.5)), (0.7, (0.62, 0.62, 0.62))]), 0.7, n, 0.15


def rock(g):
    c, r, h, b = concrete(g, (0.36, 0.34, 0.31))
    return c, 0.95, h, 0.8


SPECS = {
    # ワールド
    'concrete': (concrete, True), 'tile': (lambda g: tiles(g), True), 'tileg': (lambda g: tiles(g, (0.42, 0.56, 0.46)), True),
    'tileo': (lambda g: tiles(g, (0.62, 0.38, 0.2)), True), 'platform': (slabs, True), 'gravel': (gravel, False),
    'brick': (bricks, False), 'metal': (metal, True), 'asphalt': (asphalt, False), 'rubble': (rubble, False),
    'marble': (marble, True), 'wood': (wood, True), 'facade': (facade, True), 'ceiling': (ceiling, False),
    # 人物・小道具
    'fabric': (fabric, False), 'burlap': (burlap, False), 'leather': (leather, True), 'skin': (skin_t, False),
    'mskin': (mskin, True), 'fur': (fur, False), 'gunmetal': (gunmetal, True), 'gunwood': (lambda g: wood(g, (0.4, 0.23, 0.11), 2), True),
    'paint': (paint, True), 'rubber': (rubber, False), 'rock': (rock, False),
}


def bake_one(name, fn, want_rough):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.mesh.primitive_plane_add(size=1)
    plane = bpy.context.view_layer.objects.active
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    plane.data.materials.append(mat)
    g = G(mat)
    c, r, h, b = fn(g)
    g.shade(c, r, h, b)
    passes = [('c', 'DIFFUSE', False), ('n', 'NORMAL', True)]
    if want_rough:
        passes.append(('r', 'ROUGHNESS', True))
    for suffix, kind, data in passes:
        img = bpy.data.images.new(f'{name}_{suffix}', SIZE, SIZE, alpha=False, is_data=data)
        tex = g.node('ShaderNodeTexImage')
        tex.image = img
        for nd in g.n:
            nd.select = False
        tex.select = True
        g.n.active = tex
        kw = dict(type=kind, margin=0, use_clear=True)
        if kind == 'DIFFUSE':
            kw['pass_filter'] = {'COLOR'}
        if kind == 'NORMAL':
            kw['normal_space'] = 'TANGENT'
        plane.select_set(True)
        bpy.context.view_layer.objects.active = plane
        bpy.ops.object.bake(**kw)
        img.filepath_raw = os.path.join(OUT, f'{name}_{suffix}.png')
        img.file_format = 'PNG'
        img.save()
        g.n.remove(tex)
    print('baked', name)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 4
    sc.render.bake.margin = 0
    for name, (fn, rough) in SPECS.items():
        if ONLY and name not in ONLY:
            continue
        bake_one(name, fn, rough)


main()
