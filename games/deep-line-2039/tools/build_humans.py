"""深層線の人物を MakeHuman の CC0 データから作り、服を着せてテクスチャを焼き、glb に書き出す。

使い方: python tools/build_humans.py <mpfb2 のディレクトリ> <出力ディレクトリ> [名前,名前,...]
出力: <名前>.glb（スキニング済み）と tex/ch_<名前>_c.png / _n.png / _r.png
"""
import heapq
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import mh_body as MB  # noqa: E402
import mh_dress as MD  # noqa: E402
import mh_masks as MM  # noqa: E402
import mh_gear as MG  # noqa: E402
import mh_paint as PT  # noqa: E402
from blender_common import reset_scene  # noqa: E402

MPFB = sys.argv[1] if len(sys.argv) > 1 else 'assets/build/mpfb2'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'assets/build/chars'
ONLY = sys.argv[3].split(',') if len(sys.argv) > 3 else None
TEX = 1024
DECIMATE = 0.5

H = PT.srgb
ASIAN = {'asian': 0.85, 'caucasian': 0.1, 'african': 0.05}
SKIN = {'light': (0.62, 0.43, 0.33), 'mid': (0.55, 0.36, 0.26), 'tan': (0.48, 0.31, 0.21), 'pale': (0.66, 0.5, 0.42)}

# ------------------------------------------------------------ 登場人物
# body: MakeHuman のマクロ値。outfit: 服の層（重なり順は LAYER で決まる）。gear: 持ち物。
def man(age, muscle=0.55, weight=0.5, height=0.55, **details):
    return dict(gender=1.0, age=MB.age_value(age), muscle=muscle, weight=weight, height=height, race=ASIAN, details=details)


def woman(age, muscle=0.4, weight=0.45, height=0.45, **details):
    return dict(gender=0.0, age=MB.age_value(age), muscle=muscle, weight=weight, height=height, race=ASIAN, details=details)


def D(**kw):
    """顔の細部ターゲット。キーの __ を / に読み替える（例: nose__nose-hump-incr）。"""
    return {k.replace('__', '/').replace('_', '-'): v for k, v in kw.items()}


