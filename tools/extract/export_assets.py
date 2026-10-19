"""Exporta viewmodels (malhas, esqueleto, animações), sons e HUD do Rust instalado para public/rust-assets/.

USO LOCAL APENAS: os arquivos gerados são conteúdo da Facepunch, tirados da sua cópia do jogo.
public/rust-assets/ está no .gitignore e no .vercelignore — não publique.

    python -I tools/extract/export_assets.py "<pasta do Rust>" public/rust-assets [ids...] [legacy=<Rust de maio/2022>]
"""
import base64
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import zlib

import numpy as np
from PIL import Image
from UnityPy.helpers.MeshHelper import MeshHandler

sys.path.insert(0, os.path.dirname(__file__))
from glb import GLB  # noqa: E402
from mecanim import decode_clip  # noqa: E402
from rustfs import RustEnv, behaviours  # noqa: E402

VIEWMODELS = {
    'rifle.ak': 'assets/prefabs/weapons/ak47u/ak47u.viewmodel.prefab',
    'rifle.lr300': 'assets/prefabs/weapons/lr300/lr300.viewmodel.prefab',
    'smg.mp5': 'assets/prefabs/weapons/mp5/mp5.viewmodel.prefab',
    'smg.thompson': 'assets/prefabs/weapons/thompson/thompson.viewmodel.prefab',
    'smg.2': 'assets/prefabs/weapons/smg/smg.viewmodel.prefab',
    'lmg.m249': 'assets/prefabs/weapons/m249/m249.viewmodel.prefab',
    'rifle.semiauto': 'assets/prefabs/weapons/semi auto rifle/semi_auto_rifle.viewmodel.prefab',
    'rifle.m39': 'assets/prefabs/weapons/m39 emr/m39.viewmodel.prefab',
    'pistol.python': 'assets/prefabs/weapons/python/python.viewmodel.prefab',
    'pistol.semiauto': 'assets/prefabs/weapons/semi auto pistol/pistol_semiauto.viewmodel.prefab',
    'pistol.m92': 'assets/prefabs/weapons/m92/m92.viewmodel.prefab',
}
# attachments com modelo no viewmodel: shortname -> prefab base em assets/prefabs/weapon mods/
MOD_VM = {
    'weapon.mod.holosight': 'holosight/holosight', 'weapon.mod.8x.scope': '8x scope/8xscope',
    'weapon.mod.small.scope': 'smallscope/smallscope', 'weapon.mod.simplesight': 'reddotsight/simplesight',
    'weapon.mod.lasersight': 'lasersight/lasersight', 'weapon.mod.flashlight': 'flashlight/flashlight',
    'weapon.mod.silencer': 'silencers/silencer', 'weapon.mod.oilfiltersilencer': 'silencers/oilfiltersilencer',
    'weapon.mod.sodacansilencer': 'silencers/sodacansilencer', 'weapon.mod.muzzlebrake': 'muzzlebrake/muzzlebrake',
    'weapon.mod.muzzleboost': 'muzzleboost/muzzleboost',
}
ITEMS_EXTRA = ['weapon.mod.extendedmags', 'weapon.mod.burstmodule', 'weapon.mod.gascompressionovedrive',
               'ammo.rifle', 'ammo.rifle.hv', 'ammo.rifle.incendiary', 'ammo.rifle.explosive',
               'ammo.pistol', 'ammo.pistol.hv', 'ammo.pistol.fire']
QUAD_ID = 10210  # Quad embutido da Unity ('unity default resources')
ARMS_PREFAB = 'assets/prefabs/instruments/flute/flute.viewmodel.prefab'  # braços nus genéricos (hand_mesh)
TEX_MAX = 1024
SKIN_TONE = (0.92, 0.72, 0.6, 1.0)  # tom de pele médio (o jogo escolhe por jogador)
SKIP_CLIPS = ('admire',)

S = np.diag([1.0, 1.0, -1.0, 1.0])  # Unity (mão esquerda) -> three/glTF (mão direita): espelha Z


def safe(name):
    return re.sub(r'[^A-Za-z0-9_-]', '_', name)


def comps(go):
    for c in go.read().m_Component:
        yield (c.component if hasattr(c, 'component') else c).deref()


def transform_of(go):
    return next(o for o in comps(go) if o.type.name in ('Transform', 'RectTransform'))


def script_name(o):
    try:
        return o.read(check_read=False).m_Script.read().m_ClassName
    except Exception:
        return None


def trs(t):
    p, r, s = t.m_LocalPosition, t.m_LocalRotation, t.m_LocalScale
    return (p.x, p.y, p.z), (r.x, r.y, r.z, r.w), (s.x, s.y, s.z)


def mat_trs(p, q, s):
    x, y, z, w = q
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4)
    m[:3, :3] = r * np.array(s)
    m[:3, 3] = p
    return m


def to3_pos(p):
    return [p[0], p[1], -p[2]]


def to3_quat(q):
    return [-q[0], -q[1], q[2], q[3]]


def unity_matrix(m):
    return np.array([[getattr(m, f'e{r}{c}') for c in range(4)] for r in range(4)])


def find_prefab(sf, name):
    return next(o for o in sf.objects.values() if o.type.name == 'GameObject' and o.peek_name() == name)


