# Merge Mixamo FBX files (1 character + N animations, same rig family) into a
# single GLB with all the clips, ready for DJ Visualizer's dance director.
#
#   blender -b -P scripts/merge-mixamo.py -- <base.fbx> <anim1.fbx> ... <out.glb>
#
# - the base FBX provides the character (mesh+skin); its embedded diffuse
#   texture is recovered when the FBX references missing external files
# - animation FBX files only contribute their action (objects are discarded)
# - bone-name prefixes are retargeted (mixamorig / mixamorig1 / ...) so clips
#   recorded for another character land on this rig's bones
import bpy, os, re, sys
argv = sys.argv[sys.argv.index('--')+1:]
BASE, DANCES, OUT = argv[0], argv[1:-1], argv[-1]
TMP = os.path.join(os.path.dirname(OUT) or '.', '_diffuse_tmp.png')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=BASE)
base_arm = None; meshes = []
for o in bpy.data.objects:
    if o.type == 'ARMATURE': base_arm = o
    if o.type == 'MESH': meshes.append(o)
print('BASE bones:', len(base_arm.data.bones),
      'meshes:', [(m.name, len(m.data.vertices)) for m in meshes])
valid = [i for i in bpy.data.images if i.has_data and i.size[0] > 0]
diff = next((i for i in valid if 'Diffuse' in i.name), valid[0] if valid else None)
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
if diff:
    diff.filepath_raw = TMP; diff.file_format = 'PNG'; diff.save()
    diff = bpy.data.images.load(TMP); diff.pack()
    mat = bpy.data.materials.new('skin'); mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage'); tex.image = diff
    mat.node_tree.links.new(bsdf.inputs['Base Color'], tex.outputs['Color'])
    for m in meshes:
        m.data.materials.clear(); m.data.materials.append(mat)
for src in DANCES:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=src)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in new if o.type == 'ARMATURE'), None)
    name = os.path.splitext(os.path.basename(src))[0].replace('_with_skin', '')
    a = arm.animation_data.action if arm and arm.animation_data else None
    if a:
        a.name = name; a.use_fake_user = True
        print('CLIP:', name)
    for o in new: bpy.data.objects.remove(o, do_unlink=True)
base_prefix = base_arm.data.bones[0].name.split(':')[0]
for act in bpy.data.actions:
    for fc in act.fcurves:
        if 'mixamorig' in fc.data_path and not fc.data_path.startswith('pose.bones["%s:' % base_prefix):
            fc.data_path = re.sub(r'mixamorig\d*:', base_prefix + ':', fc.data_path)
ad = base_arm.animation_data or base_arm.animation_data_create()
ad.action = None
for a in bpy.data.actions:
    tr = ad.nla_tracks.new(); tr.name = a.name
    tr.strips.new(a.name, int(a.frame_range[0]), a)
try:
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=True,
        export_skins=True, export_animation_mode='NLA_TRACKS')
except TypeError:
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=True, export_skins=True)
print('TOT_CLIPS:', len(bpy.data.actions)); print('EXPORT_OK')
