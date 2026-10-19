"""Extrai recoil + stats das armas direto dos asset bundles do Rust e gera src/data/weapons.js.

Uso (Python 3.9+, `pip install UnityPy`):
    python -I tools/extract/extract.py "<pasta do Rust>" src/data/weapons.js

<pasta do Rust> = .../steamapps/common/Rust (a que contém Bundles/).
Os bundles do Rust não são comprimidos (bloco "streamed"), então cada CAB é lido via mmap
sem copiar os ~3 GB para a memória.
"""
import json
import mmap
import struct
import sys

import lz4.block
import UnityPy
from UnityPy.streams import EndianBinaryReader

# shortname -> (prefab da entidade, munição)
WEAPONS = [
    ('rifle.ak', 'ak47u/ak47u.entity.prefab', 'rifle'),
    ('rifle.lr300', 'lr300/lr300.entity.prefab', 'rifle'),
    ('smg.mp5', 'mp5/mp5.entity.prefab', 'pistol'),
    ('smg.thompson', 'thompson/thompson.entity.prefab', 'pistol'),
    ('smg.2', 'smg/smg.entity.prefab', 'pistol'),
    ('lmg.m249', 'm249/m249.entity.prefab', 'rifle'),
    ('rifle.semiauto', 'semi auto rifle/semi_auto_rifle.entity.prefab', 'rifle'),
    ('rifle.m39', 'm39 emr/m39.entity.prefab', 'rifle'),
    ('pistol.python', 'python/python.entity.prefab', 'pistol'),
    ('pistol.semiauto', 'semi auto pistol/pistol_semiauto.entity.prefab', 'pistol'),
    ('pistol.m92', 'm92/m92.entity.prefab', 'pistol'),
]
AMMO = {
    'rifle': ('assets/prefabs/ammo/rifle/ammo_rifle.item.prefab', 'assets/prefabs/ammo/rifle/riflebullet.prefab'),
    'pistol': ('assets/prefabs/ammo/pistol/ammo_pistol.item.prefab', 'assets/prefabs/ammo/pistol/pistolbullet.prefab'),
}
# munições: item (velocidade) + projétil (dano, arrasto, gravidade)
AMMO_TYPES = {
    'ammo.rifle': ('rifle', 'rifle/ammo_rifle.item.prefab', 'rifle/riflebullet.prefab'),
    'ammo.rifle.hv': ('rifle', 'rifle/ammo_rifle_hv.item.prefab', 'rifle/riflebullet.prefab'),
    'ammo.rifle.incendiary': ('rifle', 'rifle/ammo_rifle_fire.item.prefab', 'rifle/riflebullet_fire.prefab'),
    'ammo.rifle.explosive': ('rifle', 'rifle/ammo_rifle_explosive.item.prefab', 'rifle/riflebullet_explosive.prefab'),
    'ammo.pistol': ('pistol', 'pistol/ammo_pistol.item.prefab', 'pistol/pistolbullet.prefab'),
    'ammo.pistol.hv': ('pistol', 'pistol/ammo_pistol_hv.item.prefab', 'pistol/pistolbullet.prefab'),
    'ammo.pistol.fire': ('pistol', 'pistol/ammo_pistol_fire.item.prefab', 'pistol/pistolbullet_fire.prefab'),
}
# attachments: shortname -> prefab base em assets/prefabs/weapon mods/
MOD_PREFABS = {
    'weapon.mod.holosight': 'holosight/holosight', 'weapon.mod.8x.scope': '8x scope/8xscope',
    'weapon.mod.small.scope': 'smallscope/smallscope', 'weapon.mod.simplesight': 'reddotsight/simplesight',
    'weapon.mod.lasersight': 'lasersight/lasersight', 'weapon.mod.flashlight': 'flashlight/flashlight',
    'weapon.mod.silencer': 'silencers/silencer', 'weapon.mod.oilfiltersilencer': 'silencers/oilfiltersilencer',
    'weapon.mod.sodacansilencer': 'silencers/sodacansilencer', 'weapon.mod.muzzlebrake': 'muzzlebrake/muzzlebrake',
    'weapon.mod.muzzleboost': 'muzzleboost/muzzleboost', 'weapon.mod.extendedmags': 'extendedmags/extendedmags',
    'weapon.mod.burstmodule': 'burstmodule/burstmodule',
    'weapon.mod.gascompressionovedrive': 'gascompressionoverdrive/gascompressionoverdrive',
}
MOD_STATS = ['repeatDelay', 'projectileVelocity', 'projectileDamage', 'projectileDistance', 'aimsway', 'aimswaySpeed',
             'recoil', 'sightAimCone', 'hipAimCone', 'magazineCapacity']
