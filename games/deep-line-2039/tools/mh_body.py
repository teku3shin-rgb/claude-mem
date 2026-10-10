"""MakeHuman（MPFB2）の CC0 データから、リグ付きの人体を Blender 上に組み立てる。

座標系:
  MakeHuman の obj は Y が上・単位デシメートル・+Z を向いている。
  これを Blender の Z 上・メートル・+Y 向き（blender_common.py の約束）に直す: (x, y, z) -> (-x, z, y) * 0.1
  キャラクターの左は -X、右は +X になる（ゲーム側の shL / shR と同じ）。
"""
import gzip
import json
import math
import os

import bpy  # noqa: F401  （bmesh / mathutils より先に読み込む）
import numpy as np
from mathutils import Matrix, Vector

S = 0.1
# MakeHuman 座標 -> Blender 座標
CONV = np.array([[-1, 0, 0], [0, 0, 1], [0, 1, 0]], dtype=np.float64) * S


class Base:
    """基本メッシュ（hm08）とターゲット、リグの読み込み。"""

    def __init__(self, root):
        self.root = root
        verts, uvs, faces = [], [], []
        group = None
        with open(os.path.join(root, '3dobjs', 'base.obj')) as fh:
            for line in fh:
                if line.startswith('v '):
                    verts.append([float(x) for x in line.split()[1:4]])
                elif line.startswith('vt '):
                    uvs.append([float(x) for x in line.split()[1:3]])
                elif line.startswith('g '):
                    group = line.split()[1]
                elif line.startswith('f '):
                    vi, ti = [], []
                    for p in line.split()[1:]:
                        a = p.split('/')
                        vi.append(int(a[0]) - 1)
                        ti.append(int(a[1]) - 1 if len(a) > 1 and a[1] else -1)
                    faces.append((group, vi, ti))
        self.verts = np.array(verts, dtype=np.float64)
        self.uvs = uvs
        self.faces = faces
        with open(os.path.join(root, 'mesh_metadata', 'basemesh_vertex_groups.json')) as fh:
            self.vgroups = json.load(fh)
        self.target_index = {}
        for dirpath, _, files in os.walk(os.path.join(root, 'targets')):
            for f in files:
                if f.endswith('.target.gz'):
                    rel = os.path.relpath(os.path.join(dirpath, f), os.path.join(root, 'targets'))
                    self.target_index[rel[:-len('.target.gz')]] = os.path.join(dirpath, f)
        self._cache = {}

    def group_verts(self, name):
        out = []
        for a, b in self.vgroups[name]:
            out.extend(range(a, b + 1))
        return out

    def target(self, name):
        if name not in self._cache:
            path = self.target_index.get(name)
            if path is None:
                self._cache[name] = None
            else:
                idx, d = [], []
                with gzip.open(path, 'rt') as fh:
                    for line in fh:
                        p = line.split()
                        if len(p) == 4:
                            idx.append(int(p[0]))
                            d.append([float(p[1]), float(p[2]), float(p[3])])
                # 空のターゲット（基本形そのもの）は None 扱い
                self._cache[name] = (np.array(idx, dtype=np.int64), np.array(d, dtype=np.float64).reshape(-1, 3)) if idx else None
        return self._cache[name]


# ------------------------------------------------------------ マクロ（性別・年齢・筋肉・体重など）
def _two(v, lo, mid, hi):
    """0..0.5..1 を lo/mid/hi の重みに分ける。"""
    if v < 0.5:
        t = v / 0.5
        return {lo: 1 - t, mid: t}
    t = (v - 0.5) / 0.5
    return {mid: 1 - t, hi: t}


def _age(v):
    if v < 0.1875:
        t = v / 0.1875
        return {'baby': 1 - t, 'child': t}
    if v < 0.5:
        t = (v - 0.1875) / (0.5 - 0.1875)
        return {'child': 1 - t, 'young': t}
    t = (v - 0.5) / 0.5
    return {'young': 1 - t, 'old': t}