RED = H(0x9a2a1e)
CHARS = {
    'kuroda': dict(
        body=dict(man(50, 0.68, 0.6, 0.6), details=D(head__head_square=0.5, nose__nose_scale_horiz_incr=0.3, chin__chin_prominent_incr=0.4)),
        skin=dict(tone=SKIN['tan'], age=0.7, dirt=0.45, stubble=0.5),
        outfit=[('pants', dict(color=H(0x2a2a24), kind='canvas', mud=0.6)),
                ('shirt', dict(color=H(0x4a4038))),
                ('coat', dict(color=H(0x3a3b30), kind='canvas', collar=0.05, hem=0.17, buttons=True, pockets=[(0.1, 1.05, 0.12, 0.13)], wear=0.6)),
                ('boots', dict(color=H(0x2a221c))), ('gloves', dict(color=H(0x241e1a))),
                ('vest', dict(color=H(0x4a4636), kind='quilt')), ('scarf', dict(color=H(0x5a3a2a), kind='rib', ribs=90)),
                ('hair', dict(color=H(0x2a2620), grey=0.3)), ('beard', dict(color=H(0x2a2620), grey=0.35)),
                ('beanie', dict(color=H(0x26261f), kind='rib'))],
        gear=['pack', 'gun'], grip=True,
    ),
    'minami': dict(
        body=dict(woman(58, 0.35, 0.5, 0.42), details=D(head__head_oval=0.4, mouth__mouth_angles_down=0.3, nose__nose_point_width_decr=0.3)),
        skin=dict(tone=SKIN['light'], age=0.85, dirt=0.15, red=0.25),
        outfit=[('pants', dict(color=H(0x3a3030))), ('shirt', dict(color=H(0x5a4a50), kind='rib', ribs=120)),
                ('coat', dict(color=H(0x4a3a40), collar=0.05, hem=0.2, buttons=True, wear=0.3)),
                ('boots', dict(color=H(0x2a221c))), ('scarf', dict(color=H(0x6a5a3a), kind='check', thick=0.018)),
                ('hair', dict(color=H(0xb8b0a8), style='bun', grey=0.4))],
        eye=dict(iris=(0.04, 0.025, 0.015)),
    ),
    'shino': dict(
        body=dict(woman(26, 0.4, 0.4, 0.5), details=D(head__head_oval=0.5, nose__nose_scale_horiz_decr=0.3, mouth__mouth_lowerlip_volume_incr=0.3)),
        skin=dict(tone=SKIN['light'], age=0.0, dirt=0.15, red=0.35),
        outfit=[('pants', dict(color=H(0x2a2e30), kind='denim')), ('shirt', dict(color=H(0x3a4a52), zip=True, pockets=[(0.09, 1.2, 0.09, 0.1)])),
                ('boots', dict(color=H(0x2a2420))), ('hair', dict(color=H(0x1a1612), style='bob'))],
        gear=['headphones'],
    ),
    'goro': dict(
        body=dict(man(52, 0.45, 0.85, 0.45), details=D(head__head_round=0.5, nose__nose_volume_incr=0.4, neck__neck_double_incr=0.4)),
        skin=dict(tone=SKIN['mid'], age=0.6, dirt=0.3, stubble=0.3),
        outfit=[('pants', dict(color=H(0x3a3226), kind='canvas', mud=0.4)), ('shirt', dict(color=H(0x5a4a32), kind='check', check=H(0x2a2018))),
                ('boots', dict(color=H(0x3a2a1e))), ('vest', dict(color=H(0x6a5a3a), kind='canvas', pockets=[(0.08, 1.15, 0.1, 0.1)])),
                ('hair', dict(color=H(0x2a2420))), ('beard', dict(color=H(0x3a3028), grey=0.2))],
        hat='cap', hatColor=H(0x3a3a30),
    ),
    'sota': dict(
        body=dict(man(23, 0.45, 0.35, 0.6), details=D(head__head_oval=0.4, chin__chin_width_decr=0.3, nose__nose_hump_incr=0.3)),
        skin=dict(tone=SKIN['light'], age=0.0, dirt=0.25, stubble=0.15),
        outfit=[('pants', dict(color=H(0x2a2a30), kind='denim', mud=0.3)), ('shirt', dict(color=H(0x5a3a2a), kind='rib', ribs=140)),
                ('boots', dict(color=H(0x2a2220))), ('hair', dict(color=H(0x2a2018), style='messy'))],
        gear=['guitar'],
    ),
    'yuki': dict(
        body=dict(woman(9, 0.4, 0.4, 0.5), details=D(head__head_round=0.4)),
        skin=dict(tone=SKIN['pale'], age=0.0, dirt=0.35, red=0.45),
        outfit=[('pants', dict(color=H(0x3a3a46), mud=0.4)), ('shirt', dict(color=H(0x8a5a4a), kind='rib', ribs=110, sleeve=1.97)),
                ('boots', dict(color=H(0x3a2a22))), ('hair', dict(color=H(0x1a1410), style='bob', length=0.06))],
    ),
    'guard': dict(
        body=dict(man(32, 0.75, 0.55, 0.6), details=D(head__head_square=0.4, chin__chin_width_incr=0.3)),
        skin=dict(tone=SKIN['mid'], age=0.2, dirt=0.3, stubble=0.35),
        outfit=[('pants', dict(color=H(0x2c3026), kind='canvas', pockets=[], mud=0.5)), ('shirt', dict(color=H(0x3c4232), kind='canvas')),
                ('boots', dict(color=H(0x1e1c1a))), ('gloves', dict(color=H(0x22201c))), ('vest', dict(color=H(0x4a5038), kind='quilt')),
                ('hair', dict(color=H(0x1a1612)))],
        hat='helmet', hatColor=H(0x3a4030), gear=['pouches', 'gun'], grip=True,
    ),
    'traveler': dict(
        body=dict(man(40, 0.5, 0.42, 0.55), details=D(head__head_rectangular=0.4, nose__nose_hump_incr=0.5)),
        skin=dict(tone=SKIN['tan'], age=0.5, dirt=0.6, stubble=0.4),
        outfit=[('pants', dict(color=H(0x3a362e), kind='canvas', mud=0.8)), ('shirt', dict(color=H(0x4a4a3a), kind='canvas', wear=0.8)),
                ('boots', dict(color=H(0x2a221c))), ('beard', dict(color=H(0x3a3228))), ('hood', dict(color=H(0x4a4a3a), kind='canvas'))],
        gear=['pack'],
    ),
    'nagata': dict(
        body=dict(man(36, 0.65, 0.5, 0.6), details=D(head__head_rectangular=0.3, chin__chin_prominent_incr=0.3)),
        skin=dict(tone=SKIN['light'], age=0.3, dirt=0.1, stubble=0.15),
        outfit=[('pants', dict(color=H(0x232a30), kind='canvas')), ('shirt', dict(color=H(0x2a3440), kind='canvas', buttons=True)),
                ('boots', dict(color=H(0x141414))), ('gloves', dict(color=H(0x18181a))), ('vest', dict(color=H(0x3a4450), kind='quilt')),
                ('hair', dict(color=H(0x141210))), ('beard', dict(color=H(0x1a1612), style='moustache'))],
        hat='cap', hatColor=H(0x222a34), gear=['pouches', 'gun'], grip=True,
    ),
    'sakaki': dict(
        body=dict(man(62, 0.4, 0.45, 0.62), details=D(head__head_invertedtriangular=0.4, nose__nose_greek_incr=0.4, mouth__mouth_angles_down=0.5)),
        skin=dict(tone=SKIN['light'], age=1.0, dirt=0.05, stubble=0.1),
        outfit=[('pants', dict(color=H(0x222226))), ('shirt', dict(color=H(0x3a3a3e), buttons=True)),
                ('coat', dict(color=H(0x2a2a2e), collar=0.06, hem=0.2, buttons=True, wear=0.15, dirt=0.1)),
                ('boots', dict(color=H(0x101010), rough=0.4)), ('scarf', dict(color=H(0x6a1c18), thick=0.016, rolls=1)),
                ('hair', dict(color=H(0x9a9a9a), grey=0.6, offset=0.006))],
    ),
    'yamada': dict(
        body=dict(man(46, 0.45, 0.45, 0.5), details=D(head__head_round=0.3, nose__nose_point_down=0.4)),
        skin=dict(tone=SKIN['mid'], age=0.55, dirt=0.7, stubble=0.4),
        outfit=[('pants', dict(color=H(0x3a3428), mud=0.7)), ('shirt', dict(color=H(0x5a5040), kind='check', check=H(0x3a2a20), wear=0.7)),
                ('boots', dict(color=H(0x3a2a1e))), ('hair', dict(color=H(0x2a2420))), ('beard', dict(color=H(0x2a2420)))],
        hat='cap', hatColor=H(0x4a3a2a),
    ),
    'scout': dict(
        body=dict(man(29, 0.65, 0.48, 0.58)),
        skin=dict(tone=SKIN['mid'], age=0.2, dirt=0.4),
        outfit=[('pants', dict(color=H(0x2a2a24), kind='canvas', mud=0.6)), ('shirt', dict(color=H(0x3a3c32), kind='canvas')),
                ('boots', dict(color=H(0x1e1c1a))), ('gloves', dict(color=H(0x22201c))), ('vest', dict(color=H(0x4a4838), kind='quilt')),
                ('beanie', dict(color=H(0x2a2a26), kind='rib')), ('mask', dict(color=H(0x1c1c1c)))],
        gear=['pack', 'gun'], grip=True,
    ),
    # 駅の住人（ランダムに選ぶ）
    'citizen1': dict(
        body=dict(man(45, 0.5, 0.55, 0.52), details=D(nose__nose_scale_horiz_incr=0.4)),
        skin=dict(tone=SKIN['mid'], age=0.5, dirt=0.4, stubble=0.45),
        outfit=[('pants', dict(color=H(0x2a2a26))), ('shirt', dict(color=H(0x4a4036))),
                ('coat', dict(color=H(0x4a4036), buttons=True, hem=0.18)), ('boots', dict(color=H(0x2a221c))),
                ('scarf', dict(color=H(0x5a3a2a), kind='rib', thick=0.018)), ('beanie', dict(color=H(0x3a3a34), kind='rib'))],
    ),
    'citizen2': dict(
        body=dict(woman(34, 0.4, 0.5, 0.45), details=D(head__head_round=0.3)),
        skin=dict(tone=SKIN['light'], age=0.2, dirt=0.3, red=0.4),
        outfit=[('pants', dict(color=H(0x33302a))), ('shirt', dict(color=H(0x3a4048), kind='rib')), ('boots', dict(color=H(0x2a221c))),
                ('hair', dict(color=H(0x1a1612))), ('hood', dict(color=H(0x3a4048), kind='canvas'))],
    ),
    'citizen3': dict(
        body=dict(man(68, 0.35, 0.4, 0.45), details=D(head__head_oval=0.3, mouth__mouth_angles_down=0.4)),
        skin=dict(tone=SKIN['tan'], age=1.0, dirt=0.35),
        outfit=[('pants', dict(color=H(0x2a2e32))), ('shirt', dict(color=H(0x5a4a3a))),
                ('coat', dict(color=H(0x40382e), buttons=True, hem=0.2, wear=0.7)), ('boots', dict(color=H(0x2a221c))),
                ('hair', dict(color=H(0x8a8478), grey=0.6)), ('beard', dict(color=H(0x9a948a), grey=0.5))],
    ),
    'citizen4': dict(
        body=dict(man(22, 0.5, 0.4, 0.55), details=D(head__head_oval=0.4)),
        skin=dict(tone=SKIN['light'], age=0.0, dirt=0.3, stubble=0.2),
        outfit=[('pants', dict(color=H(0x2a2e32), kind='denim', mud=0.3)), ('shirt', dict(color=H(0x384034), zip=True)),
                ('boots', dict(color=H(0x2a221c))), ('scarf', dict(color=H(0x3a4a5a), thick=0.016, rolls=1)),
                ('hair', dict(color=H(0x1a1612), style='messy'))],
    ),
    # 赤環（略奪者）
    'bandit1': dict(
        body=dict(man(31, 0.62, 0.5, 0.58)),
        skin=dict(tone=SKIN['mid'], age=0.3, dirt=0.5, stubble=0.4),
        outfit=[('pants', dict(color=H(0x2a2624), kind='canvas', mud=0.5)), ('shirt', dict(color=H(0x3a2a2a), armband=RED)),
                ('boots', dict(color=H(0x1e1a18))), ('gloves', dict(color=H(0x221c1a))), ('vest', dict(color=H(0x5a2a20), kind='canvas')),
                ('scarf', dict(color=RED, thick=0.018)), ('hood', dict(color=H(0x3a2a2a), kind='canvas')), ('mask', dict(color=H(0x1c1a1a)))],
    ),
    'bandit2': dict(
        body=dict(man(26, 0.6, 0.55, 0.55), details=D(nose__nose_hump_incr=0.5, chin__chin_prominent_incr=0.3)),
        skin=dict(tone=SKIN['tan'], age=0.2, dirt=0.5, stubble=0.6),
        outfit=[('pants', dict(color=H(0x2a2624), kind='canvas', mud=0.5)), ('shirt', dict(color=H(0x4a2a24), armband=RED)),
                ('boots', dict(color=H(0x1e1a18))), ('gloves', dict(color=H(0x221c1a))), ('vest', dict(color=H(0x6a2a1e), kind='canvas')),
                ('scarf', dict(color=RED, thick=0.018)), ('hair', dict(color=H(0x1a1612))), ('beanie', dict(color=H(0x2e2a28), kind='rib'))],
    ),
    'bandit3': dict(
        body=dict(man(19, 0.45, 0.38, 0.55), details=D(head__head_oval=0.5)),
        skin=dict(tone=SKIN['light'], age=0.0, dirt=0.35, stubble=0.1),
        outfit=[('pants', dict(color=H(0x2a2624), kind='canvas', mud=0.4)), ('shirt', dict(color=H(0x2e2a28), armband=RED)),
                ('boots', dict(color=H(0x1e1a18))), ('gloves', dict(color=H(0x221c1a))), ('vest', dict(color=H(0x3a3a30), kind='canvas')),
                ('scarf', dict(color=RED, thick=0.016, rolls=1)), ('hair', dict(color=H(0x1a1612), style='messy'))],
    ),
}