MOD_FLAGS = ['isSilencer', 'isMuzzleBrake', 'isMuzzleBoost', 'isScope', 'isLight', 'burstCount', 'zoomAmountDisplayOnly']

RECOIL_FIELDS = ['recoilYawMin', 'recoilYawMax', 'recoilPitchMin', 'recoilPitchMax', 'timeToTakeMin',
                 'timeToTakeMax', 'ADSScale', 'movementPenalty', 'useCurves', 'curvesAsScalar',
                 'shotsUntilMax', 'maxRecoilRadius', 'overrideAimconeWithCurve', 'aimconeCurveScale']
CURVES = ['pitchCurve', 'yawCurve', 'aimconeCurve', 'aimconeProbabilityCurve']


def cstr(b, i):
    j = b.index(b'\0', i)
    return b[i:j].decode(), j + 1


def nodes(path):
    """Lê o cabeçalho UnityFS e devolve (início dos dados, nós)."""
    with open(path, 'rb') as f:
        head = f.read(256)
        i = 12
        _, i = cstr(head, i)
        _, i = cstr(head, i)
        size, csz, usz, flags = struct.unpack('>qIII', head[i:i + 20])
        i = (i + 20 + 15) // 16 * 16
        f.seek(size - csz if flags & 0x80 else i)
        info = f.read(csz)
        if flags & 0x3F in (2, 3):
            info = lz4.block.decompress(info, uncompressed_size=usz)
        start = i + csz
        if flags & 0x200:
            start = (start + 15) // 16 * 16
        p = 16
        nb = struct.unpack('>i', info[p:p + 4])[0]
        blocks = [struct.unpack('>IIH', info[p + 4 + k * 10:p + 14 + k * 10]) for k in range(nb)]
        assert all(b[2] & 0x3F == 0 for b in blocks), 'bundle comprimido: use UnityPy.load direto'
        p += 4 + nb * 10
        nn = struct.unpack('>i', info[p:p + 4])[0]
        p += 4
        out = []
        for _ in range(nn):
            off, sz, fl = struct.unpack('>qqI', info[p:p + 20])
            name, p = cstr(info, p + 20)
            out.append((off, sz, name))
        return start, out


def load(path, only=lambda n: True):
    start, ns = nodes(path)
    with open(path, 'rb') as f:
        mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    env = UnityPy.Environment()
    for off, sz, name in ns:
        if not name.endswith(('.resS', '.resource')) and only(name):
            env.load_file(EndianBinaryReader(memoryview(mm)[start + off:start + off + sz]), name=name)
    return env


def behaviours(env, has):
    for sf in env.files.values():
        objs = getattr(sf, 'objects', {})
        for pid, o in objs.items():
            if o.type.name == 'MonoBehaviour' and o.serialized_type and o.serialized_type.node:
                names = {c.m_Name for c in o.serialized_type.node.m_Children}
                if has <= names:
                    yield pid, o, objs


def go_name(objs, d):
    try:
        return objs[d['m_GameObject']['m_PathID']].read().m_Name
    except Exception:
        return '?'


def curve(c):
    return [[round(k['time'], 5), round(k['value'], 5), round(k['inSlope'], 5), round(k['outSlope'], 5)]
            for k in c['m_Curve']]


