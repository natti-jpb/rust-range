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

- Sai em `public/rust-assets/` (~45 MB). O jogo detecta `rust-assets/manifest.json` e usa esses arquivos; sem eles, cai no procedural.
- Esse conteúdo é da Facepunch e vem da sua cópia do jogo: está no `.gitignore` e no `.vercelignore`, e o `vite build` remove a pasta do `dist/`. Use só localmente (`npm run dev`).
- Pipeline: `tools/extract/rustfs.py` (bundles via mmap, dependências sob demanda), `mecanim.py` (AnimationClip streamed/dense/constant → trilhas), `glb.py` (escritor glTF binário), `export_assets.py` (Unity → three: espelha Z, assa bindposes, specular-gloss → metal/rough).

## Rodar

```bash
npm install
npm run dev
```

Controles: WASD, Shift correr, C/Ctrl agachar, Espaço pular, botão direito ADS, R recarregar, 1–0/roda/Q armas, T recoil, X limpar furos, P painel, Esc menu.
