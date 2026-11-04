// --- Arenas: the battlefields players choose from on the title screen ---
// An arena is pure data: colours, shapes and counts. Each system that builds
// the scenery reads the part it owns:
//   terrain.ts    — `ground` and `palette` (turned into terrain materials)
//   obstacles.ts  — `obstacles`, plus `palette` for floating islands
//   backdrop.ts   — `sky`, `stars`, `body`, `farHills`, `nearHills`
//   clouds.ts     — `clouds`
//   lights.ts     — `body` (its glow)
//   flow.ts       — `wind`; background-war.ts — `war`
// This file imports nothing, so any module may import it at load time.
//
// Names and taglines are drawn with the 5x7 pixel FONT, which only has
// A–Z, 0–9, space and  : . , - ! ? / + < > % °  (no apostrophes).

/** How the ground's height line is shaped (see generateTerrain). */
export type GroundShape =
  | 'rolling'   // the classic: a few sine waves added together
  | 'dunes'     // long, smooth, lopsided sand waves
  | 'peaks'     // sharp mountain ridges with deep notches
  | 'caldera'   // two volcanic cones around a wide sunken bowl
  | 'craters'   // gentle plain pocked with round impact craters
  | 'plateaus'  // flat-topped steps joined by short ramps
  | 'flat'      // low, almost level ground with soft bumps
  | 'canyon'    // high mesas on both sides of a deep central gulch
  | 'valley';   // a low basin floor, leaving lots of open sky

/** Shape of the far parallax ridge (backdrop.ts). */
export type FarShape = 'jagged' | 'mesa' | 'dunes' | 'spires' | 'domes';

/** Silhouettes dotted along the near parallax hills (backdrop.ts). */
export type NearProps = 'pine' | 'cactus' | 'dead' | 'crystal' | 'stacks' | 'coral' | 'none';

/** The big thing hanging in the sky (backdrop.ts draws it, lights.ts makes it glow). */
export interface SkyBody {
  kind: 'moon' | 'sun' | 'planet' | 'twin' | 'none';
  x: number;  // screen space (0..VW), fixed to the screen like the stars
  y: number;
  r: number;
  // [lit side, shaded side, detail]. Detail = craters on a moon, the halo on a
  // sun, land masses on a planet. 'twin' draws two smaller moons.
  colors: [string, string, string];
  glow: string;  // colour of the soft light it casts (lights.ts)
}

export interface Arena {
  id: string;       // stable key, also the prefix of its terrain material names
  name: string;     // shown on the title screen
  tagline: string;  // one short line of flavour under the name

  // --- Sky ---
  sky: [string, string, string, string, string, string, string, string];  // gradient bands, top → horizon
  stars: number;                 // how many stars (0 = daytime)
  starColors: [string, string];  // [bright, dim]
  body: SkyBody;
  farHills: { shape: FarShape; colors: [string, string] };  // [rim, fill]
  nearHills: { color: string; props: NearProps };
  clouds: { amount: number; tones: [string, string, string] };  // amount: 0 = none, 1 = the classic count

  // --- Ground ---
  ground: {
    shape: GroundShape;
    base: [number, number];  // average ground height, as a fraction of H (picked at random in this range)
    amp: number;             // multiplies how tall the shape's hills are
  };
  palette: {
    top: [string, string];                           // surface layer [main, dark speckle]: grass, sand, snow…
    soil: [string, string, string, string, string];  // deeper bands, top → bottom
    rock: [string, string];                          // buried pockets [upper, lower half]
    deco: [string, string] | null;                   // tufts poking up from the surface [stem, tip]
    decoChance: number;                              // chance per column of a tuft
    pockets: number;                                 // buried pocket count multiplier (1 = classic)
    moss: boolean;                                   // moss on top of boulders
    vines: boolean;                                  // roots and vines under floating islands
  };
  obstacles: {
    // [min, max] per screen width of map
    boulders: [number, number];
    monoliths: [number, number];
    islands: [number, number];
  };

  // --- Weather ---
  wind: number;  // wind is picked in -wind..wind each match (0 = always calm)
  war: boolean;  // whether the distant background war is raging
}