def main(rust, out):
    B = rust + '/Bundles/shared/'

    def info(short):  # nome e pilha (Bundles/items/<shortname>.json)
        with open(f'{rust}/Bundles/items/{short}.json') as f:
            return json.load(f)
    # RecoilProperties (ScriptableObject) ficam no content.bundle
    recoil = {}
    for pid, o, _ in behaviours(load(B + 'content.bundle'), {'recoilYawMin', 'newRecoilOverride'}):
        d = o.read_typetree()
        recoil[pid] = d
    names = {pid: d['m_Name'] for pid, d in recoil.items()}

    # Prefabs de entidades ficam nas "asset scenes"
    scenes = load(B + 'assetscenes.bundle', only=lambda n: n.startswith('BuildPlayer-AssetScene-prefabs'))
    ents, ammo_items, bullets = {}, {}, {}
    for pid, o, objs in behaviours(scenes, {'recoil', 'repeatDelay', 'primaryMagazine'}):
        d = o.read_typetree()
        ents[go_name(objs, d)] = d
    for pid, o, objs in behaviours(scenes, {'projectileVelocity', 'projectileObject'}):
        d = o.read_typetree()
        ammo_items[go_name(objs, d)] = d
    for pid, o, objs in behaviours(scenes, {'damageTypes', 'drag', 'gravityModifier'}):
        d = o.read_typetree()
        bullets[go_name(objs, d)] = d

    # definições de item: slots que cada mod ocupa (bitflag) e slots/capacidade de cada arma
    items, containers, bones = {}, {}, {}
    pre = load(B + 'items.preload.bundle')
    for pid, o, objs in behaviours(pre, {'shortname', 'occupySlots'}):
        d = o.read_typetree()
        items[d['shortname']] = d
        go = objs[d['m_GameObject']['m_PathID']].read()
        for c in go.m_Component:
            x = (c.component if hasattr(c, 'component') else c).deref()
            if x.type.name != 'MonoBehaviour':
                continue
            t = x.read_typetree()
            if 'availableSlots' in t:
                containers[d['shortname']] = (t['capacity'], t['availableSlots'])
            if 'defaultBone' in t:
                bones[d['shortname']] = t['defaultBone']

    # stats dos mods (ProjectileWeaponMod na entidade) e override de mira do viewmodel
    mods = {}
    for short, base in MOD_PREFABS.items():
        ent = vm = None
        for pid, o, objs in behaviours(scenes, {'needsOnForEffects', 'isSilencer'}):
            n = go_name(objs, o.read_typetree())
            if n == f'assets/prefabs/weapon mods/{base}.entity.prefab':
                ent = o.read_typetree()
            elif n == f'assets/prefabs/weapon mods/{base}.vm.attachment.prefab':
                vm = o
        m = {'name': info(short)['Name'], 'slots': items[short]['occupySlots'], 'bone': bones.get(short, '')}
        if ent.get('needsOnForEffects'):
            m['needsOn'] = 1  # laser/lanterna: bônus só com a luz ligada
        for k in MOD_STATS:
            v = ent[k]
            if v['enabled']:
                m[k] = [round(v['scalar'], 4), round(v['offset'], 4)]
        for k in MOD_FLAGS:
            if ent.get(k) not in (None, 0, -1, 0.0):
                m[k] = round(ent[k], 3) if isinstance(ent[k], float) else ent[k]
        if ent.get('zoomLevels'):
            m['zoomLevels'] = ent['zoomLevels']
        if vm is not None:
            objs = vm.assets_file.objects
            go = objs[vm.read_typetree()['m_GameObject']['m_PathID']].read()
            for c in go.m_Component:
                x = (c.component if hasattr(c, 'component') else c).deref()
                if x.type.name == 'MonoBehaviour' and 'zoomFactor' in x.read_typetree():
                    t = x.read_typetree()
                    m['sight'] = {'zoomFactor': round(t['zoomFactor'], 4), 'fieldOfViewOffset': t['fieldOfViewOffset'], 'fovBias': t.get('fovBias', 1)}
        mods[short] = m

    ammo_out = {}
    for short, (cal, item_p, proj_p) in AMMO_TYPES.items():
        it = ammo_items['assets/prefabs/ammo/' + item_p]
        bl = bullets['assets/prefabs/ammo/' + proj_p]
        a = {'name': info(short)['Name'], 'stack': info(short)['stackable'], 'caliber': cal, 'velocity': it['projectileVelocity'], 'spread': round(it['projectileSpread'], 3),
             'damage': sum(t['amount'] for t in bl['damageTypes'] if t['type'] == 9),
             'heat': round(sum(t['amount'] for t in bl['damageTypes'] if t['type'] == 5), 3),
             'drag': round(bl['drag'], 4), 'gravity': round(bl['gravityModifier'], 4)}
        if 'explosive' in short:
            a['radius'] = 1.5  # ItemModProjectileRadialDamage
        ammo_out[short] = a

    used, weapons = {}, []
    for short, prefab, ammo in WEAPONS:
        e = next(v for k, v in ents.items() if k.endswith('/' + prefab))
        base = recoil[e['recoil']['m_PathID']]
        ov = base['newRecoilOverride']['m_PathID']
        cur = recoil[ov] if ov else base
        for r in (base, cur):
            used[r['m_Name']] = r
        item, bullet = ammo_items[AMMO[ammo][0]], bullets[AMMO[ammo][1]]
        weapons.append({
            'id': short,
            'ammo': ammo,
            'automatic': bool(e['automatic']),
            'repeatDelay': round(e['repeatDelay'], 5),
            'mag': e['primaryMagazine']['definition']['builtInSize'],
            'reloadTime': round(e['reloadTime'], 3),
            'deployDelay': round(e['deployDelay'], 3),
            'aimCone': round(e['aimCone'], 4),
            'hipAimCone': round(e['hipAimCone'], 4),
            'aimconePenaltyPerShot': round(e['aimconePenaltyPerShot'], 4),
            'aimConePenaltyMax': round(e['aimConePenaltyMax'], 4),
            'aimconePenaltyRecoverTime': round(e['aimconePenaltyRecoverTime'], 4),
            'aimconePenaltyRecoverDelay': round(e['aimconePenaltyRecoverDelay'], 4),
            'damage': round(sum(t['amount'] for t in bullet['damageTypes'] if t['type'] == 9) * e['damageScale'], 3),
            'velocity': round(item['projectileVelocity'] * e['projectileVelocityScale'], 3),
            'drag': round(bullet['drag'], 4),
            'gravity': round(bullet['gravityModifier'], 4),
            'damageDistances': [round(bullet['damageDistances']['x'] * e['distanceScale'], 3),
                                round(bullet['damageDistances']['y'] * e['distanceScale'], 3)],
            'damageMultipliers': [round(bullet['damageMultipliers']['x'], 3), round(bullet['damageMultipliers']['y'], 3)],
            'aimconeCurve': curve(e['aimconeCurve']),
            'recoilLegacy': base['m_Name'],
            'recoilCurrent': cur['m_Name'],
            'modCapacity': containers[short][0],
            'modSlots': containers[short][1],
        })

    rec_out = {}
    for name, r in sorted(used.items()):
        x = {k: (round(r[k], 5) if isinstance(r[k], float) else r[k]) for k in RECOIL_FIELDS}
        for k in ('useCurves', 'curvesAsScalar', 'overrideAimconeWithCurve'):
            x[k] = bool(x[k])
        for c in CURVES:
            x[c] = curve(r[c])
        rec_out[name] = x

    with open(out, 'w') as f:
        f.write('// GERADO por tools/extract/extract.py a partir dos asset bundles do Rust (Unity 6000.3.15x1-13).\n')
        f.write('// RecoilProperties: content.bundle. Entidades/munição: assetscenes.bundle. Não editar à mão.\n')
        f.write('// recoilLegacy = o RecoilProperties original da arma (padrão com curvas);\n')
        f.write('// recoilCurrent = o newRecoilOverride que o jogo usa hoje (RecoilProperties.GetRecoil()).\n\n')
        compact = lambda o: json.dumps(o, separators=(',', ':'))
        f.write('export const RECOIL = {\n' + ',\n'.join(f'  {compact(k)}: {compact(v)}' for k, v in rec_out.items()) + '\n};\n\n')
        f.write('export const WEAPONS = [\n' + ',\n'.join('  ' + compact(w) for w in weapons) + '\n];\n\n')
        f.write('// slots (bitflag): 8 mira, 2|4 boca do cano, 16 sob o cano, 32 pente, 64 burst/GCO. Stats: [escala, soma]\n')
        f.write('export const MODS = {\n' + ',\n'.join(f'  {compact(k)}: {compact(v)}' for k, v in mods.items()) + '\n};\n\n')
        f.write('export const AMMO = {\n' + ',\n'.join(f'  {compact(k)}: {compact(v)}' for k, v in ammo_out.items()) + '\n};\n')
    print('ok', len(weapons), 'armas,', len(rec_out), 'recoils ->', out)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
