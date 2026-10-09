"""Blender (bpy) 用の共通ヘルパー。

座標系の約束:
  Blender は Z が上、キャラクターは +Y を向いて作る。
  glTF 書き出し時に (x, y, z) -> (x, z, -y) へ変換されるので、three.js 上では -Z を向く。
  ピボットは回転なしの Empty にして、ゲーム側の手続き型アニメーション（rotation.x など）で動かす。
"""
import math

import bpy  # bpy を先に読み込むと bmesh / mathutils が使えるようになる
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402


# ---------------------------------------------------------------- シーン
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.textures, bpy.data.images):
        for item in list(block):
            block.remove(item)


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.05
    link(e)
    e.location = loc
    if parent is not None:
        e.parent = parent
    return e


def set_parent(obj, parent, loc=None):
    obj.parent = parent
    if loc is not None:
        obj.location = loc
    return obj


# ---------------------------------------------------------------- マテリアル
def material(name, color=(0.8, 0.8, 0.8), rough=0.8, metal=0.0, emission=None, strength=1.0):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1.0)
        bsdf.inputs['Emission Strength'].default_value = strength
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


# ---------------------------------------------------------------- メッシュ生成
def mesh_obj(name, verts, faces=(), edges=()):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], list(edges), [tuple(f) for f in faces])
    me.update()
    return link(bpy.data.objects.new(name, me))


def _active():
    return bpy.context.view_layer.objects.active


def uv_sphere(name, radius=1.0, loc=(0, 0, 0), scale=(1, 1, 1), seg=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=radius, location=loc)
    o = _active()
    o.name = name
    o.scale = scale
    apply_transform(o)
    return o


def cube(name, size=(1, 1, 1), loc=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = _active()
    o.name = name
    o.scale = size
    apply_transform(o)
    return o


def cylinder(name, radius=0.5, depth=1.0, loc=(0, 0, 0), rot=(0, 0, 0), verts=16, r2=None, fill='NGON'):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot, end_fill_type=fill)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radius, radius2=r2, depth=depth, location=loc, rotation=rot, end_fill_type=fill)
    o = _active()
    o.name = name
    apply_transform(o)
    return o


def cone(name, radius=0.1, depth=0.3, loc=(0, 0, 0), rot=(0, 0, 0), verts=8):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radius, radius2=0.0, depth=depth, location=loc, rotation=rot)
    o = _active()
    o.name = name
    apply_transform(o)
    return o


def torus(name, major=0.1, minor=0.02, loc=(0, 0, 0), rot=(0, 0, 0), seg=24, mseg=8):
    bpy.ops.mesh.primitive_torus_add(major_segments=seg, minor_segments=mseg, major_radius=major, minor_radius=minor, location=loc, rotation=rot)
    o = _active()
    o.name = name
    apply_transform(o)
    return o


def ico(name, radius=0.5, loc=(0, 0, 0), sub=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=radius, location=loc)
    o = _active()
    o.name = name
    apply_transform(o)
    return o


def apply_transform(o):
    """位置以外（回転・拡大）をメッシュに焼き込み、位置もメッシュへ移して原点を 0 にする。"""
    mat = o.matrix_basis.copy()
    o.data.transform(mat)
    o.matrix_basis = Matrix.Identity(4)
    o.matrix_world = Matrix.Identity(4)
    o.data.update()
    return o


def translate(o, d):
    o.data.transform(Matrix.Translation(Vector(d)))
    o.data.update()
    return o


def rotate(o, angle, axis):
    o.data.transform(Matrix.Rotation(angle, 4, axis))
    o.data.update()
    return o


def scale_mesh(o, s):
    o.data.transform(Matrix.Diagonal((*s, 1.0)))
    o.data.update()
    return o


# ---------------------------------------------------------------- モディファイア
def subsurf(o, levels=1):
    m = o.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    return o