# 服の種類ごとの既定値: (重なり順, 体からの距離 m, しわの強さ)
LAYER = {
    'pants': (1, 0.008, 0.006), 'shirt': (2, 0.011, 0.005), 'coat': (3, 0.017, 0.007), 'boots': (4, 0.016, 0.0),
    'gloves': (5, 0.005, 0.0), 'vest': (6, 0.03, 0.004), 'scarf': (7, 0.036, 0.008),
    'hair': (2, 0.009, 0.0), 'beard': (3, 0.005, 0.0), 'beanie': (5, 0.019, 0.003), 'hood': (5, 0.026, 0.006),
    'mask': (6, 0.008, 0.0),
}


# ------------------------------------------------------------ 補助
def border_distance(ob):
    """殻の縁からの（辺に沿った）距離を頂点属性 bd に書く。"""
    me = ob.data
    n = len(me.vertices)
    co = np.array([v.co[:] for v in me.vertices])
    adj = [[] for _ in range(n)]
    cnt = {}
    for p in me.polygons:
        vs = list(p.vertices)
        for a, b in zip(vs, vs[1:] + vs[:1]):
            k = (min(a, b), max(a, b))
            cnt[k] = cnt.get(k, 0) + 1
    for (a, b), c in cnt.items():
        d = float(np.linalg.norm(co[a] - co[b]))
        adj[a].append((b, d))
        adj[b].append((a, d))
    dist = np.full(n, 1.0)
    heap = []
    for (a, b), c in cnt.items():
        if c == 1:
            for v in (a, b):
                if dist[v] > 0:
                    dist[v] = 0.0
                    heap.append((0.0, v))
    heapq.heapify(heap)
    while heap:
        d, v = heapq.heappop(heap)
        if d > dist[v] or d > 0.1:
            continue
        for w, l in adj[v]:
            nd = d + l
            if nd < dist[w]:
                dist[w] = nd
                heapq.heappush(heap, (nd, w))
    a = me.attributes.get('bd') or me.attributes.new('bd', 'FLOAT', 'POINT')
    a.data.foreach_set('value', np.minimum(dist, 0.1).tolist())