class Tree:
    """Hierarquia de transforms de um prefab."""

    def __init__(self, root_go):
        self.nodes = []  # dicts: name, parent, trs, tr_id, go, world
        self.by_tr = {}
        used = {}

        def walk(go, parent, pworld):
            t = transform_of(go)
            tr = t.read()
            # a raiz fica na origem (na asset scene ela tem posição/escala da cena)
            p, q, s = trs(tr) if parent is not None else ((0, 0, 0), (0, 0, 0, 1), (1, 1, 1))
            world = pworld @ mat_trs(p, q, s)
            name = safe(go.read().m_Name)
            if name in used:
                used[name] += 1
                name = f'{name}__{used[name]}'
            else:
                used[name] = 0
            i = len(self.nodes)
            self.nodes.append({'name': name, 'raw': go.read().m_Name, 'parent': parent, 'p': p, 'q': q, 's': s,
                               'tr': t.path_id, 'go': go, 'world': world, 'children': []})
            if parent is not None:
                self.nodes[parent]['children'].append(i)
            self.by_tr[t.path_id] = i
            for ch in tr.m_Children:
                walk(ch.read().m_GameObject.deref(), i, world)

        walk(root_go, None, np.eye(4))

    def path_of(self, i, base):
        parts = []
        while i is not None and i != base:
            parts.append(self.nodes[i]['raw'])
            i = self.nodes[i]['parent']
        return '/'.join(reversed(parts))


# ---------- texturas / materiais ----------

def tex_rgba(pptr):
    if not pptr or not pptr.path_id:
        return None, None
    t = pptr.read()
    img = t.image.convert('RGBA')
    if max(img.size) > TEX_MAX:
        k = TEX_MAX / max(img.size)
        img = img.resize((max(1, int(img.width * k)), max(1, int(img.height * k))), Image.LANCZOS)
    return np.asarray(img).astype(np.float32) / 255.0, getattr(t, 'm_TextureFormat', None)


def fit(a, shape):
    if a is None or a.shape[:2] == shape:
        return a
    img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    return np.asarray(img.resize((shape[1], shape[0]), Image.LANCZOS)).astype(np.float32) / 255.0


def encode(a, png=False):
    img = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
    b = io.BytesIO()
    if png:
        img.save(b, 'PNG', optimize=True)
        return b.getvalue(), 'image/png'
    img.convert('RGB').save(b, 'JPEG', quality=90)
    return b.getvalue(), 'image/jpeg'


def normal_rgb(a):
    """Normal map da Unity -> RGB. DXT5nm guarda X em A e Y em G (R≈1)."""
    if a[..., 0].mean() > 0.97 and a[..., 3].std() > 0.01:
        x, y = a[..., 3] * 2 - 1, a[..., 1] * 2 - 1
    else:
        x, y = a[..., 0] * 2 - 1, a[..., 1] * 2 - 1
    z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
    return np.stack([x, y, z], -1) * 0.5 + 0.5


def first(texs, keys):
    for k in keys:
        if k in texs and texs[k].path_id:
            return texs[k]
    return None


def export_material(glb, mat_pptr, cache):
    if not mat_pptr or not mat_pptr.path_id:
        return None
    obj = mat_pptr.deref()
    key = (obj.assets_file.name, obj.path_id)
    if key in cache:
        return cache[key]
    m = obj.read()
    props = m.m_SavedProperties
    texs = {k: v.m_Texture for k, v in props.m_TexEnvs}
    floats = dict(props.m_Floats)
    colors = {k: (v.r, v.g, v.b, v.a) for k, v in props.m_Colors}
    keywords = ' '.join(getattr(m, 'm_ValidKeywords', []) or []) + ' ' + str(getattr(m, 'm_ShaderKeywords', '') or '')

    albedo, _ = tex_rgba(first(texs, ['_MainTex', '_BaseColorMap', '_BaseMap', '_AlbedoMap']))
    normal, _ = tex_rgba(first(texs, ['_BumpMap', '_NormalMap']))
    sg, _ = tex_rgba(first(texs, ['_SpecGlossMap', '_SpecularMap']))
    mg, _ = tex_rgba(first(texs, ['_MetallicGlossMap']))
    ao, _ = tex_rgba(first(texs, ['_OcclusionMap']))

    out = {'name': m.m_Name, 'pbrMetallicRoughness': {'metallicFactor': 1.0, 'roughnessFactor': 1.0}}
    tint = colors.get('_Color', (1, 1, 1, 1))
    skin = 'Skin' in (m.m_Shader.read().m_ParsedForm.m_Name if m.m_Shader.path_id else '')
    if skin:
        # Core/Skin: _SpecularMap não é specular-gloss; o tom de pele é aplicado pelo jogo em runtime
        tint, sg = SKIN_TONE, None
        floats['_Glossiness'] = 0.43
    if albedo is None:
        albedo = np.ones((4, 4, 4), np.float32)
    shape = albedo.shape[:2]
    rgb = albedo[..., :3] * np.array(tint[:3], np.float32)
    if sg is not None:
        sg = fit(sg, shape)
        spec = sg[..., :3]
        gloss = sg[..., 3] * floats.get('_GlossMapScale', 1.0)
        lum = spec.max(-1)
        metal = np.clip((lum - 0.12) / (0.45 - 0.12), 0, 1)
        rgb = rgb * (1 - metal[..., None]) + spec * metal[..., None]
        rough = 1 - gloss
    elif mg is not None:
        # fluxo metálico: R = metal, A = suavidade
        mg = fit(mg, shape)
        metal = mg[..., 0]
        rough = 1 - mg[..., 3] * floats.get('_GlossMapScale', floats.get('_Glossiness', 1.0))
    else:
        metal = np.zeros(shape, np.float32)
        rough = np.full(shape, 1 - floats.get('_Glossiness', 0.3), np.float32)
    occ = fit(ao, shape)[..., 1] if ao is not None else np.ones(shape, np.float32)
    cutout = '_ALPHATEST_ON' in keywords
    blend = '_ALPHABLEND_ON' in keywords or '_ALPHAPREMULTIPLY_ON' in keywords
    alpha = albedo[..., 3:4] * (tint[3] if blend else 1)
    base = np.concatenate([rgb, alpha], -1) if cutout or blend else rgb
    data, mime = encode(base, png=cutout or blend)
    out['pbrMetallicRoughness']['baseColorTexture'] = {'index': glb.image(data, mime)}
    orm_i = glb.image(*encode(np.stack([occ, rough, metal], -1)))
    out['pbrMetallicRoughness']['metallicRoughnessTexture'] = {'index': orm_i}
    if ao is not None:
        out['occlusionTexture'] = {'index': orm_i}
    if normal is not None:
        out['normalTexture'] = {'index': glb.image(*encode(normal_rgb(normal)))}
    if cutout:
        out['alphaMode'] = 'MASK'
        out['alphaCutoff'] = floats.get('_Cutoff', 0.5)
    elif blend:
        out['alphaMode'] = 'BLEND'
    ec = np.clip(colors.get('_EmissionColor', (0, 0, 0, 1))[:3], 0, 1)
    if '_EMISSION' in keywords and ec.max() > 0:
        out['emissiveFactor'] = [float(x) for x in ec]
        em, _ = tex_rgba(first(texs, ['_EmissionMap']))
        if em is not None:
            out['emissiveTexture'] = {'index': glb.image(*encode(em[..., :3]))}
    cache[key] = glb.material(out)
    return cache[key]