def age_value(years):
    """年齢（歳）を MakeHuman の 0..1 に直す。1 歳=0、11 歳=0.1875、25 歳=0.5、90 歳=1。"""
    if years <= 11:
        return max(0.0, (years - 1) / 10 * 0.1875)
    if years <= 25:
        return 0.1875 + (years - 11) / 14 * 0.3125
    return min(1.0, 0.5 + (years - 25) / 65 * 0.5)


def macro_targets(gender=0.5, age=0.5, muscle=0.5, weight=0.5, height=0.5, proportions=0.5,
                  race=None, cup=0.5, firmness=0.5):
    race = race or {'asian': 1 / 3, 'african': 1 / 3, 'caucasian': 1 / 3}
    G = {'female': 1 - gender, 'male': gender}
    A = _age(age)
    M = _two(muscle, 'minmuscle', 'averagemuscle', 'maxmuscle')
    W = _two(weight, 'minweight', 'averageweight', 'maxweight')
    H = {'minheight': 1 - height / 0.5} if height < 0.5 else {'maxheight': (height - 0.5) / 0.5}
    P = {'uncommonproportions': 1 - proportions / 0.5} if proportions < 0.5 else {'idealproportions': (proportions - 0.5) / 0.5}
    C = _two(cup, 'mincup', 'averagecup', 'maxcup')
    F = _two(firmness, 'minfirmness', 'averagefirmness', 'maxfirmness')
    out = []
    for g, wg in G.items():
        for a, wa in A.items():
            for r, wr in race.items():
                out.append((f'macrodetails/{r}-{g}-{a}', wg * wa * wr))
            for m, wm in M.items():
                for w, ww in W.items():
                    base = wg * wa * wm * ww
                    out.append((f'macrodetails/universal-{g}-{a}-{m}-{w}', base))
                    for h, wh in H.items():
                        out.append((f'macrodetails/height/{g}-{a}-{m}-{w}-{h}', base * wh))
                    for p, wp in P.items():
                        out.append((f'macrodetails/proportions/{g}-{a}-{m}-{w}-{p}', base * wp))
                    for c, wc in C.items():
                        for f, wf in F.items():
                            out.append((f'breast/{g}-{a}-{m}-{w}-{c}-{f}', base * wc * wf))
    return [(n, w) for n, w in out if w > 1e-4]


def morph(base, spec):
    """spec: {'gender':..., 'age':..., ..., 'details': {'nose/nose-scale-horiz-incr': 0.4, ...}}
    戻り値: Blender 座標の頂点配列 (N, 3)"""
    v = base.verts.copy()
    macro = {k: spec[k] for k in ('gender', 'age', 'muscle', 'weight', 'height', 'proportions', 'race', 'cup', 'firmness') if k in spec}
    todo = macro_targets(**macro) + list(spec.get('details', {}).items())
    for name, w in todo:
        t = base.target(name)
        if t is None:
            continue
        idx, d = t
        v[idx] += d * w
    out = v @ CONV.T
    # 足の裏を地面（z=0）にそろえる
    body = base.group_verts('body')
    out[:, 2] -= out[body, 2].min()
    return out


# ------------------------------------------------------------ メッシュとリグ
def build_mesh(base, verts, groups, name, weights=None, uv=True):
    """groups に属する面だけで新しいメッシュを作る。戻り値: (オブジェクト, 元の頂点番号 -> 新しい番号)"""
    fs = [f for f in base.faces if f[0] in groups]
    used = sorted({i for f in fs for i in f[1]})
    remap = {o: n for n, o in enumerate(used)}
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(verts[i]) for i in used], [], [[remap[i] for i in f[1]] for f in fs])
    if uv:
        layer = me.uv_layers.new(name='UVMap')
        k = 0
        for f in fs:
            for t in f[2]:
                layer.data[k].uv = base.uvs[t] if t >= 0 else (0, 0)
                k += 1
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if weights:
        for bone, lst in weights.items():
            vg = None
            for i, w in lst:
                j = remap.get(i)
                if j is None or w <= 0:
                    continue
                if vg is None:
                    vg = obj.vertex_groups.new(name=bone)
                vg.add([j], w, 'REPLACE')
    obj['mh_remap_src'] = len(used)
    return obj, remap