def bevel(o, width=0.005, segments=2, limit='ANGLE'):
    m = o.modifiers.new('bev', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = limit
    return o


def displace(o, strength=0.02, size=0.2, kind='CLOUDS', depth=2, coords='OBJECT', vgroup=None, mid=0.5):
    tex = bpy.data.textures.new(o.name + '_d', kind)
    if kind in ('CLOUDS', 'STUCCI', 'MARBLE', 'WOOD'):
        tex.noise_scale = size
        if hasattr(tex, 'noise_depth'):
            tex.noise_depth = depth
    if kind == 'VORONOI':
        tex.noise_scale = size
    m = o.modifiers.new('disp', 'DISPLACE')
    m.texture = tex
    m.strength = strength
    m.mid_level = mid
    m.texture_coords = coords
    if vgroup:
        m.vertex_group = vgroup
    return tex


def solidify(o, thickness=0.01):
    m = o.modifiers.new('solid', 'SOLIDIFY')
    m.thickness = thickness
    return o


def skin(name, verts, edges, radii, root=0):
    """スキンモディファイアで、骨格（頂点と辺）と半径から有機的な形を作る。"""
    o = mesh_obj(name, verts, edges=edges)
    o.modifiers.new('skin', 'SKIN')
    sv = o.data.skin_vertices[0].data
    for i, r in enumerate(radii):
        if isinstance(r, (int, float)):
            r = (r, r)
        sv[i].radius = r
        sv[i].use_root = i == root
    return o


def apply_mods(o):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = o.data
    o.modifiers.clear()
    o.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return o


def smooth(o, angle=None):
    me = o.data
    for p in me.polygons:
        p.use_smooth = True
    if angle is not None:
        try:
            me.set_sharp_from_angle(angle=math.radians(angle))
        except Exception:
            pass
    me.update()
    return o


def flat(o):
    for p in o.data.polygons:
        p.use_smooth = False
    o.data.update()
    return o


def delete_verts(o, pred):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    kill = [v for v in bm.verts if pred(v.co)]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return o


def warp(o, fn):
    """頂点ごとに座標を書き換える（細かな造形用）。"""
    for v in o.data.vertices:
        v.co = Vector(fn(v.co.copy()))
    o.data.update()
    return o


def join(objs, name):
    """同じマテリアルのメッシュを一つにまとめる（描画回数の削減）。"""
    bpy.context.view_layer.update()
    bm = bmesh.new()
    mats = []
    for o in objs:
        me = o.data.copy()
        me.transform(o.matrix_world)
        start = len(bm.faces)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        mat = o.data.materials[0] if o.data.materials else None
        if mat not in mats:
            mats.append(mat)
        idx = mats.index(mat)
        bm.faces.ensure_lookup_table()
        for f in bm.faces[start:]:
            f.material_index = idx
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    return link(bpy.data.objects.new(name, me))


# ---------------------------------------------------------------- UV
def unwrap(o, unit=0.4, angle=66):
    """スマートUV展開のあと、1 UV = unit メートルになるよう縮尺をそろえる（タイル用テクスチャ向け）。"""
    for ob in bpy.context.scene.objects:
        if ob is not None:
            ob.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.01, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    me = o.data
    uv = me.uv_layers.active.data
    area3d = sum(p.area for p in me.polygons)
    area_uv = 0.0
    for p in me.polygons:
        pts = [uv[i].uv for i in p.loop_indices]
        a = 0.0
        for i in range(len(pts)):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % len(pts)]
            a += x0 * y1 - x1 * y0
        area_uv += abs(a) / 2
    if area_uv > 1e-9:
        k = math.sqrt(area3d / area_uv) / unit
        for d in uv:
            d.uv = d.uv * k
    o.select_set(False)
    return o


# ---------------------------------------------------------------- 仕上げ
def finish(o, mat, unit=0.4, smooth_angle=None, flat_shade=False):
    apply_mods(o)
    if flat_shade:
        flat(o)
    else:
        smooth(o, smooth_angle)
    assign(o, mat)
    unwrap(o, unit)
    return o


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )


def stats():
    tris = 0
    verts = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
            verts += len(o.data.vertices)
    return verts, tris