export const ARENAS: Arena[] = [
  {
    id: 'VALE', name: 'VERDANT VALE', tagline: 'ROLLING GREEN HILLS AT DUSK',
    sky: ['#0a0a1f', '#141a3a', '#22265a', '#3d2f6e', '#6a3a78', '#a8487a', '#e0687a', '#ffa07a'],
    stars: 260, starColors: ['#fff6e0', '#8f88c0'],
    body: { kind: 'moon', x: 505, y: 62, r: 20, colors: ['#f4ecd2', '#d9cfb4', '#c8bc9f'], glow: '#9fb4ff' },
    farHills: { shape: 'jagged', colors: ['#4a3f80', '#2c2558'] },
    nearHills: { color: '#1c1838', props: 'pine' },
    clouds: { amount: 1, tones: ['#6b5a9a', '#4b3f7a', '#352c5e'] },
    ground: { shape: 'rolling', base: [0.55, 0.68], amp: 1 },
    palette: {
      top: ['#4fbf4a', '#2f8a45'], soil: ['#a5603c', '#87492f', '#663626', '#47261e', '#2e1915'],
      rock: ['#6b6170', '#4a4252'], deco: ['#4fbf4a', '#8be36b'], decoChance: 0.35, pockets: 1, moss: true, vines: true,
    },
    obstacles: { boulders: [3, 5], monoliths: [1, 2], islands: [1, 2] },
    wind: 6, war: true,
  },
  {
    id: 'DUNES', name: 'SCORPION DUNES', tagline: 'SCORCHING SAND UNDER A HIGH SUN',
    sky: ['#2a6fb8', '#3d86c6', '#5a9ed2', '#7fb6dc', '#a8cce0', '#d6d8c8', '#f2d6a0', '#f7c27a'],
    stars: 0, starColors: ['#ffffff', '#ffffff'],
    body: { kind: 'sun', x: 140, y: 70, r: 18, colors: ['#fff6c8', '#ffe27a', '#ffd04a'], glow: '#ffd27a' },
    farHills: { shape: 'mesa', colors: ['#d89a6a', '#b87a52'] },
    nearHills: { color: '#9a5e3c', props: 'cactus' },
    clouds: { amount: 0.3, tones: ['#fff4e6', '#f2dcc6', '#d8bca6'] },
    ground: { shape: 'dunes', base: [0.58, 0.7], amp: 1 },
    palette: {
      top: ['#f2c477', '#dba95e'], soil: ['#d49a52', '#bd8244', '#a06a38', '#82552e', '#634024'],
      rock: ['#9c7a5c', '#6e5440'], deco: ['#7a8f3a', '#b8c25a'], decoChance: 0.06, pockets: 0.6, moss: false, vines: false,
    },
    obstacles: { boulders: [2, 4], monoliths: [1, 2], islands: [0, 1] },
    wind: 6, war: true,
  },
  {
    id: 'FROST', name: 'FROSTBITE RIDGE', tagline: 'KNIFE-EDGE PEAKS, AURORA SKIES',
    sky: ['#050a18', '#0a1630', '#10244a', '#16365e', '#1e4a70', '#2d6a84', '#4a8f98', '#7fb8b0'],
    stars: 220, starColors: ['#f0faff', '#7a9ac0'],
    body: { kind: 'moon', x: 470, y: 58, r: 16, colors: ['#eef6ff', '#cfdcec', '#b4c4d8'], glow: '#bfe0ff' },
    farHills: { shape: 'jagged', colors: ['#9fb8d8', '#5a6f94'] },
    nearHills: { color: '#2a3a58', props: 'pine' },
    clouds: { amount: 0.8, tones: ['#c8d8ec', '#9cb0cc', '#7088a8'] },
    ground: { shape: 'peaks', base: [0.5, 0.62], amp: 1.2 },
    palette: {
      top: ['#f4f8ff', '#d4e2f2'], soil: ['#a8c4dc', '#86a4c2', '#6a86a6', '#4e6688', '#36486a'],
      rock: ['#6a7488', '#4a5266'], deco: null, decoChance: 0, pockets: 1, moss: false, vines: false,
    },
    obstacles: { boulders: [2, 4], monoliths: [1, 2], islands: [1, 2] },
    wind: 6, war: true,
  },
  {
    id: 'CINDER', name: 'CINDER CALDERA', tagline: 'ASH, BASALT AND MOLTEN VEINS',
    sky: ['#120408', '#24080c', '#3a0c10', '#561410', '#7a2010', '#a03414', '#c84e1a', '#e8742a'],
    stars: 40, starColors: ['#ffd0a0', '#8a4a3a'],
    body: { kind: 'moon', x: 160, y: 60, r: 24, colors: ['#ff9a5a', '#e0663a', '#b8442a'], glow: '#ff6a2a' },
    farHills: { shape: 'spires', colors: ['#4a1a1a', '#2a0e10'] },
    nearHills: { color: '#1a0808', props: 'dead' },
    clouds: { amount: 1.2, tones: ['#4a3a3a', '#3a2c2c', '#2a2020'] },
    ground: { shape: 'caldera', base: [0.55, 0.66], amp: 1 },
    palette: {
      top: ['#4a4448', '#38343a'], soil: ['#2e2a30', '#262228', '#1e1a20', '#18141a', '#120e14'],
      rock: ['#ff8a2a', '#d2481a'], deco: null, decoChance: 0, pockets: 1.5, moss: false, vines: false,
    },
    obstacles: { boulders: [3, 5], monoliths: [1, 2], islands: [0, 1] },
    wind: 6, war: true,
  },
  {
    id: 'AMETHYST', name: 'AMETHYST HOLLOW', tagline: 'CRYSTAL FIELDS BENEATH TWIN MOONS',
    sky: ['#0c0618', '#1a0c2e', '#2a1444', '#3c1c5a', '#562a72', '#7a3a8a', '#a04e9a', '#c870a8'],
    stars: 260, starColors: ['#fff0ff', '#9a7ac0'],
    body: { kind: 'twin', x: 470, y: 56, r: 14, colors: ['#f0e0ff', '#cdb4ec', '#a88ccc'], glow: '#c89aff' },
    farHills: { shape: 'spires', colors: ['#6a4aa0', '#3a2668'] },
    nearHills: { color: '#1e1236', props: 'crystal' },
    clouds: { amount: 0.8, tones: ['#8a6ab0', '#6a4a90', '#4a3270'] },
    ground: { shape: 'rolling', base: [0.55, 0.68], amp: 1.1 },
    palette: {
      top: ['#c08aff', '#9a62e0'], soil: ['#6a4a8a', '#583c76', '#462e62', '#36224e', '#26183a'],
      rock: ['#e8c8ff', '#b48ae8'], deco: ['#9a62e0', '#e0b8ff'], decoChance: 0.2, pockets: 1.2, moss: false, vines: false,
    },
    obstacles: { boulders: [2, 4], monoliths: [2, 3], islands: [1, 2] },
    wind: 6, war: true,
  },
  {
    id: 'LUNAR', name: 'LUNAR WASTES', tagline: 'NO AIR, NO WIND, NO MERCY',
    sky: ['#000000', '#020205', '#04040a', '#06060f', '#080814', '#0a0a18', '#0c0c1c', '#10101f'],
    stars: 400, starColors: ['#ffffff', '#6a6a80'],
    body: { kind: 'planet', x: 150, y: 70, r: 22, colors: ['#4a8ae0', '#2a5aa8', '#4aa84a'], glow: '#6aa8ff' },
    farHills: { shape: 'jagged', colors: ['#8a8a90', '#5a5a62'] },
    nearHills: { color: '#2a2a30', props: 'none' },
    clouds: { amount: 0, tones: ['#000000', '#000000', '#000000'] },
    ground: { shape: 'craters', base: [0.58, 0.68], amp: 0.6 },
    palette: {
      top: ['#b4b4b8', '#9a9a9e'], soil: ['#86868c', '#727278', '#5e5e64', '#4a4a50', '#38383e'],
      rock: ['#5a5a60', '#404046'], deco: null, decoChance: 0, pockets: 1, moss: false, vines: false,
    },
    obstacles: { boulders: [3, 5], monoliths: [0, 1], islands: [0, 0] },
    wind: 0, war: false,
  },
  {
    id: 'SCRAP', name: 'SCRAPYARD SPRAWL', tagline: 'RUST, SMOG AND BURIED SCRAP',
    sky: ['#2a2418', '#3a3220', '#4a4028', '#5c5030', '#706038', '#887040', '#a08448', '#b89850'],
    stars: 0, starColors: ['#ffffff', '#ffffff'],
    body: { kind: 'sun', x: 420, y: 80, r: 16, colors: ['#f8e8a8', '#e8d088', '#d0b870'], glow: '#f0c060' },
    farHills: { shape: 'mesa', colors: ['#5a5040', '#3e3830'] },
    nearHills: { color: '#2a2418', props: 'stacks' },
    clouds: { amount: 1.2, tones: ['#6a6050', '#5a5040', '#4a4030'] },
    ground: { shape: 'plateaus', base: [0.55, 0.68], amp: 1 },
    palette: {
      top: ['#8a5a3a', '#6e4630'], soil: ['#5e4a3e', '#4e3e34', '#40322a', '#322820', '#241c18'],
      rock: ['#7a7e86', '#55585e'], deco: null, decoChance: 0, pockets: 1.6, moss: false, vines: false,
    },
    obstacles: { boulders: [3, 5], monoliths: [1, 2], islands: [0, 1] },
    wind: 6, war: true,
  },
  {
    id: 'BAYOU', name: 'TOXIC BAYOU', tagline: 'GLOWING SLUDGE IN THE SWAMP FOG',
    sky: ['#081208', '#0e1e10', '#142a16', '#1c381c', '#2a4a22', '#3e5e26', '#58742a', '#7a8a30'],
    stars: 120, starColors: ['#e8ffc0', '#6a8a5a'],
    body: { kind: 'moon', x: 520, y: 64, r: 18, colors: ['#e0f0a0', '#c0d080', '#a0b060'], glow: '#c8ff6a' },
    farHills: { shape: 'domes', colors: ['#2a4a2a', '#1a301c'] },
    nearHills: { color: '#0e1a0e', props: 'dead' },
    clouds: { amount: 1.4, tones: ['#6a8a4a', '#4a6a3a', '#34502a'] },
    ground: { shape: 'flat', base: [0.62, 0.72], amp: 0.5 },
    palette: {
      top: ['#5a7a2a', '#3e5a22'], soil: ['#4a3a22', '#3c2e1c', '#302416', '#241c12', '#1a140e'],
      rock: ['#7ae04a', '#4aa02a'], deco: ['#4a6a22', '#9ac83a'], decoChance: 0.4, pockets: 1.2, moss: true, vines: true,
    },
    obstacles: { boulders: [2, 3], monoliths: [1, 2], islands: [1, 2] },
    wind: 6, war: true,
  },
  {
    id: 'GULCH', name: 'RED ROCK GULCH', tagline: 'MESAS, SUNSET AND A LONG DROP',
    sky: ['#2a1430', '#4a1c3a', '#6e2440', '#962e3e', '#bc4438', '#d8623a', '#ec8840', '#f8b058'],
    stars: 30, starColors: ['#fff0d0', '#c08070'],
    body: { kind: 'sun', x: 120, y: 112, r: 22, colors: ['#fff0b0', '#ffd070', '#ffb050'], glow: '#ff9a4a' },
    farHills: { shape: 'mesa', colors: ['#a8443a', '#7a2e2e'] },
    nearHills: { color: '#4a1a20', props: 'cactus' },
    clouds: { amount: 0.5, tones: ['#ffb08a', '#e08070', '#b05a5a'] },
    ground: { shape: 'canyon', base: [0.45, 0.55], amp: 1 },
    palette: {
      top: ['#d0683a', '#b4542e'], soil: ['#c45a36', '#e08a4a', '#a84a2e', '#d07840', '#8a3a26'],
      rock: ['#8a5a4a', '#6a4034'], deco: ['#8a7a3a', '#c8b05a'], decoChance: 0.08, pockets: 0.8, moss: false, vines: false,
    },
    obstacles: { boulders: [3, 5], monoliths: [1, 1], islands: [0, 1] },
    wind: 6, war: true,
  },
  {
    id: 'HAVEN', name: 'CLOUDHAVEN', tagline: 'A SKY FULL OF FLOATING ISLES',
    sky: ['#3a7ad8', '#4a8ae0', '#5c9ae6', '#70aaea', '#86baee', '#a0caf2', '#bcdaf4', '#d8eaf6'],
    stars: 0, starColors: ['#ffffff', '#ffffff'],
    body: { kind: 'sun', x: 520, y: 54, r: 16, colors: ['#ffffff', '#fff8d8', '#fff0b0'], glow: '#fff4c0' },
    farHills: { shape: 'domes', colors: ['#a8c4e8', '#88a8d8'] },
    nearHills: { color: '#6a90c8', props: 'pine' },
    clouds: { amount: 1.6, tones: ['#ffffff', '#e8f0fa', '#c8d8ee'] },
    ground: { shape: 'valley', base: [0.72, 0.8], amp: 0.6 },
    palette: {
      top: ['#6ad85a', '#44b048'], soil: ['#b8784a', '#9a6040', '#7c4a34', '#5e382a', '#422820'],
      rock: ['#8a8a98', '#6a6a78'], deco: ['#6ad85a', '#a8f080'], decoChance: 0.35, pockets: 1, moss: true, vines: true,
    },
    obstacles: { boulders: [1, 3], monoliths: [1, 2], islands: [4, 6] },
    wind: 6, war: true,
  },
  {
    id: 'REEF', name: 'SUNKEN REEF', tagline: 'TANK BATTLE AT THE BOTTOM OF THE SEA',
    sky: ['#020a1a', '#041428', '#06203a', '#082c4a', '#0a3a5a', '#0e4a6a', '#145c78', '#1c6e84'],
    stars: 120, starColors: ['#a0e8ff', '#3a7a9a'],  // drifting plankton, not stars
    body: { kind: 'none', x: 320, y: 0, r: 0, colors: ['#000000', '#000000', '#000000'], glow: '#000000' },
    farHills: { shape: 'spires', colors: ['#0a4058', '#06283c'] },
    nearHills: { color: '#041c2c', props: 'coral' },
    clouds: { amount: 0, tones: ['#000000', '#000000', '#000000'] },
    ground: { shape: 'rolling', base: [0.6, 0.7], amp: 0.9 },
    palette: {
      top: ['#ff7a9a', '#e0587a'], soil: ['#e8d8a8', '#c8b888', '#a89868', '#887850', '#685a3c'],
      rock: ['#4ad8c8', '#2aa898'], deco: ['#ff9a5a', '#ffd06a'], decoChance: 0.25, pockets: 1, moss: false, vines: false,
    },
    obstacles: { boulders: [3, 5], monoliths: [1, 2], islands: [0, 1] },
    wind: 2, war: false,
  },
  {
    id: 'BONE', name: 'BLOOD MOON BONEYARD', tagline: 'OLD BONES, RED SKIES',
    sky: ['#0a0204', '#180408', '#28060c', '#3a0a10', '#4e1014', '#601818', '#702020', '#7a2a26'],
    stars: 160, starColors: ['#ffd8d0', '#7a3a3a'],
    body: { kind: 'moon', x: 480, y: 64, r: 24, colors: ['#ff5a4a', '#d03a32', '#a82a26'], glow: '#ff3a3a' },
    farHills: { shape: 'jagged', colors: ['#3a1a20', '#22101a'] },
    nearHills: { color: '#160a0e', props: 'dead' },
    clouds: { amount: 0.8, tones: ['#4a1a20', '#3a1418', '#2a0e12'] },
    ground: { shape: 'rolling', base: [0.56, 0.68], amp: 1 },
    palette: {
      top: ['#d8cfb8', '#bab09a'], soil: ['#8a7a68', '#6e6052', '#564a40', '#40362e', '#2c2420'],
      rock: ['#f0e8d4', '#c8bea6'], deco: ['#6a5a48', '#a89878'], decoChance: 0.15, pockets: 1.4, moss: false, vines: false,
    },
    obstacles: { boulders: [2, 4], monoliths: [2, 3], islands: [0, 1] },
    wind: 6, war: true,
  },
];