# ---------- malhas ----------

def export_smr(glb, tree, smr, bone_nodes, mesh_world, cache, name):
    d = smr.read()
    mesh = d.m_Mesh.read()
    h = MeshHandler(mesh)
    h.process()
    pos = np.array(h.m_Vertices, np.float64)[:, :3]
    nrm = np.array(h.m_Normals, np.float64)[:, :3] if h.m_Normals else np.zeros_like(pos)
    uv = np.array(h.m_UV0, np.float64)[:, :2] if h.m_UV0 else None
    # assa o transform do SMR (relativo à raiz) nos vértices e nos bindposes
    rot = mesh_world[:3, :3]
    with np.errstate(all='ignore'):  # avisos espúrios do Accelerate no macOS
        pos = (np.c_[pos, np.ones(len(pos))] @ mesh_world.T)[:, :3]
        nrm = nrm @ rot.T
    pos[:, 2] *= -1
    nrm[:, 2] *= -1
    if uv is not None:
        uv[:, 1] = 1 - uv[:, 1]
    joints = weights = None
    if h.m_BoneIndices:
        # malhas rígidas guardam só o índice do osso (1 por vértice, peso implícito 1)
        bi = np.array(h.m_BoneIndices, np.int64).reshape(len(pos), -1)[:, :4]
        joints = np.zeros((len(pos), 4), np.int64)
        joints[:, :bi.shape[1]] = bi
        weights = np.zeros((len(pos), 4))
        if h.m_BoneWeights:
            bw = np.array(h.m_BoneWeights, np.float64).reshape(len(pos), -1)[:, :4]
            weights[:, :bw.shape[1]] = bw
        else:
            weights[:, 0] = 1
        weights /= weights.sum(1, keepdims=True) + 1e-9
    inv = np.linalg.inv(mesh_world)
    ibm = [S @ (unity_matrix(b) @ inv) @ S for b in mesh.m_BindPose]
    subs = []
    for sm, tris in zip(mesh.m_SubMeshes, h.get_triangles()):
        t = np.array(tris, np.int64).reshape(-1, 3) + (getattr(sm, 'baseVertex', 0) or 0)
        subs.append(t[:, [0, 2, 1]])
    mats = [export_material(glb, mp, cache) for mp in d.m_Materials]
    mats += [mats[-1] if mats else None] * (len(subs) - len(mats))
    mi = glb.mesh(name, pos, nrm, uv, joints, weights, subs, mats)
    skin = None
    if joints is not None and bone_nodes:
        skin = glb.skin(bone_nodes, np.array([m.T.reshape(-1) for m in ibm]))
    return mi, skin


def export_static(glb, mf, mr, cache, name):
    """MeshFilter + MeshRenderer no espaço local do nó (attachments não têm skin)."""
    pp = mf.read().m_Mesh
    try:
        mesh = pp.read()
    except FileNotFoundError:
        if pp.path_id != QUAD_ID:
            return None
        pos = np.array([[-.5, -.5, 0], [.5, -.5, 0], [-.5, .5, 0], [.5, .5, 0]])
        nrm, uv = np.tile([0, 0, -1.0], (4, 1)), np.array([[0, 0], [1, 0], [0, 1], [1, 1.0]])
        subs = [np.array([[0, 3, 1], [3, 0, 2]])]
    else:
        h = MeshHandler(mesh)
        h.process()
        pos = np.array(h.m_Vertices, np.float64)[:, :3]
        nrm = np.array(h.m_Normals, np.float64)[:, :3] if h.m_Normals else np.zeros_like(pos)
        uv = np.array(h.m_UV0, np.float64)[:, :2] if h.m_UV0 else None
        subs = [np.array(t, np.int64).reshape(-1, 3) + (getattr(sm, 'baseVertex', 0) or 0)
                for sm, t in zip(mesh.m_SubMeshes, h.get_triangles())]
    pos, nrm = pos.copy(), nrm.copy()
    pos[:, 2] *= -1
    nrm[:, 2] *= -1
    if uv is not None:
        uv = uv.copy()
        uv[:, 1] = 1 - uv[:, 1]
    subs = [t[:, [0, 2, 1]] for t in subs]
    mats = [export_material(glb, m, cache) for m in mr.read().m_Materials]
    mats += [mats[-1] if mats else None] * (len(subs) - len(mats))
    return glb.mesh(name, pos, nrm, uv, None, None, subs, mats)


