# Convert a Mixamo animation FBX into a skeleton-only GLB clip for the
# DJ Visualizer dance library (bones only, no mesh — tiny files).
#   blender -b -P fbx2animglb.py -- input.fbx output.glb
import bpy, sys, os
argv = sys.argv[sys.argv.index('--')+1:]
SRC, OUT = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
arm = None
for o in list(bpy.data.objects):
    if o.type == 'ARMATURE' and arm is None:
        arm = o
    elif o.type == 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
name = os.path.splitext(os.path.basename(SRC))[0].replace('_with_skin', '')
act = arm.animation_data.action if arm and arm.animation_data else None
if not act:
    raise SystemExit('nessuna animazione nel file')
act.name = name
act.use_fake_user = True
ad = arm.animation_data
ad.action = None
tr = ad.nla_tracks.new()
tr.name = name
tr.strips.new(name, int(act.frame_range[0]), act)
try:
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
        export_animations=True, export_animation_mode='NLA_TRACKS')
except TypeError:
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=True)
print('EXPORT_OK')
