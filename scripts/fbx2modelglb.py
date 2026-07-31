# Convert a character FBX (e.g. a Mixamo T-pose download) into a GLB model
# for DJ Visualizer: mesh + skeleton/skin kept, animations dropped (the dance
# library provides the moves), embedded diffuse texture recovered even when
# the FBX references missing external files.
#   blender -b -P fbx2modelglb.py -- input.fbx output.glb
import bpy, sys, os
argv = sys.argv[sys.argv.index('--')+1:]
SRC, OUT = argv[0], argv[1]
TMP = OUT + '.diffuse.png'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
arm = None; meshes = []
for o in bpy.data.objects:
    if o.type == 'ARMATURE' and arm is None:
        arm = o
    if o.type == 'MESH':
        meshes.append(o)
if not meshes:
    raise SystemExit('nessuna mesh nel file')
# drop any animation, keep the rest pose
for o in bpy.data.objects:
    o.animation_data_clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
if arm:
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
# recover the diffuse: prefer an embedded image that actually has data
valid = [i for i in bpy.data.images if i.has_data and i.size[0] > 0]
diff = next((i for i in valid if 'Diffuse' in i.name), valid[0] if valid else None)
if diff:
    try:
        diff.filepath_raw = TMP
        diff.file_format = 'PNG'
        diff.save()
        diff = bpy.data.images.load(TMP)
        diff.pack()
        mat = bpy.data.materials.new('skin')
        mat.use_nodes = True
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = diff
        mat.node_tree.links.new(bsdf.inputs['Base Color'], tex.outputs['Color'])
        for m in meshes:
            m.data.materials.clear()
            m.data.materials.append(mat)
    except Exception as e:
        print('texture non recuperata:', e)
try:
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=False,
        export_skins=True, export_rest_position_armature=True)
except TypeError:
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=False, export_skins=True)
try:
    os.remove(TMP)
except OSError:
    pass
print('EXPORT_OK')