def export_attachment(env, prefab_sf, short, base, out_dir):
    """*.vm.attachment.prefab: malhas estáticas, ponto de mira (IronsightAimPoint), ponto do efeito e overlay do scope."""
    root = find_prefab(prefab_sf, f'assets/prefabs/weapon mods/{base}.vm.attachment.prefab')
    tree = Tree(root)
    glb = GLB()
    cache = {}
    info = {'glb': f'mods/{short}.glb'}
    active = []
    for i, n in enumerate(tree.nodes):
        active.append(i == 0 or (n['go'].read().m_IsActive and active[n['parent']]))
        n['gi'] = glb.node(name=n['name'], translation=to3_pos(n['p']), rotation=to3_quat(n['q']),
                           scale=list(n['s']) if n['s'] != (1, 1, 1) else None)
        if n['name'] == 'effectBone':
            info['effect'] = n['name']
    for n in tree.nodes:
        if n['children']:
            glb.j['nodes'][n['gi']]['children'] = [tree.nodes[c]['gi'] for c in n['children']]
    for i, n in enumerate(tree.nodes):
        cs = {o.type.name if o.type.name != 'MonoBehaviour' else script_name(o): o for o in comps(n['go'])}
        if active[i] and 'MeshFilter' in cs and 'MeshRenderer' in cs and cs['MeshRenderer'].read().m_Enabled:
            mi = export_static(glb, cs['MeshFilter'], cs['MeshRenderer'], cache, n['name'])
            if mi is not None:
                glb.j['nodes'][n['gi']]['mesh'] = mi
        if 'IronsightAimPoint' in cs:
            tp = tree.by_tr.get(cs['IronsightAimPoint'].read_typetree()['targetPoint']['m_PathID'])
            if tp is not None:
                info['aimPoint'], info['targetPoint'] = n['name'], tree.nodes[tp]['name']
        if 'ViewmodelScope' in cs:
            pp = cs['ViewmodelScope'].read_typetree()['scopeMaterialOverride']
            o = cs['ViewmodelScope']
            f = o.assets_file if pp['m_FileID'] == 0 else env.get_cab(o.assets_file.externals[pp['m_FileID'] - 1].name)
            mat = f.objects[pp['m_PathID']].read()
            tex = dict(mat.m_SavedProperties.m_TexEnvs)['_MainTex'].m_Texture.read()
            os.makedirs(os.path.join(out_dir, 'hud'), exist_ok=True)
            tex.image.save(os.path.join(out_dir, 'hud', mat.m_Name + '.png'))
            info['scope'] = f'hud/{mat.m_Name}.png'
    os.makedirs(os.path.join(out_dir, 'mods'), exist_ok=True)
    glb.write(os.path.join(out_dir, 'mods', f'{short}.glb'), [tree.nodes[0]['gi']])
    return info


def export_items(env, rust, out_dir, ids, done):
    """Ícones e metadados (nome, descrição, pilha) do Bundles/items e os sons de pegar/soltar no inventário
    (ItemDefinition.inventoryGrabSound / inventoryDropSound, ex.: ui-pickup-gun)."""
    import shutil
    os.makedirs(os.path.join(out_dir, 'items'), exist_ok=True)
    out = {}
    for short in ids:
        src = os.path.join(rust, 'Bundles/items', short)
        shutil.copy(src + '.png', os.path.join(out_dir, 'items', short + '.png'))
        d = json.load(open(src + '.json'))
        out[short] = {'name': d['Name'], 'desc': d['Description'], 'stack': d['stackable'], 'category': d['Category'],
                      'condition': d['condition']['max'] if d['condition']['enabled'] else 0}
    for cab in [n for n, v in env.index.items() if v[0].endswith('items.preload.bundle') and not n.endswith('.ress')]:
        for _, o in behaviours(env.open(cab), fields={'shortname', 'inventoryGrabSound'}):
            d = o.read_typetree()
            if d['shortname'] not in out:
                continue
            for key, field in (('grab', 'inventoryGrabSound'), ('drop', 'inventoryDropSound')):
                pp = d[field]
                if pp['m_PathID']:
                    f = o.assets_file if pp['m_FileID'] == 0 else env.get_cab(o.assets_file.externals[pp['m_FileID'] - 1].name)
                    out[d['shortname']][key] = [export_sound_def(f.objects[pp['m_PathID']], out_dir, done)]
    return out


# ---------- animações ----------

def b64(a):
    return base64.b64encode(np.ascontiguousarray(a, dtype=np.float32).tobytes()).decode()


def controller_clips(env, animator):
    ctrl = animator.read().m_Controller
    obj = ctrl.deref()
    tt = obj.read_typetree()

    def deref(pp, f):
        ff = f if pp['m_FileID'] == 0 else env.get_cab(f.externals[pp['m_FileID'] - 1].name)
        return ff.objects[pp['m_PathID']]

    if 'm_AnimationClips' in tt:
        return [deref(pp, obj.assets_file) for pp in tt['m_AnimationClips']]
    # AnimatorOverrideController: clips do controller base trocados pelos overrides
    base = deref(tt['m_Controller'], obj.assets_file)
    clips = {c.path_id: c for c in [deref(pp, base.assets_file) for pp in base.read_typetree()['m_AnimationClips']]}
    for pair in tt['m_Clips']:
        if pair['m_OverrideClip']['m_PathID']:
            orig = deref(pair['m_OriginalClip'], obj.assets_file)
            clips[orig.path_id] = deref(pair['m_OverrideClip'], obj.assets_file)
    return list(clips.values())


