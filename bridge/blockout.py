# blockout.py - turn shot-breakdown rows into a Blender grey-box blockout, then render a preview
# MP4 and one still per shot. Runs on the creator's PC, started by creator_bridge.py:
#   blender -b --factory-startup -P blockout.py -- shots.json <out dir>
# Ported from the create-3d-scene skill (scene_kit.py) and tarun-mirzapur/draupadi-blockout
# (film.py: lens-aware framing from magnification, key/fill/rim rig with colour temperature).
# Every shot gets its camera position, angle, lens, move, light and timing from its row.
import json
import math
import os
import re
import sys

import bpy
from mathutils import Quaternion, Vector

args = sys.argv[sys.argv.index("--") + 1:]
SPEC = json.load(open(args[0], encoding="utf-8"))
OUT = os.path.abspath(args[1])
os.makedirs(OUT, exist_ok=True)

FPS = 24
PORTRAIT = SPEC.get("aspect") == "9:16"
RES = (1080, 1920) if PORTRAIT else (1920, 1080)
SENSOR = 36.0                                   # mm on the long side (sensor_fit AUTO)
SHORT_SENSOR = SENSOR * min(RES) / max(RES)
ZUP = Vector((0, 0, 1))
SHOTS = SPEC["shots"]

# Frame height (m) each magnification fills on the subject plane, and where the lens looks.
MAGS = [("EWS", 30, 1.0), ("ELS", 30, 1.0), ("WS", 6, 1.0), ("LS", 3.2, 1.0), ("FS", 2.2, 0.95), ("MLS", 1.45, 1.1),
        ("MWS", 1.45, 1.1), ("MCU", 0.58, 1.5), ("ECU", 0.13, 1.63), ("BCU", 0.2, 1.62), ("CU", 0.34, 1.6),
        ("INS", 0.35, 0.82), ("OTS", 0.9, 1.5), ("POV", 1.4, 1.2), ("2S", 1.3, 1.4), ("MS", 1.0, 1.35)]


def has(text, *words):
    return any(w in text for w in words)


def magnification(text):
    up = text.upper()
    for code, height, look in MAGS:
        if re.search(r"(?<![A-Z])" + code + r"(?![A-Z])", up):
            return code, height, look
    low = text.lower()
    if has(low, "extreme close"):
        return "ECU", 0.13, 1.63
    if has(low, "close"):
        return "CU", 0.34, 1.6
    if has(low, "wide", "establish"):
        return "WS", 6, 1.0
    return "MS", 1.0, 1.35


def lens_mm(text):
    m = re.search(r"\d+(\.\d+)?", text)
    return min(max(float(m.group()), 8), 600) if m else 35.0


def kelvin(k):
    """Colour temperature -> linear RGB (Tanner Helland fit, from film.py)."""
    t = k / 100.0
    if t <= 66:
        r, g = 255, 99.47 * math.log(t) - 161.12
        b = 0 if t <= 19 else 138.52 * math.log(t - 10) - 305.04
    else:
        r, g, b = 329.7 * (t - 60) ** -0.1332, 288.12 * (t - 60) ** -0.0755, 255
    return tuple((min(max(v, 0), 255) / 255) ** 2.2 for v in (r, g, b))


def ease(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u)