def load_rig(base, kind='game_engine'):
    with open(os.path.join(base.root, 'rigs', 'standard', f'rig.{kind}.json')) as fh:
        rig = json.load(fh)
    with open(os.path.join(base.root, 'rigs', 'standard', f'weights.{kind}.json')) as fh:
        weights = json.load(fh)['weights']
    return rig, weights


def _joint_pos(base, verts, spec):
    if spec['strategy'] == 'CUBE':
        idx = base.group_verts(spec['cube_name'])
    elif spec['strategy'] in ('MEAN', 'VERTEX'):
        idx = spec.get('vertex_indices') or [spec['vertex_index']]
    else:
        raise ValueError(spec['strategy'])
    return Vector(verts[idx].mean(axis=0))


def build_armature(base, verts, rig, name='rig'):
    arm = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for bname, b in rig.items():
        e = arm.edit_bones.new(bname)
        e.head = _joint_pos(base, verts, b['head'])
        e.tail = _joint_pos(base, verts, b['tail'])
        if (e.tail - e.head).length < 1e-4:
            e.tail = e.head + Vector((0, 0, 0.02))
        e.roll = b.get('roll', 0.0)
        eb[bname] = e
    for bname, b in rig.items():
        if b.get('parent'):
            eb[bname].parent = eb[b['parent']]
            eb[bname].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


def bind(mesh_obj, arm_obj):
    mesh_obj.parent = arm_obj
    m = mesh_obj.modifiers.new('Armature', 'ARMATURE')
    m.object = arm_obj
    return m


# ------------------------------------------------------------ 姿勢の付け替え（A ポーズ → 腕を下ろした姿勢）
def _rot_bone_to(pb, target_dir):
    """ポーズボーンを、根元を中心に回して target_dir（アーマチュア空間）へ向ける。"""
    head = pb.head.copy()
    cur = (pb.tail - pb.head).normalized()
    q = cur.rotation_difference(target_dir.normalized())
    M = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head)
    pb.matrix = M @ pb.matrix
    bpy.context.view_layer.update()


def _rot_bone(pb, axis, angle):
    head = pb.head.copy()
    M = Matrix.Translation(head) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-head)
    pb.matrix = M @ pb.matrix
    bpy.context.view_layer.update()


def repose(arm_obj, meshes, arm_out=0.16, elbow=0.06, finger_curl=0.25, grip_right=False):
    """腕を体の横に下ろし、指を軽く曲げた姿勢を新しい基本姿勢にする。"""
    bpy.context.view_layer.update()
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='POSE')
    P = arm_obj.pose.bones
    for side, sx in (('l', -1), ('r', 1)):
        down = Vector((sx * math.sin(arm_out), 0.0, -math.cos(arm_out)))
        _rot_bone_to(P[f'upperarm_{side}'], down)
        fore = Vector((sx * math.sin(arm_out * 0.6), math.sin(elbow), -math.cos(elbow)))
        _rot_bone_to(P[f'lowerarm_{side}'], fore)
        hand_dir = (P[f'lowerarm_{side}'].tail - P[f'lowerarm_{side}'].head).normalized()
        _rot_bone_to(P[f'hand_{side}'], hand_dir)
        curl = finger_curl * (2.6 if (grip_right and side == 'r') else 1.0)
        for f in ('index', 'middle', 'ring', 'pinky'):
            for j in ('01', '02', '03'):
                pb = P[f'{f}_{j}_{side}']
                # 手のひら側へ曲げる軸: 手の向き × 手の甲の向き（近似として体の前後軸）
                ax = Vector((0, 1, 0)).cross((pb.tail - pb.head).normalized())
                if ax.length > 1e-6:
                    _rot_bone(pb, ax.normalized(), -sx * curl * (0.6 if j == '01' else 1.0))
    bpy.ops.object.mode_set(mode='OBJECT')
    # 変形をメッシュへ焼き込み、ポーズを基本姿勢にする
    for m in meshes:
        bpy.context.view_layer.objects.active = m
        for mod in m.modifiers:
            if mod.type == 'ARMATURE':
                bpy.ops.object.modifier_apply(modifier=mod.name)
                break
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for m in meshes:
        bind(m, arm_obj)