def limb_attr(ob, info):
    me = ob.data
    idx = np.zeros(len(me.vertices), dtype=np.int64)
    me.attributes['src'].data.foreach_get('value', idx)
    a = me.attributes.get('tlimb') or me.attributes.new('tlimb', 'FLOAT', 'POINT')
    a.data.foreach_set('value', info.t[idx].tolist())


def mask_faces(info, img_path, thr=0.5):
    from PIL import Image
    im = np.asarray(Image.open(img_path).convert('L'), dtype=np.float32) / 255
    h, w = im.shape
    xs = np.clip((info.fuv[:, 0] * w).astype(int), 0, w - 1)
    ys = np.clip(((1 - info.fuv[:, 1]) * h).astype(int), 0, h - 1)
    return im[ys, xs] > thr


def layer_material(kind, o, ch, masks, info):
    if kind in ('boots', 'gloves'):
        return PT.leather_mat(kind, dict(o, boot=kind == 'boots'))
    if kind in ('hair', 'beard'):
        return PT.hair_mat(kind, dict(o, head=tuple(info.lm['head']), skin=ch['skin']['tone'] if kind == 'beard' else None,
                                      soft=0.015 if kind == 'beard' else 0.01))
    if kind == 'mask':
        return PT.rubber_mat(kind, o)
    o = dict(o)
    if kind == 'beanie':
        o.setdefault('cy', info.lm['head'][1])
    if kind == 'pants':
        o.setdefault('kind', 'canvas')
        o.setdefault('pockets', [])
    if o.get('armband'):
        o['armband_z'] = (info.z['shoulder'] - 0.17, info.z['shoulder'] - 0.11)
    if kind in ('shirt', 'coat') and not o.get('buttons'):
        o.setdefault('zip', kind == 'coat')
    return PT.fabric_mat(kind, o)