# ---------------------------------------------------------------- per-shot plan from the row
def plan(shot):
    mag_text = shot.get("magnification", "")
    angle = shot.get("angle", "").lower()
    pos = shot.get("position", "").lower()
    move = shot.get("movement", "").lower()
    light = shot.get("lighting", "").lower()
    code, height, look_z = magnification(mag_text + " " + shot.get("description", ""))
    lens = lens_mm(shot.get("lens", ""))

    el = 0.0
    if has(angle, "top", "overhead", "bird"):
        el = 85.0
    elif has(angle, "worm"):
        el = -40.0
    elif has(angle, "high"):
        el = 30.0
    elif has(angle, "low"):
        el = -18.0
    roll = 14.0 if has(angle, "dutch", "cant", "tilted") else 0.0

    az = 15.0                                    # degrees round the subject from its front
    if has(pos + angle, "behind", "rear", "back of"):
        az = 180.0
    elif has(pos + angle + mag_text.lower(), "over the shoulder", "ots"):
        az = 160.0
    elif has(pos + angle, "profile", "side"):
        az = 90.0
    elif has(pos + angle, "three-quarter", "3/4", "three quarter"):
        az = 40.0
    elif has(pos + angle, "front", "frontal", "head-on", "straight on"):
        az = 0.0
    if has(pos, "left") and not has(pos, "camera-left", "camera left"):
        az = -az

    d = max(height * lens / SHORT_SENSOR, 0.3)
    side = -1 if has(move, "left") else 1
    moves = {
        "push": has(move, "push", "dolly in", "track in", "zoom in", "creep in"),
        "pull": has(move, "pull", "dolly out", "track out", "zoom out", "pull back"),
        "pan": has(move, "pan", "whip"),
        "tilt_up": has(move, "tilt up"), "tilt_down": has(move, "tilt down"),
        "truck": has(move, "truck", "crab", "lateral", "tracking", "track left", "track right", "slide"),
        "crane_up": has(move, "crane up", "jib up", "boom up", "pedestal up", "rise", "crane"),
        "crane_down": has(move, "crane down", "jib down", "boom down", "pedestal down", "descend"),
        "orbit": has(move, "orbit", "arc", "circle"),
        "handheld": has(move, "handheld", "hand-held", "shaky"),
    }

    k = re.search(r"(\d{4,5})\s*k\b", light)
    temp = float(k.group(1)) if k else 3200.0 if has(light, "warm", "tungsten", "candle", "golden", "practical", "fire") \
        else 7500.0 if has(light, "cool", "blue", "moon", "night") else 5600.0
    dark = has(light, "hard", "low key", "low-key", "night", "dark", "noir", "moody")
    bright = has(light, "soft", "high key", "high-key", "bright", "even", "flat")
    rig = {
        "temp": temp,
        "key_side": 1 if has(light, "camera-right", "camera right", "frame right", "from right") else -1,
        "key_el": 65.0 if has(light, "overhead", "top light", "toplight") else 30.0,
        "key": 0.0 if has(light, "silhouette") else 500.0 if dark else 250.0 if bright else 350.0,
        "fill": 15.0 if dark else 140.0 if bright else 60.0,
        "rim": 400.0 if has(light, "rim", "back light", "backlight", "edge", "silhouette", "halo") else 0.0,
        "world": 0.015 if dark else 0.25 if bright else 0.08,
    }
    return dict(code=code, lens=lens, d=d, look_z=look_z, el=el, roll=roll, az=az, side=side, moves=moves, rig=rig,
                insert=code == "INS", pov=code == "POV")


def cam_at(p, u, seconds):
    """Camera position, look point and roll for progress u (0..1) through the shot."""
    m, e = p["moves"], ease(u)
    d = p["d"] * (1 - 0.3 * e if m["push"] else 1 + 0.35 * e if m["pull"] else 1)
    az = p["az"] + (40 * e * p["side"] if m["orbit"] else 0)
    look = Vector((-1.1, 0.2, 0.82)) if p["insert"] else Vector((0, 0, p["look_z"]))
    a, el = math.radians(az), math.radians(p["el"])
    direction = Vector((math.sin(a) * math.cos(el), -math.cos(a) * math.cos(el), math.sin(el)))
    pos = look + direction * d
    if p["pov"]:                                 # from the subject's eyes, looking out
        pos, look = Vector((0, -0.15, 1.62)), Vector((0, -3, 1.5))
    right = (look - pos).cross(ZUP)
    right = right.normalized() if right.length > 1e-4 else Vector((1, 0, 0))
    width = d * SENSOR / p["lens"]
    if m["pan"]:
        look += right * (e - 0.5) * width * 0.6 * p["side"]
    if m["truck"]:
        shift = right * (e - 0.5) * 1.6 * p["side"]
        pos, look = pos + shift, look + shift
    if m["tilt_up"] or m["tilt_down"]:
        look.z += (e - 0.5) * 0.8 * (1 if m["tilt_up"] else -1)
    if m["crane_up"] or m["crane_down"]:
        pos.z += (e - 0.5) * 1.6 * (-1 if m["crane_down"] else 1)
    if m["handheld"]:
        t = u * seconds
        pos += Vector((math.sin(t * 7.1), math.sin(t * 5.3 + 1), math.sin(t * 6.2 + 2))) * 0.012 * d
    pos.z = max(pos.z, 0.12)
    return pos, look, p["roll"]


