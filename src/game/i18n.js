import { settings } from './config.js';

const S = {
  tagline: ['Shooting range com o recoil antigo do Rust (2017–2022), reconstruído dos arquivos do jogo.',
    "Shooting range with Rust's old recoil (2017–2022), rebuilt from the game files."],
  play: ['JOGAR', 'PLAY'],
  resume: ['CONTINUAR', 'RESUME'],
  touch: ['Precisa de mouse e teclado (desktop).', 'Needs mouse and keyboard (desktop).'],
  recoil: ['Recoil', 'Recoil'],
  legacy: ['Legado (2021)', 'Legacy (2021)'],
  current: ['Atual', 'Current'],
  legacyNote: ['Padrão fixo por curvas: a mira segue um caminho absoluto ao longo do pente (20°/s), igual para hip, ADS e agachado. Parou de atirar, o recoil fica na mira.',
    'Fixed curve pattern: your aim follows an absolute path across the magazine (20°/s), the same hip-fire, ADS and crouched. Stop firing and the recoil stays in your aim.'],
  currentNote: ['Combat Update (jun/2022): chutes aleatórios por tiro, menores no ADS e agachado, com aimcone crescente. Aproximado: sem a recuperação automática de recoil do jogo atual.',
    'Combat Update (Jun 2022): random per-shot kicks, reduced by ADS and crouching, with a growing aimcone. Approximate: without the current game\'s automatic recoil recovery.'],
  weapon: ['Arma', 'Weapon'],
  settings: ['Configurações', 'Settings'],
  sens: ['Sensibilidade (Rust)', 'Sensitivity (Rust)'],
  fov: ['FOV', 'FOV'],
  volume: ['Volume', 'Volume'],
  adsToggle: ['Mira (ADS) por toque em vez de segurar', 'Toggle ADS instead of hold'],
  showTrainer: ['Mostrar painel do padrão', 'Show pattern panel'],
  howTitle: ['Como o recoil foi extraído', 'How the recoil was extracted'],
  disclaimer: ['Projeto de fã, sem afiliação com a Facepunch Studios. Rust é marca da Facepunch. Nenhum modelo, textura ou som do jogo é usado: só números (recoil e stats) lidos dos arquivos.',
    'Fan project, not affiliated with Facepunch Studios. Rust is a trademark of Facepunch. No game models, textures or sounds are used: only numbers (recoil and stats) read from the files.'],
  disclaimerLocal: ['Projeto de fã, sem afiliação com a Facepunch Studios. Versão privada: modelos, animações, sons e HUD foram extraídos de uma instalação do Rust e pertencem à Facepunch — não redistribua.',
    'Fan project, not affiliated with Facepunch Studios. Private build: models, animations, sounds and HUD were extracted from a Rust install and belong to Facepunch — do not redistribute.'],
  modeLegacy: ['Recoil legado · 2021', 'Legacy recoil · 2021'],
  modeCurrent: ['Recoil atual', 'Current recoil'],
  hints: ['<b>Tab</b> inventário · <b>1–6</b> / roda belt · <b>E</b> abrir/pegar · <b>F</b> laser/lanterna · <b>R</b> recarregar · <b>T</b> recoil · <b>C</b>/<b>Ctrl</b> agachar · <b>X</b> limpar furos · <b>P</b> painel · <b>Esc</b> menu',
    '<b>Tab</b> inventory · <b>1–6</b> / wheel belt · <b>E</b> open/pick up · <b>F</b> laser/light · <b>R</b> reload · <b>T</b> recoil · <b>C</b>/<b>Ctrl</b> crouch · <b>X</b> clear holes · <b>P</b> panel · <b>Esc</b> menu'],
  player: ['Jogador', 'Player'],
  inventory: ['Inventário', 'Inventory'],
  arsenal: ['Arsenal (baú)', 'Arsenal (chest)'],
  modifications: ['Modificações', 'Modifications'],
  information: ['Informação', 'Information'],
  actions: ['Ações', 'Actions'],
  unload: ['Descarregar munição', 'Unload Ammo'],
  split: ['Dividir', 'Split'],
  drop: ['Soltar', 'Drop'],
  damage: ['Dano', 'Damage'],
  fireRate: ['Cadência', 'Fire Rate'],
  velocity: ['Velocidade', 'Velocity'],
  capacity: ['Pente', 'Capacity'],
  aimcone: ['Aimcone', 'Aim Cone'],
  zoom: ['Zoom', 'Zoom'],
  burst: ['Rajada', 'Burst'],
  silenced: ['Silenciada', 'Silenced'],
  toggle: ['Liga/desliga', 'Toggle'],
  fire: ['Calor', 'Heat'],
  radius: ['Raio', 'Radius'],
  open: ['Abrir', 'Open'],
  pickup: ['Pegar', 'Pick up'],
  trainerTitle: ['PADRÃO (graus)', 'PATTERN (degrees)'],
  trainerIdeal: ['sem compensar', 'no compensation'],
  trainerYou: ['seus tiros', 'your shots'],
  trainerScore: ['desvio médio', 'avg. drift'],
  trainerPunch: ['sem padrão fixo (chute aleatório)', 'no fixed pattern (random kick)'],
  hit: ['acerto', 'hit'],
  dead: ['VOCÊ MORREU', 'YOU DIED'],
  respawn: ['Clique ou aperte Espaço para renascer', 'Click or press Space to respawn'],
  mobs: ['Mobs (zumbis, esqueletos, creepers)', 'Mobs (zombies, skeletons, creepers)'],
  infiniteAmmo: ['Munição infinita (o pente nunca esvazia)', 'Infinite ammo (the magazine never empties)'],
  godMode: ['God mode (não leva dano)', 'God mode (no damage)'],
  peacefulMobs: ['Mobs não atacam (só andam pelo mapa)', 'Mobs don\'t attack (they just wander)'],
  head: ['cabeça', 'head'],
  kill: ['abatido', 'down'],
  how: [
    `<ul>
      <li>Rust é Unity IL2CPP. Os <code>RecoilProperties</code> (ScriptableObject) foram lidos do <code>Bundles/shared/content.bundle</code> com UnityPy; armas e munição, das asset scenes (<code>assetscenes.bundle</code>).</li>
      <li>Cada arma ainda aponta para o recoil antigo (ex.: <code>AR.Recoil</code>, com <code>useCurves</code>), e esse aponta para o novo em <code>newRecoilOverride</code> (<code>ak47.recoil.nopattern</code>). <code>RecoilProperties.GetRecoil()</code> devolve o override, então o padrão antigo ficou nos arquivos sem uso.</li>
      <li>O código que aplica as curvas também continua no <code>GameAssembly.dylib</code>. Desmontado (arm64), ele faz, por frame: <code>t = tiros / capacidade do pente</code>, alvo = <code>pitchCurve(t)·pitchMax</code> e <code>yawCurve(t)·yawMax</code>, e <code>recoilAngles = MoveTowards(recoilAngles, alvo, dt·20)</code>. Depois de <code>2×repeatDelay</code> sem atirar, o contador zera e <code>FinalizeRecoil()</code> soma o recoil na mira.</li>
      <li>Validação: o caminho do AK gerado aqui (sobe 29,4°, direita +5°, esquerda −5°, direita +8°, volta ao centro) bate com as tabelas que a comunidade mediu em 2019–2021.</li>
      <li>Aproximações: multiplicadores de dano por região, velocidades de movimento e o aimcone do modo atual.</li>
    </ul>`,
    `<ul>
      <li>Rust is Unity IL2CPP. The <code>RecoilProperties</code> ScriptableObjects were read from <code>Bundles/shared/content.bundle</code> with UnityPy; weapons and ammo from the asset scenes (<code>assetscenes.bundle</code>).</li>
      <li>Every weapon still points to its old recoil (e.g. <code>AR.Recoil</code>, with <code>useCurves</code>), which points to the new one through <code>newRecoilOverride</code> (<code>ak47.recoil.nopattern</code>). <code>RecoilProperties.GetRecoil()</code> returns the override, so the old pattern sits unused in the files.</li>
      <li>The code that applies the curves is still in <code>GameAssembly.dylib</code> too. Disassembled (arm64), each frame it does: <code>t = shots / magazine capacity</code>, target = <code>pitchCurve(t)·pitchMax</code> and <code>yawCurve(t)·yawMax</code>, and <code>recoilAngles = MoveTowards(recoilAngles, target, dt·20)</code>. After <code>2×repeatDelay</code> without firing, the counter resets and <code>FinalizeRecoil()</code> adds the recoil into your aim.</li>
      <li>Check: the AK path produced here (climbs 29.4°, right +5°, left −5°, right +8°, back to center) matches the tables the community measured in 2019–2021.</li>
      <li>Approximations: body-part damage multipliers, movement speeds and the current-mode aimcone.</li>
    </ul>`,
  ],
};

export const lang = () => (settings.lang ?? (navigator.language?.startsWith('pt') ? 'pt' : 'en'));
export const t = (k) => S[k][lang() === 'pt' ? 0 : 1];