def export_anims(env, tree, anim_node, animator):
    paths = {}
    for i in range(len(tree.nodes)):
        p = tree.path_of(i, anim_node)
        paths[zlib.crc32(p.encode()) if p else 0] = i
    out = []
    for clip in controller_clips(env, animator):
        ct = clip.read_typetree()
        if ct['m_Name'] in SKIP_CLIPS:
            continue
        c = decode_clip(ct, {h: tree.path_of(i, anim_node) for h, i in paths.items()}, fps=60)
        by_path = {tree.path_of(i, anim_node): i for i in paths.values()}
        tracks = []
        for path, kind, vals in c['tracks']:
            i = by_path.get(path)
            if i is None:
                continue
            n = tree.nodes[i]
            v = vals.copy()
            if kind == 'position':
                v[:, 2] *= -1
                rest = np.array(to3_pos(n['p']))
            elif kind == 'quaternion':
                v[:, 0] *= -1
                v[:, 1] *= -1
                rest = np.array(to3_quat(n['q']))
                if np.dot(v[0], rest) < 0:
                    v = -v
            else:
                rest = np.array(n['s'])
            if np.abs(v - v[0]).max() < 1e-5:
                if np.abs(v[0] - rest).max() < 1e-5:
                    continue
                v = v[:1]
            tracks.append({'node': n['name'], 'type': kind, 'values': b64(v), 'n': len(v)})
        out.append({'name': c['name'], 'duration': round(c['duration'], 4), 'fps': 60, 'loop': c['loop'],
                    'tracks': tracks, 'events': [[round(t, 4), f, d] for t, f, d in c['events']]})
    return out


# ---------- viewmodel ----------

def mb_fields(o):
    d = o.read_typetree()
    return {k: v for k, v in d.items() if isinstance(v, (int, float, bool)) and not k.startswith('m_')}


def curve_keys(c):
    return [[round(k['time'], 4), round(k['value'], 4), round(k['inSlope'], 4), round(k['outSlope'], 4)] for k in c['m_Curve']]


def export_viewmodel(env, prefab_sf, wid, prefab, arms, out_dir):
    root = find_prefab(prefab_sf, prefab)
    tree = Tree(root)
    glb = GLB()
    cache = {}
    # nós
    for n in tree.nodes:
        n['gi'] = glb.node(name=n['name'], translation=to3_pos(n['p']), rotation=to3_quat(n['q']),
                           scale=list(n['s']) if n['s'] != (1, 1, 1) else None)
    for n in tree.nodes:
        if n['children']:
            glb.j['nodes'][n['gi']]['children'] = [tree.nodes[c]['gi'] for c in n['children']]

    info = {'id': wid, 'prefab': prefab}
    animator = anim_node = None
    mesh_nodes = []
    for i, n in enumerate(tree.nodes):
        for o in comps(n['go']):
            t = o.type.name
            if t == 'Animator' and animator is None and i != 0:
                animator, anim_node = o, i
            elif t == 'SkinnedMeshRenderer':
                d = o.read()
                if not d.m_Enabled or not d.m_Mesh.path_id:
                    continue
                bones = [tree.by_tr.get(b.path_id) for b in d.m_Bones]
                if any(b is None for b in bones):
                    continue
                mi, sk = export_smr(glb, tree, o, [tree.nodes[b]['gi'] for b in bones], n['world'], cache, n['name'])
                mesh_nodes.append(glb.node(name=n['name'] + '_mesh', mesh=mi, skin=sk))
            elif t == 'MonoBehaviour':
                s = script_name(o)
                if s == 'ViewmodelAttachmentOverride':
                    # silenciadores volumosos (filtro de óleo, lata) vão num osso próprio
                    for ov in o.read_typetree()['Overrides']:
                        j = tree.by_tr.get(ov['TargetRoot']['m_PathID'])
                        if j is not None:
                            info['bulkyBone'] = tree.nodes[j]['name']
                if s in ('IronSights', 'ViewmodelBob', 'ViewmodelSway', 'ViewmodelLower', 'ViewmodelPunch', 'BaseViewModel'):
                    tt = o.read_typetree()
                    f = mb_fields(o)
                    if s == 'IronSights':
                        f['introCurve'], f['outroCurve'] = curve_keys(tt['introCurve']), curve_keys(tt['outroCurve'])
                        # aimPoint aponta para o componente IronsightAimPoint (no GameObject ironsight_default)
                        aim = o.assets_file.objects.get(tt['aimPoint']['m_PathID'])
                        if aim is not None and aim.type.name == 'MonoBehaviour':
                            ad = aim.read_typetree()
                            ap = tree.by_tr.get(transform_of(aim.read(check_read=False).m_GameObject.deref()).path_id)
                            tp = tree.by_tr.get(ad['targetPoint']['m_PathID'])
                            if ap is not None and tp is not None:
                                f['aimPoint'], f['targetPoint'] = tree.nodes[ap]['name'], tree.nodes[tp]['name']
                    if s == 'ViewmodelPunch':
                        f['punchScale'] = curve_keys(tt['punchScale'])
                        f['punchDirection'] = [tt['punchDirection'][k] for k in 'xyz']
                    if s == 'BaseViewModel':
                        for k in ('MuzzlePoint', 'pivot'):
                            j = tree.by_tr.get(tt[k]['m_PathID'])
                            if j is not None:
                                f[k] = tree.nodes[j]['name']
                        # malhas da mira de ferro escondidas quando há mira acoplada
                        by_go = {m['go'].path_id: m['name'] for m in tree.nodes}
                        hide = []
                        for pp in tt['hideSightMeshes']:
                            ob = o.assets_file.objects.get(pp['m_PathID'])
                            if ob is not None:
                                g = ob.path_id if ob.type.name == 'GameObject' else ob.read(check_read=False).m_GameObject.path_id
                                hide.append(by_go.get(g))
                        f['hideSightMeshes'] = [h for h in hide if h]
                    info[s] = f

    # braços: hand_mesh do prefab genérico, ossos ligados por nome
    if arms is not None:
        smr, src_tree = arms
        d = smr.read()
        names = [src_tree.nodes[src_tree.by_tr[b.path_id]]['raw'] for b in d.m_Bones]
        lookup = {}
        for n in tree.nodes:
            lookup.setdefault(n['raw'], n['gi'])
        if all(nm in lookup for nm in names):
            mw = src_tree.nodes[src_tree.by_tr[transform_of(d.m_GameObject.deref()).path_id]]['world']
            mi, sk = export_smr(glb, tree, smr, [lookup[nm] for nm in names], mw, cache, 'arms')
            mesh_nodes.append(glb.node(name='arms_mesh', mesh=mi, skin=sk))
        else:
            print('  braços: ossos faltando', [nm for nm in names if nm not in lookup][:5])

    os.makedirs(os.path.join(out_dir, 'vm'), exist_ok=True)
    glb.write(os.path.join(out_dir, 'vm', f'{wid}.glb'), [tree.nodes[0]['gi']] + mesh_nodes)
    clips = export_anims(env, tree, anim_node, animator) if animator else []
    with open(os.path.join(out_dir, 'vm', f'{wid}.anim.json'), 'w') as f:
        json.dump({'clips': clips}, f, separators=(',', ':'))
    info['clips'] = {c['name']: {'duration': c['duration'], 'events': c['events']} for c in clips}
    return info, root


