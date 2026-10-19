"""Exporta texturas e sons do Minecraft (Java Edition) para public/mc-assets/.

USO LOCAL APENAS: conteúdo da Mojang. public/mc-assets/ está no .gitignore e no .vercelignore.

    python -I tools/extract/export_mc.py <client.jar> <assets/indexes/<n>.json> public/mc-assets [pasta assets/objects]

O client.jar e o índice são os mesmos que o launcher oficial baixa (piston-meta.mojang.com). Sons que não
estiverem na pasta de objetos do launcher são baixados de resources.download.minecraft.net (hash conferido).
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(__file__))

TEX = 'assets/minecraft/textures/'
ENTITY = {  # nome no jogo -> caminho no jar
    'zombie': 'entity/zombie/zombie.png', 'skeleton': 'entity/skeleton/skeleton.png',
    'creeper': 'entity/creeper/creeper.png', 'pig': 'entity/pig/pig_temperate.png',
    'chest': 'entity/chest/normal.png', 'arrow': 'entity/projectiles/arrow.png',
}
# nome usado em audio.mc() -> evento do sounds.json (+ volume/pitch do código do jogo)
SOUNDS = {
    'zombie_say': 'entity.zombie.ambient', 'zombie_hurt': 'entity.zombie.hurt', 'zombie_death': 'entity.zombie.death', 'zombie_step': 'entity.zombie.step',
    'skeleton_say': 'entity.skeleton.ambient', 'skeleton_hurt': 'entity.skeleton.hurt', 'skeleton_death': 'entity.skeleton.death', 'skeleton_step': 'entity.skeleton.step',
    'creeper_hurt': 'entity.creeper.hurt', 'creeper_death': 'entity.creeper.death', 'creeper_fuse': 'entity.creeper.primed',
    'pig_say': 'entity.pig.ambient', 'pig_hurt': 'entity.pig.hurt', 'pig_death': 'entity.pig.death', 'pig_step': 'entity.pig.step',
    'explode': 'entity.generic.explode', 'tnt_fuse': 'entity.tnt.primed', 'bow': 'entity.skeleton.shoot', 'arrow_hit': 'entity.arrow.hit',
    'glass_break': 'block.glass.break', 'chest_open': 'block.chest.open', 'chest_close': 'block.chest.close', 'pop': 'entity.item.pickup',
    'place_sand': 'block.sand.place', 'place_gravel': 'block.gravel.place', 'place_stone': 'block.stone.place', 'place_wood': 'block.wood.place',
    'place_grass': 'block.grass.place', 'place_cloth': 'block.wool.place', 'step_stone': 'block.stone.step', 'step_grass': 'block.grass.step',
    'step_wood': 'block.wood.step', 'step_sand': 'block.sand.step', 'step_gravel': 'block.gravel.step', 'step_cloth': 'block.wool.step',
}


def painters():
    """Nomes de textura de bloco usados em src/mc/blocks.js (chaves de PAINTERS)."""
    src = open(os.path.join(os.path.dirname(__file__), '../../src/mc/blocks.js')).read()
    body = src[src.index('const PAINTERS = {'):src.index('export const TEXTURES')]
    return re.findall(r'^  (\w+):', body, re.M)


def fetch(h, cache, objects):
    """Objeto do índice de assets: da pasta do launcher, do cache ou de resources.download.minecraft.net."""
    for d in [objects, cache]:
        if d and os.path.exists(os.path.join(d, h[:2], h)):
            return os.path.join(d, h[:2], h)
    p = os.path.join(cache, h[:2], h)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    data = urllib.request.urlopen(f'https://resources.download.minecraft.net/{h[:2]}/{h}').read()
    if hashlib.sha1(data).hexdigest() != h:
        raise ValueError('hash não confere: ' + h)
    with open(p, 'wb') as f:
        f.write(data)
    return p


def main(jar, index, out, objects=None):
    z = zipfile.ZipFile(jar)
    names = set(z.namelist())
    os.makedirs(out, exist_ok=True)
    done = []

    def copy(src, dst):
        os.makedirs(os.path.dirname(os.path.join(out, dst)), exist_ok=True)
        with open(os.path.join(out, dst), 'wb') as f:
            f.write(z.read(src))
        done.append(dst)

    for n in painters():
        if TEX + f'block/{n}.png' in names:
            copy(TEX + f'block/{n}.png', f'block/{n}.png')
    for k, p in ENTITY.items():
        copy(TEX + p, f'entity/{k}.png')
    for p in sorted(names):
        m = re.match(re.escape(TEX) + r'(environment/(?:.*/)?(sun|clouds)\.png|particle/explosion_\d+\.png)$', p)
        if m:
            copy(p, m.group(1).replace('environment/celestial/', 'environment/'))

    # sons: sounds.json do índice -> arquivos .ogg -> AAC (.m4a) como os do Rust
    objs = json.load(open(index))['objects']
    cache = os.path.join(tempfile.gettempdir(), 'mc-assets-cache')
    events = json.load(open(fetch(objs['minecraft/sounds.json']['hash'], cache, objects)))
    os.makedirs(os.path.join(out, 'snd'), exist_ok=True)
    table = {}
    for ours, ev in SOUNDS.items():
        if ev not in events:
            print('  sem evento', ev)
            continue
        table[ours] = []
        for s in events[ev]['sounds']:
            s = {'name': s} if isinstance(s, str) else s
            if s.get('type') == 'event':
                continue
            key = f"minecraft/sounds/{s['name']}.ogg"
            dst = 'snd/' + s['name'].replace('/', '_') + '.m4a'
            if not os.path.exists(os.path.join(out, dst)):
                src = fetch(objs[key]['hash'], cache, objects)
                subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-c:a', 'aac', '-b:a', '96k', os.path.join(out, dst)], check=True)
            table[ours].append({'file': dst, 'volume': s.get('volume', 1), 'pitch': s.get('pitch', 1), 'weight': s.get('weight', 1),
                                'dist': s.get('attenuation_distance', 16)})
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump({'version': os.path.basename(jar), 'textures': done, 'sounds': table}, f, indent=1)
    print(f'{len(done)} texturas, {sum(len(v) for v in table.values())} sons -> {out}')


if __name__ == '__main__':
    main(*sys.argv[1:])