# ------------------------------------------------------------ 一人分
OFFSETS = {
    'pants': MD.loose(0.010, limb=0.012, cuff=0.006, torso=0.010),
    'shirt': MD.loose(0.012, limb=0.006, cuff=0.004),
    'coat': MD.loose(0.018, limb=0.010, cuff=0.008),
}


def build(name, ch, masks_paths):
    reset_scene()
    t0 = time.time()
    base = MB.Base(MPFB)
    v = MB.morph(base, ch['body'])
    rig, weights = MB.load_rig(base)
    arm = MB.build_armature(base, v, rig)
    body, _ = MB.build_mesh(base, v, {'body'}, 'body_src', weights)
    eyes, _ = MB.build_mesh(base, v, {'helper-l-eye', 'helper-r-eye'}, 'eyes', weights)
    for ob in (body, eyes):
        for p in ob.data.polygons:
            p.use_smooth = True
        MB.bind(ob, arm)
    MB.repose(arm, [body, eyes], grip_right=ch.get('grip', False))
    info = MD.Info(body, arm, os.path.join(MPFB, 'textures'))
    masks = {}
    for k, p in masks_paths.items():
        im = bpy.data.images.load(p, check_existing=True)
        im.colorspace_settings.name = 'Non-Color'
        masks[k] = im
    # 面の持ち主を決める
    outfit = list(ch['outfit'])
    kinds = {k for k, _ in outfit}
    # 帽子やマスクの下からのぞく横と後ろの髪
    if 'hair' not in kinds and 'hood' not in kinds and (kinds & {'beanie', 'mask'} or ch.get('hat')):
        outfit.append(('hair', dict(color=ch.get('hair', H(0x1a1612)))))
    nf = len(info.faces)
    owner = np.full(nf, -1)
    rank = np.zeros(nf)
    layers = []
    for i, (kind, o) in enumerate(outfit):
        r, off, fold = LAYER[kind]
        if kind == 'beard':
            c = mask_faces(info, masks_paths['moustache' if o.get('style') == 'moustache' else 'beard'], 0.5)
            c &= info.fpart == 'head'
            c &= ~mask_faces(info, masks_paths['lips'], 0.4)
        else:
            c = MD.cover(info, kind, o)
        upd = c & (r >= rank)
        owner[upd] = i
        rank[upd] = r
        layers.append((kind, o, off, fold))
    objs = []
    for i, (kind, o, off, fold) in enumerate(layers):
        owned = owner == i
        if not owned.any():
            continue
        mat = layer_material(kind, o, ch, masks, info)
        extra = []
        sel = owned
        if kind == 'boots':
            # 足先は指の形が出ないよう別に作り、筒の部分だけ殻にする
            feet = np.isin(info.fpart, ['foot_l', 'foot_r'])
            sel = owned & ~feet
            for side in ('l', 'r'):
                bf = MD.boot_block(info, side)
                MD.project_uv(bf, info, owned & (info.fpart == f'foot_{side}'))
                MG.follow_body(bf, info, [f'foot_{side}', f'calf_{side}'])
                extra.append(bf)
        if kind == 'hair' and o.get('style') == 'bun':
            bun = MD.hair_bun(info)
            MD.project_uv(bun, info, owned, shrink=0.3)
            MG.rigid(bun, 'head')
            extra.append(bun)
        if kind == 'scarf':
            for rl in MD.scarf_rolls(info, thick=o.get('thick', 0.02), rolls=o.get('rolls', 2), seed=len(name)):
                MD.project_uv(rl, info, owned, shrink=0.3)
                MG.follow_body(rl, info, ['head', 'torso'])
                extra.append(rl)
        fs = np.nonzero(sel)[0]
        off_fn = o.get('offset', OFFSETS.get(kind, off))
        if kind == 'hair' and o.get('style') == 'messy':
            off_fn = 0.014
            fold = 0.008
        if len(fs):
            fn = MD.folds(fold, seed=i * 3.1, bunch=1.5) if fold else None
            sh = MD.shell(body, set(fs.tolist()), kind, off_fn, fn, info)
            if kind == 'mask':
                # ガスマスクは顔の形をなぞらず、なめらかなゴムの面にする
                MD.relax(sh, 25, 0.7)
                for vv in sh.data.vertices:
                    vv.co.y += 0.006
            border_distance(sh)
            rim_depth = (off_fn(info, np.array([0]))[0] if callable(off_fn) else off_fn) + 0.004
            if kind == 'hair' and o.get('style') == 'bob':
                cur = MD.hair_curtain(sh, info, length=o.get('length', 0.09))
                MD.project_uv(cur, info, owned, shrink=0.3)
                MG.follow_body(cur, info, ['head'])
                extra.append(cur)
            MD.rim(sh, rim_depth, info)
            limb_attr_safe(sh, info)
            extra.insert(0, sh)
        for ob in extra:
            for a in ('bd', 'tlimb'):
                if a not in ob.data.attributes:
                    ob.data.attributes.new(a, 'FLOAT', 'POINT')
            ob.data.materials.clear()
            ob.data.materials.append(mat)
            objs.append(ob)
    skin_faces = set(np.nonzero(owner < 0)[0].tolist())
    sk = MD.shell(body, skin_faces, 'skin', 0.0, None, info)
    border_distance(sk)
    limb_attr_safe(sk, info)
    sm = PT.skin_mat('skin', ch['skin'], masks)
    sk.data.materials.clear()
    sk.data.materials.append(sm)
    if len(sk.data.polygons):
        objs.insert(0, sk)
    else:
        bpy.data.objects.remove(sk)  # 全身が服で覆われている
    # 目: 球を細かくし、正面を中心にした円盤状の UV で右上の空き区画へ置く
    cen = {s: Vector(v[base.group_verts(f'joint-{s}-eye')].mean(axis=0)) for s in ('l', 'r')}
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(eyes.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True, smooth=1.0)
    bm.to_mesh(eyes.data)
    bm.free()
    u0, v0, u1, v1 = MD.FREE_UV
    me = eyes.data
    uv = me.uv_layers.active.data
    for p in me.polygons:
        side = 'l' if p.center.x < 0 else 'r'
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            d = (co - cen[side]).normalized()
            th = math.acos(max(-1.0, min(1.0, d.y))) / math.pi
            rr = math.hypot(d.x, d.z) or 1.0
            cu = u0 + (u1 - u0) * (0.25 if side == 'l' else 0.75)
            cv = (v0 + v1) / 2
            uv[li].uv = (cu + d.x / rr * th * (u1 - u0) * 0.24, cv + d.z / rr * th * (v1 - v0) * 0.48)
    eyes.data.materials.clear()
    eyes.data.materials.append(PT.eye_mat('eye_l', ch.get('eye', {}), cen['l'], (0, 1, 0)))
    eyes.data.materials.append(PT.eye_mat('eye_r', ch.get('eye', {}), cen['r'], (0, 1, 0)))
    for p in me.polygons:
        p.material_index = 0 if p.center.x < 0 else 1
    for a in ('bd', 'tlimb'):
        eyes.data.attributes.new(a, 'FLOAT', 'POINT')
    objs.append(eyes)
    # 装備
    gear, opt = make_gear(ch, info, base, v)
    print(f'[{name}] dressed {time.time() - t0:.1f}s')
    # ---- 焼き込み
    body.hide_render = True
    for ob in objs:
        for slot in ob.material_slots:
            PT.add_target(slot.material, None)
    imgs = {}
    for key, kind, samples, data in (('c', 'DIFFUSE', 1, False), ('n', 'NORMAL', 1, True), ('r', 'ROUGHNESS', 1, True), ('ao', 'AO', 24, True)):
        im = bpy.data.images.new(f'{name}_{key}', TEX, TEX, alpha=True, float_buffer=True, is_data=data)
        PT.bake(objs, kind, im, samples=samples)
        imgs[key] = PT.dilate(PT.image_array(im))
        print(f'[{name}] baked {key} {time.time() - t0:.1f}s')
    ao = imgs['ao'][..., :1]
    color = imgs['c'][..., :3] * (0.35 + 0.65 * ao)
    texdir = os.path.join(OUT, 'tex')
    PT.save_png(color, os.path.join(texdir, f'ch_{name}_c.png'), srgb_out=True)
    PT.save_png(imgs['n'], os.path.join(texdir, f'ch_{name}_n.png'))
    rr = np.repeat(imgs['r'][..., :1], 3, axis=2)
    PT.save_png(rr, os.path.join(texdir, f'ch_{name}_r.png'))
    # ---- まとめて書き出す
    bpy.data.objects.remove(body)
    final = finalize(name, arm, objs, gear, opt, info)
    print(f'[{name}] exported {time.time() - t0:.1f}s')
    return final