# ---------------------------------------------------------------- scene
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
scene = bpy.context.scene
total = sum(max(1, int(s.get("duration") or 3)) for s in SHOTS)
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, max(1, total * FPS)
scene.render.resolution_x, scene.render.resolution_y = RES
scene.render.resolution_percentage = 50
for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        pass
if hasattr(scene, "eevee"):
    scene.eevee.taa_render_samples = 16


def material(name, rgb, rough=0.8):
    m = bpy.data.materials.new(name)
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    return m


def prim(kind, name, loc, scale, mat, rot=(0, 0, 0)):
    getattr(bpy.ops.mesh, kind)(location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name, ob.scale = name, scale
    ob.data.materials.append(mat)
    return ob


grey, wall, skin, cloth, prop_mat = (material("Floor", (0.35, 0.35, 0.36)), material("Set", (0.55, 0.52, 0.48)),
                                     material("Subject", (0.95, 0.42, 0.16)), material("Extra", (0.3, 0.45, 0.6)),
                                     material("Prop", (0.85, 0.8, 0.2)))
prim("primitive_plane_add", "Floor", (0, 0, 0), (40, 40, 1), grey)
prim("primitive_cube_add", "Back wall", (0, 5, 2), (12, 0.1, 2), wall)
prim("primitive_cube_add", "Side wall", (-6, 0, 2), (0.1, 6, 2), wall)
for i, (x, y, h) in enumerate([(-2.5, 2.2, 0.9), (2.8, 1.5, 1.6), (-3.5, -2, 0.6), (3.2, -3.5, 1.1), (1.2, 3.4, 2.2)]):
    prim("primitive_cube_add", f"Block {i + 1}", (x, y, h / 2), (0.4, 0.4, h / 2), wall)
# The subject, facing -Y (the camera's "front"), a second figure off to its left for two-shots, a table + prop for inserts.
prim("primitive_cylinder_add", "Subject body", (0, 0, 0.75), (0.19, 0.14, 0.75), skin)
prim("primitive_uv_sphere_add", "Subject head", (0, 0, 1.6), (0.11, 0.12, 0.13), skin)
prim("primitive_cube_add", "Subject nose", (0, -0.12, 1.61), (0.02, 0.03, 0.02), cloth)
prim("primitive_cylinder_add", "Other body", (1.4, 0.7, 0.75), (0.19, 0.14, 0.75), cloth)
prim("primitive_uv_sphere_add", "Other head", (1.4, 0.7, 1.6), (0.11, 0.12, 0.13), cloth)
prim("primitive_cube_add", "Table", (-1.1, 0.2, 0.38), (0.4, 0.3, 0.38), wall)
prim("primitive_cube_add", "Prop", (-1.1, 0.2, 0.82), (0.05, 0.05, 0.06), prop_mat)

world = bpy.data.worlds.new("World")
background = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
scene.world = world

target = bpy.data.objects.new("Light target", None)
scene.collection.objects.link(target)
target.location = (0, 0, 1.2)
lights = {}
for name in ("Key", "Fill", "Rim"):
    data = bpy.data.lights.new(name, "AREA")
    data.size = 1.2
    ob = bpy.data.objects.new(name, data)
    scene.collection.objects.link(ob)
    track = ob.constraints.new("TRACK_TO")
    track.target, track.track_axis, track.up_axis = target, "TRACK_NEGATIVE_Z", "UP_Y"
    lights[name] = ob

cam_data = bpy.data.cameras.new("Film_Cam")
cam_data.sensor_fit, cam_data.sensor_width = "AUTO", SENSOR
cam = bpy.data.objects.new("Film_Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.rotation_mode = "QUATERNION"


def key_light(ob, frame, energy, color, loc):
    ob.data.energy, ob.data.color, ob.location = energy, color, loc
    ob.data.keyframe_insert("energy", frame=frame)
    ob.data.keyframe_insert("color", frame=frame)
    ob.keyframe_insert("location", frame=frame)


def constant(idb):
    ad = idb.animation_data
    if not (ad and ad.action):
        return
    curves = list(ad.action.fcurves) if hasattr(ad.action, "fcurves") else \
        [fc for layer in ad.action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
    for fc in curves:
        for k in fc.keyframe_points:
            k.interpolation = "CONSTANT"


# ---------------------------------------------------------------- bake every shot onto one timeline
stills, start, prev = [], 1, None
for n, shot in enumerate(SHOTS):
    p = plan(shot)
    seconds = max(1, int(shot.get("duration") or 3))
    frames = seconds * FPS
    label = f"S{shot.get('no', n + 1)} {p['code']} {round(p['lens'])}mm"
    scene.timeline_markers.new(label, frame=start)

    pos0, look0, _ = cam_at(p, 0, seconds)
    to_cam = pos0 - Vector((0, 0, 1.2))
    to_cam.z = 0
    to_cam = to_cam.normalized() if to_cam.length > 1e-4 else Vector((0, -1, 0))
    left = ZUP.cross(-to_cam)
    rig, color = p["rig"], kelvin(p["rig"]["temp"])
    def around(angle, el, dist, side):
        a, e = math.radians(angle), math.radians(el)
        h = (to_cam * math.cos(a) + left * side * math.sin(a)).normalized()
        return Vector((0, 0, 1.2)) + (h * math.cos(e) + ZUP * math.sin(e)) * dist
    key_light(lights["Key"], start, rig["key"], color, around(45, rig["key_el"], 3, rig["key_side"]))
    key_light(lights["Fill"], start, rig["fill"], kelvin(min(rig["temp"] + 800, 9000)), around(40, 15, 3.5, -rig["key_side"]))
    key_light(lights["Rim"], start, rig["rim"], color, around(155, 35, 3, rig["key_side"]))
    background.inputs["Strength"].default_value = rig["world"]
    background.inputs["Color"].default_value = (*kelvin(rig["temp"] + 1500), 1)
    background.inputs["Strength"].keyframe_insert("default_value", frame=start)
    background.inputs["Color"].keyframe_insert("default_value", frame=start)

    cam_data.lens = p["lens"]
    cam_data.keyframe_insert("lens", frame=start)
    for f in range(frames):
        pos, look, roll = cam_at(p, f / max(frames - 1, 1), seconds)
        q = (look - pos).to_track_quat("-Z", "Y") @ Quaternion((0, 0, 1), math.radians(roll))
        if prev is not None and q.dot(prev) < 0:
            q.negate()
        prev = q
        cam.location, cam.rotation_quaternion = pos, q
        cam.keyframe_insert("location", frame=start + f)
        cam.keyframe_insert("rotation_quaternion", frame=start + f)
    stills.append((shot.get("no", n + 1), start + frames // 2))
    start += frames

for idb in (lights["Key"].data, lights["Fill"].data, lights["Rim"].data, lights["Key"], lights["Fill"], lights["Rim"],
            world.node_tree, cam_data):
    constant(idb)

# Burn the shot label and lens into every frame.
scene.render.use_stamp = True
for attr in dir(scene.render):
    if attr.startswith("use_stamp_"):
        try:
            setattr(scene.render, attr, attr in ("use_stamp_marker", "use_stamp_lens", "use_stamp_frame"))
        except (AttributeError, TypeError):
            pass

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "blockout.blend"))

# One still per shot, then the preview video.
image = scene.render.image_settings
if hasattr(image, "media_type"):
    image.media_type = "IMAGE"
image.file_format = "PNG"
files = ["blockout.blend"]
for no, frame in stills:
    scene.frame_set(frame)
    name = f"shot-{int(no):02d}.png" if str(no).isdigit() else f"shot-{len(files):02d}.png"
    scene.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)
    files.append(name)

if hasattr(image, "media_type"):
    image.media_type = "VIDEO"
image.file_format = "FFMPEG"
scene.render.ffmpeg.format = "MPEG4"
scene.render.ffmpeg.codec = "H264"
scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
scene.render.filepath = os.path.join(OUT, "preview.mp4")
scene.render.use_file_extension = False
bpy.ops.render.render(animation=True)
files.append("preview.mp4")

json.dump({"files": files, "shots": [{"no": no, "frame": f} for no, f in stills], "fps": FPS},
          open(os.path.join(OUT, "manifest.json"), "w"))
print("BLOCKOUT_DONE")
