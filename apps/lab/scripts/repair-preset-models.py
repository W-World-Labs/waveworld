"""把非流形/超限的预设资产修复为水密 STL。

策略：体素化 → marching cubes → apply(v.transform) 回世界坐标 → 水密封闭壳。
ares-rocket 只保留主体簇（丢弃游离装配件），烘焙真实姿态与尺度。
x57 先减面到契约内再重网格。
"""
import trimesh, numpy as np

from pathlib import Path
MODELS = str(Path(__file__).resolve().parents[1] / 'public' / 'models')

def load_concat(path, keep=None):
    s = trimesh.load(path)
    if not hasattr(s, 'to_mesh'):
        return s
    if keep is None:
        return s.to_mesh()
    parts = []
    for node in s.graph.nodes_geometry:
        T, gname = s.graph[node]
        g = s.geometry[gname]
        wb = trimesh.transformations.transform_points(g.bounds, T)
        if keep(wb):
            parts.append(g.copy().apply_transform(T))
    return trimesh.util.concatenate(parts)

def voxel_remesh(m, pitch):
    v = trimesh.voxel.creation.voxelize(m, pitch)
    out = v.marching_cubes.copy()
    out.apply_transform(v.transform)  # 索引坐标 → 世界坐标
    out.merge_vertices()
    out.remove_unreferenced_vertices()
    if not out.is_watertight:
        out.fill_holes()
    out.fix_normals()
    return out

def report(tag, m):
    b = m.bounds
    print(f"{tag}: verts={len(m.vertices)} faces={len(m.faces)} watertight={m.is_watertight} "
          f"winding={m.is_winding_consistent} "
          f"x[{b[0][0]:.2f},{b[1][0]:.2f}] y[{b[0][1]:.2f},{b[1][1]:.2f}] z[{b[0][2]:.2f},{b[1][2]:.2f}]", flush=True)

def fix(name, pitch=None, target_cells=160):
    m = load_concat(f'{MODELS}/{name}')
    report(f'{name} raw', m)
    p = pitch or (max(m.extents) / target_cells)
    out = voxel_remesh(m, p)
    out.export(f'{MODELS}/{name.rsplit(".",1)[0]}-solid.stl')
    report(f'{name} -> -solid.stl', out)

# 保持原姿态（应用侧已有旋转/缩放逻辑），只修拓扑
fix('milk-truck.glb')
fix('toy-car.glb')
fix('bicycle.stl')
fix('rocket.glb')
fix('space-shuttle.glb')

# ares-rocket：只保留主箭体簇（world |z|<1），游离件丢弃。
# 烘焙：+Y 箭轴 → -X（Rz+90，同 rocket 的应用内规则），缩放到 90m 长。
m = load_concat(f'{MODELS}/ares-rocket.glb', keep=lambda b: abs(b[0][2]) < 1 and abs(b[1][2]) < 1)
report('ares main-body', m)
out = voxel_remesh(m, max(m.extents) / 200)
v = out.vertices.copy()
out.vertices = np.stack([-v[:,1], v[:,0], v[:,2]], axis=1)
out.fix_normals()
scale = 90.0 / (out.bounds[1][0] - out.bounds[0][0])
out.apply_scale(scale)
out.vertices[:,1] -= out.bounds[0][1]
out.export(f'{MODELS}/ares-rocket-solid.stl')
report('ares-rocket -> -solid.stl', out)

# x57：减面 + 重网格 + 归一化到 9.75m 最大尺度
m = load_concat(f'{MODELS}/airplane-x57.glb')
report('x57 raw', m)
simp = m.simplify_quadric_decimation(face_count=250_000)
report('x57 decimated', simp)
out = voxel_remesh(simp, max(simp.extents) / 200)
scale = 9.75 / max(out.extents)
out.apply_scale(scale)
out.vertices[:,1] -= out.bounds[0][1]
out.export(f'{MODELS}/airplane-x57-solid.stl')
report('airplane-x57 -> -solid.stl', out)