def arms_source(prefab_sf):
    root = find_prefab(prefab_sf, ARMS_PREFAB)
    tree = Tree(root)
    for n in tree.nodes:
        for o in comps(n['go']):
            if o.type.name == 'SkinnedMeshRenderer' and o.read().m_Mesh.read().m_Name == 'hand_mesh':
                return o, tree
    return None


# ---------- sons ----------

def sound_defs_of_prefab(sf, name):
    try:
        root = find_prefab(sf, name)
    except StopIteration:
        return []
    out = []

    def walk(go):
        for o in comps(go):
            if o.type.name == 'MonoBehaviour' and script_name(o) == 'SoundPlayer':
                pp = o.read_typetree()['soundDefinition']
                if pp['m_PathID']:
                    f = o.assets_file if pp['m_FileID'] == 0 else o.assets_file.environment.get_cab(o.assets_file.externals[pp['m_FileID'] - 1].name)
                    out.append(f.objects[pp['m_PathID']])
            elif o.type.name == 'Transform':
                for ch in o.read().m_Children:
                    walk(ch.read().m_GameObject.deref())
    walk(root)
    return out


def export_sound_def(obj, out_dir, done):
    d = obj.read_typetree()
    files = []
    for w in d['weightedAudioClips']:
        pp = w['audioClip']
        if not pp['m_PathID']:
            continue
        f = obj.assets_file if pp['m_FileID'] == 0 else obj.assets_file.environment.get_cab(obj.assets_file.externals[pp['m_FileID'] - 1].name)
        clip = f.objects[pp['m_PathID']].read()
        fn = safe(clip.m_Name) + '.m4a'
        dst = os.path.join(out_dir, 'snd', fn)
        if fn not in done and not os.path.exists(dst):
            samples = clip.samples
            if samples:
                wav = next(iter(samples.values()))
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
                    tmp.write(wav)
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp.name, '-c:a', 'aac', '-b:a', '160k', dst], check=True)
                os.unlink(tmp.name)
        done.add(fn)
        files.append(['snd/' + fn, round(w.get('weight', 1), 3)])
    keep = {k: d[k] for k in ('volume', 'volumeVariation', 'pitch', 'pitchVariation') if isinstance(d.get(k), (int, float))}
    return {'name': d['m_Name'], 'files': files, **keep}


def export_legacy_sounds(old_rust, out_dir, manifest):
    """Sons de tiro de um build antigo do Rust (antes do Combat Update de 02/06/2022, quando trocaram junto com o
    recoil) para o modo legado. Vão para <out>/legacy/snd e entram em manifest.weapons[id].legacySounds."""
    env2 = RustEnv(old_rust)
    scene = next((n for n in env2.index if 'assetscene' in n and n.endswith('prefabs')), None)
    sf2 = env2.open(scene) if scene else None
    if sf2 is None:
        raise SystemExit(f'asset scene de prefabs não encontrada em {old_rust}')
    root = os.path.join(out_dir, 'legacy')
    os.makedirs(os.path.join(root, 'snd'), exist_ok=True)
    done = set()
    for wid, prefab in VIEWMODELS.items():
        folder = prefab.rsplit('/', 1)[0]
        snd = {}
        for name in ('attack', 'attack_silenced', 'attack_silenced_oilfilter', 'attack_silenced_sodacan'):
            defs = [export_sound_def(o, root, done) for o in sound_defs_of_prefab(sf2, f'{folder}/effects/{name}.prefab')]
            for d in defs:
                d['files'] = [['legacy/' + f, w] for f, w in d['files']]
            if defs:
                snd[name] = defs
        if wid in manifest['weapons']:
            manifest['weapons'][wid]['legacySounds'] = snd
        print('   legado', wid, list(snd))


def export_sounds(prefab_sf, info, out_dir, done):
    os.makedirs(os.path.join(out_dir, 'snd'), exist_ok=True)
    folder = info['prefab'].rsplit('/', 1)[0]
    effects = {'attack', 'attack_silenced', 'attack_silenced_oilfilter', 'attack_silenced_sodacan'} | {e[2] for c in info['clips'].values() for e in c['events'] if e[1] == 'DoEffect' and e[2]}
    snd = {}
    for name in sorted(effects):
        defs = sound_defs_of_prefab(prefab_sf, f'{folder}/effects/{name}.prefab')
        if defs:
            snd[name] = [export_sound_def(o, out_dir, done) for o in defs]
    return snd


# ---------- sons de ambiente ----------

IMPACT = 'assets/bundled/prefabs/fx/impacts/bullet/'
ENV_FX = {'impact_metal': IMPACT + 'metal/metal1.prefab', 'impact_wood': IMPACT + 'wood/wood1.prefab',
          'impact_dirt': IMPACT + 'dirt/dirt1.prefab', 'impact_flesh': IMPACT + 'flesh/fleshbloodimpact.prefab',
          'impact_cloth': IMPACT + 'cloth/cloth1.prefab', 'impact_stone': IMPACT + 'concrete/concrete1.prefab',
          'impact_glass': IMPACT + 'glass/glass1.prefab',
          'impact_sand': IMPACT + 'sandbag/sand_bag_impact.prefab',
          'takedamage': 'assets/bundled/prefabs/fx/takedamage_hit_new.prefab',
          'takedamage_generic': 'assets/bundled/prefabs/fx/takedamage_generic.prefab'}