def limb_attr_safe(ob, info):
    if 'src' in ob.data.attributes:
        limb_attr(ob, info)


def make_gear(ch, info, base, v):
    gear, opt = [], {}
    hat = ch.get('hat')
    if hat == 'helmet':
        gear.append(MG.helmet(info))
    elif hat == 'cap':
        gear.append(MG.cap(info))
    if any(k == 'mask' for k, _ in ch['outfit']):  # noqa
        eyes = {s: Vector(v[base.group_verts(f'joint-{s}-eye')].mean(axis=0)) for s in ('l', 'r')}
        gear.append(MG.mask_parts(info, eyes))
    for g in ch.get('gear', []):
        if g == 'pack':
            gear += MG.pack(info)
        elif g == 'pouches':
            gear.append(MG.pouches(info))
        elif g == 'gun':
            opt['gun'] = MG.rifle(info)
        elif g == 'guitar':
            opt['guitar'] = MG.guitar(info)
        elif g == 'headphones':
            gear.append(MG.headphones(info))
        elif g == 'lantern':
            opt['lantern'] = MG.lantern(info)
    return gear, opt


def join_objects(objs, name):
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = objs[0]
    ob.name = name
    ob.data.name = name
    return ob


def finalize(name, arm, objs, gear, opt, info):
    for ob in objs:
        ob.modifiers.clear()
        ob.parent = None
    body = join_objects(objs, 'body')
    body.data.materials.clear()
    body.data.materials.append(bpy.data.materials.get('body') or bpy.data.materials.new('body'))
    for p in body.data.polygons:
        p.material_index = 0
    # 顔と手は細かいまま、ほかを間引く
    keep = body.vertex_groups.new(name='_keep')
    hv = [i for i, vv in enumerate(body.data.vertices) if vv.co.z > info.z['neck'] + 0.02]
    keep.add(hv, 1.0, 'REPLACE')
    dec = body.modifiers.new('dec', 'DECIMATE')
    dec.ratio = DECIMATE
    dec.vertex_group = '_keep'
    dec.invert_vertex_group = True
    dec.vertex_group_factor = 0.85
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier='dec')
    kg = body.vertex_groups.get('_keep')
    if kg:
        body.vertex_groups.remove(kg)
    out = [body]
    if gear:
        g = join_objects(gear, 'gear')
        out.append(g)
    for k, ob in opt.items():
        ob.name = k
        # ゲーム側はマテリアル名の接頭辞（gun_ など）で持ち物を見分ける
        for slot in ob.material_slots:
            if slot.material and not slot.material.name.startswith(k + '_'):
                mm = slot.material.copy()
                mm.name = f'{k}_{slot.material.name}'
                slot.material = mm
        out.append(ob)
    for ob in out:
        for a in list(ob.data.attributes):
            if a.name in ('src', 'bd', 'tlimb'):
                ob.data.attributes.remove(a)
        ob.parent = arm
        m = ob.modifiers.new('Armature', 'ARMATURE')
        m.object = arm
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    arm.select_set(True)
    for ob in out:
        ob.select_set(True)
    path = os.path.abspath(os.path.join(OUT, f'{name}.glb'))
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_skins=True, export_animations=False, export_materials='EXPORT', export_attributes=False,
                              export_cameras=False, export_lights=False)
    tris = sum(len(ob.data.polygons) for ob in out)
    print(f'[{name}] glb {os.path.getsize(path)} bytes, faces {tris}')
    return out


def main():
    tmp = os.path.join(OUT, 'masks')
    MM_paths = {}
    os.makedirs(tmp, exist_ok=True)
    for k, im in MM.face_masks(2048).items():
        p = os.path.join(tmp, f'mask_{k}.png')
        im.save(p)
        MM_paths[k] = p
    for k in ('ears', 'lips', 'eyelids', 'fingernails'):
        MM_paths[k] = os.path.join(MPFB, 'textures', f'mpfb_{k}.jpg')
    for name, ch in CHARS.items():
        if ONLY and name not in ONLY:
            continue
        build(name, ch, MM_paths)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT, f'{name}.blend')))


if __name__ == '__main__':
    main()
