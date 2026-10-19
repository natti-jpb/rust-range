# Rust Range

Shooting range no navegador (Three.js + Vite) com o **recoil legado do Rust** (padrão fixo por curvas, ago/2017 → jun/2022) e o recoil atual como alternativa (tecla `T`).

Projeto de fã, sem afiliação com a Facepunch. Nenhum modelo, textura ou som do jogo é usado: só números lidos dos arquivos.

## De onde vêm os dados

`src/data/weapons.js` é gerado por `tools/extract/extract.py` a partir da instalação local do Rust (Unity 6000.3, IL2CPP):

```bash
pip install UnityPy
python -I tools/extract/extract.py "$HOME/Library/Application Support/Steam/steamapps/common/Rust" src/data/weapons.js
```

- `Bundles/shared/content.bundle` → 43 `RecoilProperties`. Cada arma aponta para o recoil antigo (`AR.Recoil`, `useCurves=true`), que aponta para o novo via `newRecoilOverride` (`ak47.recoil.nopattern`).
- `Bundles/shared/assetscenes.bundle` → `BaseProjectile` das armas (cadência, pente, aimcone, reload) e munição (velocidade, arrasto, gravidade, dano).
- `IronSights.zoomFactor` dos `*.viewmodel.prefab` → FOV do ADS (em `src/game/config.js`).
- `items.preload.bundle` → `occupySlots` de cada attachment e `ItemModContainer` (capacidade + `availableSlots`) de cada arma; `ProjectileWeaponMod` das entidades dos mods (scalar/offset de cadência, dano, velocidade, recoil, aimcone, pente, burst) e `IronSightOverride` das miras (zoom, FOV). Exportados como `MODS` e `AMMO`.

## Inventário e attachments

Regras do Rust (`src/game/items.js`, `inventory.js`): main 6×4 + belt 6; mod só entra se `occupySlots ⊆ availableSlots` e não divide slot com outro; stats combinam por `Average` (cadência, dano, velocidade, recoil), `Mult` (aimcone, pente com `ceil`) e `Sum` (offsets); laser e burst só valem ligados (`needsOnForEffects`), luneta no ADS. Reload consome munição do inventário; trocar o tipo descarrega e recarrega. Layout da UI copiado do `GameUI.Inventory` (`src/game/invui.js`).

Mundo do Minecraft: baús do arsenal atrás da linha de tiro (E), mobs hostis soltam munição/attachments como item no chão.

## Código decompilado (GameAssembly.dylib, arm64)

| Endereço | Função | O que faz |
|---|---|---|
| `0x1418bec` | `RecoilProperties.GetRecoil` | `newRecoilOverride ?? this` (sem convar) |
| `0x159a1a4` | `BaseProjectile`, por frame | padrão: `t = tiros/capacidade`, alvo = `curva(t)·max`, `MoveTowards(recoilAngles, alvo, dt·20)`; zera após `2×repeatDelay`; stancePenalty |
| `0x12e7e50` | `PlayerInput.FinalizeRecoil` | soma `recoilAngles` nos `bodyAngles` e zera (sem recuperação) |
| `0x159b1c8` | `BaseProjectile`, por tiro | punch: `Random.Range` × ADS × agachado 0,5 × movimento; `curvesAsScalar`; limite `maxRecoilRadius` |
| `0x1594af4` | `LaunchProjectile` | raio do aimcone = `curva(Random01)` |

Implementação em `src/core/recoil.js`. O caminho do AK gerado bate com as tabelas medidas pela comunidade em 2019–2021.

**Aproximado:** multiplicadores de dano por região, velocidades de movimento, aimcone do modo atual e a recuperação automática do recoil atual (não implementada).

## Versão local com os assets do Rust (não publicar)

Com o Rust instalado, dá para trocar o visual/som procedural pelo do jogo: viewmodels (armas + braços) com as animações originais (idle, fire, ADS, reload, deploy, dryfire), sons (tiro em camadas, eventos de reload/deploy, impactos, passos, hit marker) e o HUD (vitais e belt com o layout, cores, fonte e ícones do jogo).

```bash
pip install UnityPy numpy   # ffmpeg também é necessário (sons -> AAC)
python -I tools/extract/export_assets.py "$HOME/Library/Application Support/Steam/steamapps/common/Rust" public/rust-assets
```

- Também exporta os `*.vm.attachment.prefab` (miras, silenciadores, laser, lanterna) para os ossos `scope.attachment`/`barrel`/`flashlight.attachment`, os overlays das lunetas e os ícones/descrições dos itens (`… public/rust-assets mods` só refaz essa parte).
- Sai em `public/rust-assets/` (~60 MB). O jogo detecta `rust-assets/manifest.json` e usa esses arquivos; sem eles, cai no procedural.
- Esse conteúdo é da Facepunch e vem da sua cópia do jogo: está no `.gitignore` e no `.vercelignore`, e o `vite build` remove a pasta do `dist/`. Use só localmente (`npm run dev`).
- Pipeline: `tools/extract/rustfs.py` (bundles via mmap, dependências sob demanda), `mecanim.py` (AnimationClip streamed/dense/constant → trilhas), `glb.py` (escritor glTF binário), `export_assets.py` (Unity → three: espelha Z, assa bindposes, specular-gloss → metal/rough).

## Rodar

```bash
npm install
npm run dev
```

Controles: WASD, Shift correr, C/Ctrl agachar, Espaço pular, botão direito ADS, R recarregar, Tab inventário (arrastar; botão direito move rápido; Shift divide), 1–6/roda belt, E abrir baú/pegar item, F laser/lanterna/burst, roda no ADS zoom da luneta variável, T recoil, X limpar furos, P painel, Esc menu.