ENV_DEFS = {'step_grass_walk': 'footstep-barefoot-grass-walk', 'step_grass_run': 'footstep-barefoot-grass-run',
            'step_wood_walk': 'footstep-barefoot-wood-walk', 'step_wood_run': 'footstep-barefoot-wood-run',
            'land_grass': 'footstep-barefoot-grass-jump-land', 'land_wood': 'footstep-barefoot-wood-jump-land',
            'step_stones_walk': 'footstep-barefoot-stones-walk', 'step_stones_run': 'footstep-barefoot-stones-run',
            'step_sand_walk': 'footstep-barefoot-sand-walk', 'step_sand_run': 'footstep-barefoot-sand-run',
            'step_gravel_walk': 'footstep-barefoot-gravel-walk', 'step_gravel_run': 'footstep-barefoot-gravel-run',
            'land_stones': 'footstep-barefoot-stones-jump-land', 'land_sand': 'footstep-barefoot-sand-jump-land',
            'hitmarker': 'hit-marker', 'ricochet': 'ricochet'}


def export_env_sounds(env, prefab_sf, out_dir, done):
    out = {k: [export_sound_def(o, out_dir, done) for o in sound_defs_of_prefab(prefab_sf, v)] for k, v in ENV_FX.items()}
    want = {v: k for k, v in ENV_DEFS.items()}
    cab = env.open('CAB-e2446ae3835fd7310524e3e713bd9b72')
    for pid, o in cab.objects.items():
        if o.type.name == 'MonoBehaviour' and o.serialized_type and o.serialized_type.node \
                and 'weightedAudioClips' in {c.m_Name for c in o.serialized_type.node.m_Children}:
            name = o.peek_name() if hasattr(o, 'peek_name') else None
            name = name or o.read_typetree()['m_Name']
            if name in want and want[name] not in out:
                out[want[name]] = [export_sound_def(o, out_dir, done)]
    print('   env', {k: len(v) for k, v in out.items()})
    return out


# ---------- HUD ----------

HUD_SPRITES = {'UI.Background.Tile', 'health', 'cup_water', 'fork_and_spoon'}
HUD_FONTS = ('RobotoCondensed-Bold', 'RobotoCondensed-Regular')


def export_hud(env, rust, out_dir):
    """Sprites dos vitais/belt e o ponto do crosshair (asset scene bootstrap), fontes e ícones dos itens."""
    import shutil
    import UnityPy
    d = os.path.join(out_dir, 'hud')
    os.makedirs(d, exist_ok=True)
    sf = env.open('BuildPlayer-AssetScene-bootstrap')
    saved = {}

    def save_sprite(pp, owner, fname):
        f = owner if pp['m_FileID'] == 0 else env.get_cab(owner.externals[pp['m_FileID'] - 1].name)
        spr = f.objects[pp['m_PathID']].read()
        spr.image.save(os.path.join(d, fname))
        saved[fname] = spr.m_Name

    roots = {o.peek_name(): o for o in sf.objects.values() if o.type.name == 'GameObject'
             and o.peek_name() in ('GameUI.Hud.Vitals.Main', 'GameUI.Hud.BeltBar', 'GameUI.Hud.Crosshair.Interaction')}

    def walk(go):
        for o in comps(go):
            if o.type.name == 'MonoBehaviour':
                tt = o.read_typetree()
                pp = tt.get('m_Sprite')
                if pp and pp['m_PathID']:
                    f = o.assets_file if pp['m_FileID'] == 0 else env.get_cab(o.assets_file.externals[pp['m_FileID'] - 1].name)
                    name = f.objects[pp['m_PathID']].peek_name()
                    if name in HUD_SPRITES and name + '.png' not in saved:
                        save_sprite(pp, o.assets_file, name + '.png')
            elif o.type.name in ('Transform', 'RectTransform'):
                for ch in o.read().m_Children:
                    walk(ch.read().m_GameObject.deref())
    for n in ('GameUI.Hud.Vitals.Main', 'GameUI.Hud.BeltBar'):
        walk(roots[n])
    for o in comps(roots['GameUI.Hud.Crosshair.Interaction']):
        if o.type.name == 'MonoBehaviour' and 'm_Sprite' in o.read_typetree():
            save_sprite(o.read_typetree()['m_Sprite'], o.assets_file, 'crosshair.png')
    res = UnityPy.load(os.path.join(rust, 'RustClient.app/Contents/Resources/Data/resources.assets'))
    for o in res.objects:
        if o.type.name == 'Font' and o.peek_name() in HUD_FONTS:
            data = o.read().m_FontData
            with open(os.path.join(d, o.peek_name() + '.ttf'), 'wb') as f:
                f.write(bytes(data))
            saved[o.peek_name() + '.ttf'] = o.peek_name()
    os.makedirs(os.path.join(out_dir, 'items'), exist_ok=True)
    for wid in VIEWMODELS:
        shutil.copy(os.path.join(rust, 'Bundles/items', wid + '.png'), os.path.join(out_dir, 'items', wid + '.png'))
    print('   hud', sorted(saved))
    return {'files': sorted(saved)}


# ---------- efeitos: muzzle flash, traçante, decais de furo ----------

DECALS = {  # tipo -> prefab em assets/bundled/prefabs/fx/decals/bullet/
    'wood': 'wood/decal_bullet_wood_01', 'concrete': 'concrete/decal_bullet_concrete_01', 'metal': 'metal/decal_bullet_metal_01',
    'dirt': 'dirt/decal_bullet_dirt_01', 'sand': 'sand/decal_bullet_sand_01', 'grass': 'grass/decal_bullet_grass_01',
    'sandbag': 'sandbag/decal_bullet_sandbag_01', 'flesh': 'flesh/decal_bullet_flesh_entry_01', 'rock': 'rock/decal_bullet_rock',
}


def export_fx(env, prefab_sf, out_dir):
    """Texturas do attack.prefab do AK (flash frontal 3×3 e lateral 1×4), do TrailRenderer do riflebullet e dos
    DeferredDecal de furo (tamanho = escala do prefab × DecalScale.range)."""
    d = os.path.join(out_dir, 'fx')
    os.makedirs(d, exist_ok=True)
    info = {'muzzle': {}, 'decals': {}}

    def tex_of(mat_pptr, owner):
        m = mat_pptr.read()
        t = dict(m.m_SavedProperties.m_TexEnvs)['_MainTex'].m_Texture.read()
        return m, t

    tree = Tree(find_prefab(prefab_sf, 'assets/prefabs/weapons/ak47u/effects/attack.prefab'))
    for n in tree.nodes:
        if n['raw'] not in ('muzzleflash_billboard', 'muzzleflash_side'):
            continue
        cs = {o.type.name: o for o in comps(n['go'])}
        uv = cs['ParticleSystem'].read_typetree()['UVModule']
        _, t = tex_of(cs['ParticleSystemRenderer'].read().m_Materials[0], cs['ParticleSystemRenderer'])
        key = 'front' if 'billboard' in n['raw'] else 'side'
        t.image.save(os.path.join(d, f'muzzle_{key}.png'))
        info['muzzle'][key] = {'file': f'fx/muzzle_{key}.png', 'tiles': [uv['tilesX'], uv['tilesY']]}
    tree = Tree(find_prefab(prefab_sf, 'assets/prefabs/ammo/rifle/riflebullet.prefab'))
    for n in tree.nodes:
        for o in comps(n['go']):
            if o.type.name == 'TrailRenderer':
                r = o.read()
                m, t = tex_of(r.m_Materials[0], o)
                t.image.save(os.path.join(d, 'tracer.png'))
                c = dict(m.m_SavedProperties.m_Colors)['_TintColor']
                tt = o.read_typetree()
                info['tracer'] = {'file': 'fx/tracer.png', 'tint': [round(c.r, 3), round(c.g, 3), round(c.b, 3)],
                                  'time': round(tt['m_Time'], 3), 'width': round(tt['m_Parameters']['widthMultiplier'], 4)}
    for kind, base in DECALS.items():
        root = find_prefab(prefab_sf, f'assets/bundled/prefabs/fx/decals/bullet/{base}.prefab')
        scale = transform_of(root).read().m_LocalScale.x
        rng, tex = (1, 1), None
        for o in comps(root):
            if o.type.name != 'MonoBehaviour':
                continue
            tt = o.read_typetree()
            if script_name(o) == 'DecalScale':
                rng = (tt['range']['x'], tt['range']['y'])
            if script_name(o) == 'DeferredDecal':
                pp = tt['material']
                f = o.assets_file if pp['m_FileID'] == 0 else env.get_cab(o.assets_file.externals[pp['m_FileID'] - 1].name)
                m = f.objects[pp['m_PathID']].read()
                tex = dict(m.m_SavedProperties.m_TexEnvs)['_MainTex'].m_Texture.read()
        if tex is None:
            continue
        img = tex.image
        if max(img.size) > 256:
            img = img.resize((256, 256))
        img.save(os.path.join(d, f'decal_{kind}.png'))
        info['decals'][kind] = {'file': f'fx/decal_{kind}.png', 'size': [round(scale * rng[0], 3), round(scale * rng[1], 3)]}
    print('   fx', info)
    return info


def main(rust, out_dir, ids):
    env = RustEnv(rust)
    sf = env.open('BuildPlayer-AssetScene-prefabs')
    arms = arms_source(sf)
    manifest_path = os.path.join(out_dir, 'manifest.json')
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {'weapons': {}}
    legacy = [t.split('=', 1)[1] for t in ids if t.startswith('legacy=')]  # legacy=<pasta do Rust de 2022>
    ids = [t for t in ids if not t.startswith('legacy=')]
    targets = ids or ([] if legacy else ['hud', 'mods', 'fx', *VIEWMODELS])
    done = set()
    for old in legacy:
        export_legacy_sounds(old, out_dir, manifest)
    if 'fx' in targets:
        manifest['fx'] = export_fx(env, sf, out_dir)
    if 'mods' in targets:
        manifest['mods'] = {}
        for short, base in MOD_VM.items():
            manifest['mods'][short] = export_attachment(env, sf, short, base, out_dir)
            print('   mod', short, manifest['mods'][short])
        os.makedirs(os.path.join(out_dir, 'snd'), exist_ok=True)
        manifest['items'] = export_items(env, rust, out_dir, [*VIEWMODELS, *MOD_VM, *ITEMS_EXTRA], done)
    if 'hud' in targets:
        manifest['hud'] = export_hud(env, rust, out_dir)
        os.makedirs(os.path.join(out_dir, 'snd'), exist_ok=True)
        manifest['env'] = export_env_sounds(env, sf, out_dir, done)
    for wid in [t for t in targets if t not in ('hud', 'mods', 'fx')]:  # 'hud' = HUD + sons de ambiente
        print('>>', wid)
        info, _ = export_viewmodel(env, sf, wid, VIEWMODELS[wid], arms, out_dir)
        info['sounds'] = export_sounds(sf, info, out_dir, done)
        manifest['weapons'][wid] = info
        print('   clips', list(info['clips']), 'sons', list(info['sounds']))
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
