// Happy Singh Park — content catalogue.
// Every building holds one body of work. To add a piece: add an item to a building, or copy a
// building entry (a product showroom, a game lot or a tool shop) and give it a free spot.
// Positions use P(angle, radius): angle in degrees clockwise from north, radius in metres from
// the fountain plaza. Buildings turn to face the plaza automatically.

export const SITE = {
  name: 'Happy Singh',
  role: '3D artist and animator',
  email: 'harpreetsinghuppal26@gmail.com',
  // "Classic view" goes to the earlier homepage, kept at /classic.html when the park went live.
  classicUrl: 'https://happysingh3d.com/classic.html',
  links: [
    ['Gumroad', 'https://deadhunk.gumroad.com/'],
    ['itch.io', 'https://deadhunk.itch.io/'],
    ['Fiverr', 'https://www.fiverr.com/happysingh13'],
    ['GitHub', 'https://github.com/happysingh3d'],
  ],
};

export const SITES = {
  portfolio3d: { url: 'https://happysingh3d.com/3d-portfolio/', title: '3D portfolio website' },
  graphic: { url: 'https://happysingh3d.com/graphic-portfolio/', title: 'graphic design website' },
  video: { url: 'https://happysingh3d.com/video-portfolio/', title: 'video editing website' },
  toolkit: { url: 'https://happysingh3d.com/3d-toolkit/', title: '3D Artist Toolkit' },
};

export const PLAZA = [0, 10];
const P = (a, r) => { const t = a * Math.PI / 180; return [+(Math.sin(t) * r).toFixed(2), +(PLAZA[1] - Math.cos(t) * r).toFixed(2)]; };
const ccv = id => `https://www-ccv.adobe.io/v1/player/ccv/${id}/embed?bgcolor=%23191919&lazyLoading=true&api_key=BehancePro2View`;
const drive = id => `https://drive.google.com/file/d/${id}/preview`;
const img = name => `assets/web/${name}.webp`;
const gum = slug => `https://deadhunk.gumroad.com/l/${slug}`;

const TOOLS = [
  ['urbancraft', 'UrbanCraft', 'Real-world city scenes', 'sxikuz', 'city'],
  ['unwrapcraft', 'UnwrapCraft', 'UV workflow tools', 'bwhxby', 'checker'],
  ['meshfill', 'Meshfill 2.0', 'Patch and fill meshes', 'vxigiq', 'mesh'],
  ['cablecrafter', 'CableCrafter Pro', 'Cables and curves', 'rebvyi', 'cable'],
  ['gameready', 'GameReady', 'Asset preparation', 'bebyo', 'check'],
  ['hardcraft', 'HardCraft', 'Hard-surface modelling', 'xlqjabq', 'nut'],
  ['mechanatomy', 'MechAnatomy Craft', 'Mechanical modelling', 'dlcveq', 'gear'],
  ['modeling-kit', 'Modeling Toolkit', 'Bundle of modelling tools', 'foopa', 'shapes'],
  ['everything', 'Everything Pack', 'Every tool in one bundle', 'ykdrdu', 'gift'],
];
const SHOP_ACCENTS = ['#e07a2d', '#3f8f5a', '#3d8fb8', '#d4577a', '#8a6fd1', '#c9971f', '#2f9c95', '#c9724e', '#5b7bd5'];
const SHOP_BODIES = ['#f7dcc4', '#d3ead9', '#d4e9f3', '#f5d3de', '#e0d9f4', '#f5e7bd', '#cdece9', '#f2d6ca', '#d9e0f7'];
const SHOP_ANGLES = [108, 115, 122, 129, 143, 150, 157, 164, 171];

const GAME_CONTROLS = {
  foxfire: 'WASD to run, drag or Q/E to turn the camera, Space or Shift to dash. Stand on a pad to build a lantern.',
  'mirror-race': 'W to accelerate, S to brake, Shift to boost. Steering is reversed: A turns right, D turns left.',
  'neon-rescue': 'WASD to move, Shift to sprint, R to restart. Find your friends and bring them home.',
  'hive-adapt': 'WASD move, mouse to look (click to capture it, Esc to free it), left click fire, right click aim, E/Q build on amber pads, G starts the wave, B gear.',
};

export const BUILDINGS = [
  {
    id: 'animation', type: 'tower', at: P(0, 104), w: 20, d: 20, h: 54,
    title: 'Animation tower', sub: 'Rigs, character motion, effects', district: '3D and animation',
    accent: '#3d8fb8', tagline: 'Maya rigs, character animation and real-time effects.', site: SITES.portfolio3d,
    items: [
      { id: 'character-rig', title: 'Character rig', kind: 'embed', cover: img('rig'), embed: ccv('H3Lf29ETnzJ'),
        description: 'A Maya character rig: controls and deformation, shown in the original recording.', meta: 'Rigging, Autodesk Maya' },
      { id: 'animation-04', title: 'Character in motion', kind: 'embed', cover: img('anim-04'), embed: ccv('I2WXjQ62nHL'),
        description: 'A character movement study recorded in the Maya animation workspace. Watch it for timing and weight.', meta: 'Character animation, Maya' },
      { id: 'animation-01', title: 'Animation study 1', kind: 'embed', cover: img('anim-01'), embed: ccv('Q3o3ImhDRtn'),
        description: 'An animation study from the original portfolio recordings.', meta: 'Animation' },
      { id: 'animation-03', title: 'Animation study 3', kind: 'embed', cover: img('anim-03'), embed: ccv('M_Jy8D8xtui'),
        description: 'A further character animation study.', meta: 'Character animation' },
      { id: 'particles', title: 'Real-time particles', kind: 'embed', cover: img('particles'), embed: ccv('6mXRAp65_h9'),
        description: 'A real-time particle effects study built in Unity.', meta: 'VFX, Unity' },
      { id: 'pipeline', title: 'From asset to engine', kind: 'embed', cover: img('pipeline'), embed: ccv('UQV6U55twKC'),
        description: 'A technical recording of a material workflow in Unreal Engine.', meta: 'Technical workflow, Unreal Engine' },
    ],
  },
  {
    id: 'aster', type: 'showroom', variant: 'tower', at: P(27, 102), w: 11, d: 11, h: 17, overview: false,
    model: 'assets/products/aster-speaker.glb', productH: 6.2,
    title: 'Aster speaker', sub: 'Walnut bookshelf speaker', district: 'Product studios', accent: '#d9944f',
    tagline: 'A bookshelf speaker concept rendered in Blender.',
    items: [{ id: 'aster-speaker', title: 'Aster studio speaker', kind: 'images', cover: img('speaker-hero'),
      images: [['Finished render', img('speaker-hero')], ['Side', img('speaker-side')], ['Detail', img('speaker-detail')], ['Rear', img('speaker-rear')]],
      description: 'A bookshelf speaker concept in smoked walnut with champagne-metal driver rings.',
      meta: 'Concept study, Blender and Cycles, AI-assisted scripting' }],
  },
  {
    id: 'forma', type: 'showroom', variant: 'cube', at: P(43, 102), w: 16, d: 14, h: 11, overview: false,
    model: 'assets/products/forma-chair.glb', productH: 5.2,
    title: 'Forma chair', sub: 'Leather lounge chair', district: 'Product studios', accent: '#c9724e',
    tagline: 'A lounge chair concept rendered in Blender.',
    items: [{ id: 'forma-chair', title: 'Forma lounge chair', kind: 'images', cover: img('chair-hero'),
      images: [['Finished render', img('chair-hero')], ['Profile', img('chair-profile')], ['Detail', img('chair-detail')], ['Clay', img('chair-clay')]],
      description: 'A lounge chair with a walnut frame and cognac leather cushions. The seat tilts back 5°, the backrest reclines 18°, and the seat sits about 43 cm high.',
      meta: 'Concept study, Blender and Cycles, AI-assisted scripting' }],
  },
  {
    id: 'arc', type: 'showroom', variant: 'round', at: P(59, 102), r: 7.5, h: 13, overview: false,
    model: 'assets/products/arc-lamp.glb', productH: 6.8,
    title: 'Arc lamp', sub: 'Brass desk lamp', district: 'Product studios', accent: '#5b7bd5',
    tagline: 'A desk lamp concept rendered in Blender.',
    items: [{ id: 'arc-lamp', title: 'Arc desk lamp', kind: 'images', cover: img('arc-hero'),
      images: [['Finished render', img('arc-hero')], ['Detail', img('arc-detail')], ['Clay', img('arc-clay')]],
      description: 'A task light with a curved brass neck, a hollow graphite shade and a weighted base.',
      meta: 'Concept study, Blender and Cycles, AI-assisted scripting' }],
  },
  {
    id: 'video', type: 'video', at: P(84, 98), w: 22, d: 16, h: 17, opens: 'site', site: SITES.video,
    title: 'Video studio', sub: 'Opens the video editing website', district: 'Video editing', accent: '#d4577a',
    tagline: 'Television edits, motion graphics and short film.',
    items: [
      { id: 'judge-edit', title: 'In the judge’s chair', kind: 'embed', cover: img('judge-edit'), embed: drive('1DmkwXZgjdMpDQQ53IT8jAP7psUdJhGqc'),
        description: 'A television edit. The video is hosted on Google Drive.', meta: 'Video editing' },
      { id: 'motion', title: 'Graphic, in motion', kind: 'embed', cover: img('motion'), embed: drive('10yMgbCK6-gNbVgX2IN7DM0q3jnVEiCxn'),
        description: 'A motion graphics piece. Hosted on Google Drive.', meta: 'Motion graphics' },
      { id: 'short-film', title: 'A short story', kind: 'embed', cover: img('short-film'), embed: ccv('7tgFVSzNm6a'),
        description: 'A short-film competition entry: acting and editing.', meta: 'Short film' },
    ],
  },
  {
    id: 'toolkit', type: 'workshop', at: P(136, 124), w: 22, d: 14, h: 9, opens: 'site', site: SITES.toolkit,
    title: '3D Artist Toolkit', sub: 'Free web app: opens the toolkit', district: 'Tool market', accent: '#2f9c95',
    tagline: 'Free tools that run in your browser.',
    items: [{ id: 'toolkit', title: '3D Artist Toolkit', kind: 'link', cover: img('toolkit'), href: SITES.toolkit.url, hrefLabel: 'Open the toolkit',
      description: 'Free and runs in your browser: normal-map generator, material preview, Maya and Blender script generators, texture packer.', meta: 'Free, web' }],
  },
  ...TOOLS.map(([id, title, sub, slug, icon], i) => ({
    id: `shop-${id}`, type: 'shop', icon, at: P(SHOP_ANGLES[i], 86), w: 6, d: 5, h: 4.6, overview: false,
    title, sub: `${sub}, Blender`, district: 'Tool market', accent: SHOP_ACCENTS[i], body: SHOP_BODIES[i],
    tagline: 'A Blender add-on on Gumroad.',
    items: [{ id, title, kind: 'link', href: gum(slug), hrefLabel: 'View on Gumroad', description: `${sub}. A Blender add-on sold on Gumroad.`, meta: 'Blender add-on' }],
  })),
  {
    id: 'about', type: 'kiosk', at: [12, 122], face: [0, 122], w: 5, d: 3.6, h: 3.6,
    title: 'About Happy', sub: 'Who made this park', district: 'Welcome', accent: '#3f8f5a',
    tagline: 'Who built this park, and how to reach him.',
    items: [{ id: 'about', title: 'Hello', kind: 'about', body: [
      'I’m Happy Singh (Harpreet Singh Uppal), a 3D artist and animator in Mohali, India. I model, rig, texture and animate for games and real-time apps, and I build the tools and small games you’ll find around this park.',
      'AI helps me explore and move fast at the start. The finishing — topology, UVs, materials, timing — I do by hand.',
      'Every building here holds a piece of my work. Empty plots are where new pieces will move in.',
    ] }],
  },
  // Game district: the real Project 0 lot builds. Click one to play full screen.
  {
    id: 'game-foxfire', type: 'lot', at: P(196, 104), lot: [24, 24], boxH: 22, model: 'assets/lots/ink-fox-shrine.glb', fit: [20, 20, 20],
    anim: 'stand_idle', toon: true, opens: 'game', game: 'foxfire',
    title: 'Foxfire Watch', sub: 'Ink Fox Shrine: play the game', district: 'Games', accent: '#f0a030', lotLabel: 'Project 0 lot 343',
    tagline: 'Defend the shrine as the Ink Fox.', controls: GAME_CONTROLS.foxfire,
    items: [{ id: 'foxfire', title: 'Foxfire Watch', kind: 'game', game: 'foxfire', cover: img('foxfire'), controls: GAME_CONTROLS.foxfire,
      description: 'Defend the shrine as the Ink Fox: dash between attacks and build lantern turrets. Every fifth wave the hive adapts to what hurt it most.', meta: 'Three.js, keyboard' }],
  },
  {
    id: 'game-mirror', type: 'lot', at: P(218, 104), lot: [26, 18], boxH: 12, model: 'assets/lots/mirror-race.glb', fit: [22, 14, 12],
    opens: 'game', game: 'mirror-race',
    title: 'Mirror Race', sub: 'Racing pavilion: play the game', district: 'Games', accent: '#2fd3e8', lotLabel: 'Project 0 lot 3076',
    tagline: 'A neon time trial with reversed steering.', controls: GAME_CONTROLS['mirror-race'],
    items: [{ id: 'mirror-race', title: 'Mirror Race', kind: 'game', game: 'mirror-race', cover: img('mirror-race'), controls: GAME_CONTROLS['mirror-race'],
      description: 'A two-lap neon time trial against seven racers, with reversed steering. Start on a practice difficulty.', meta: 'Three.js, keyboard' }],
  },
  {
    id: 'game-hive', type: 'lot', at: P(243, 110), lot: [34, 24], boxH: 26, model: 'assets/lots/hive-queen.glb', fit: [30, 21, 26],
    anim: '*', game: 'hive-adapt', href: 'https://deadhunk.itch.io/hive-adapt',
    title: 'Hive Adapt', sub: 'The Hive Queen: play here or on itch.io', district: 'Games', accent: '#f5c430', lotLabel: 'Project 0 lot 297',
    tagline: 'Hold the Core against a swarm that learns how you fight.', controls: GAME_CONTROLS['hive-adapt'],
    items: [{ id: 'hive-adapt', title: 'Hive Adapt', kind: 'game', game: 'hive-adapt', cover: img('hive-adapt'), controls: GAME_CONTROLS['hive-adapt'],
      href: 'https://deadhunk.itch.io/hive-adapt', hrefLabel: 'Full game on itch.io',
      description: 'Play here: the Project 0 version, single player, as the Foxfire Ronin (the Ink Fox in armour). Fight bug waves in third person, build turrets on the amber pads and power the Core Shield. Every fifth wave the Hive studies how you fight and evolves. The full game, with co-op, is on itch.io.',
      meta: 'Three.js (Project 0 version) · full game on itch.io' }],
  },
  {
    id: 'game-neon', type: 'lot', at: P(268, 104), lot: [26, 18], boxH: 12, model: 'assets/lots/haven-station.glb', fit: [22, 14, 11],
    opens: 'game', game: 'neon-rescue',
    title: 'Neon Rescue', sub: 'Haven Station: play the game', district: 'Games', accent: '#ff5fa8', lotLabel: 'Project 0 build',
    tagline: 'Find your friends in District 07.', controls: GAME_CONTROLS['neon-rescue'],
    items: [{ id: 'neon-rescue', title: 'Neon Rescue', kind: 'game', game: 'neon-rescue', cover: img('neon-rescue'), controls: GAME_CONTROLS['neon-rescue'],
      description: 'Find your friends in District 07 and bring everyone home before your energy runs out.', meta: 'Three.js, keyboard' }],
  },
  {
    id: 'characters', type: 'garden', at: P(232, 66), r: 13,
    title: 'Character garden', sub: 'Meet the foxes and the explorer', district: 'Characters', accent: '#8a6fd1',
    tagline: 'Characters built for Project 0. Spin them and try their moves.',
    items: [
      { id: 'ink-fox', title: 'Ink Fox', kind: 'model', model: 'assets/models/ink-fox.glb', cover: img('ink-fox'),
        description: 'The fox you explore the park as. Try the idle, run, fly, sit and expression clips.', meta: 'Animated GLB' },
      { id: 'fluffy', title: 'Fluffy Fox', kind: 'model', model: 'assets/models/fluffy.glb', cover: img('fluffy'),
        description: 'A softer fox with rounded volumes and a pale chest. Includes walk, run, flight and expression clips.', meta: 'Animated GLB' },
      { id: 'explorer', title: 'Reactor Explorer', kind: 'model', model: 'assets/models/explorer.glb', cover: img('explorer'),
        description: 'A compact explorer with armour panels, a dark visor and a glowing reactor core.', meta: 'Animated GLB' },
    ],
  },
  {
    id: 'design', type: 'design', at: P(300, 102), w: 22, d: 16, h: 19, opens: 'site', site: SITES.graphic,
    title: 'Design studio', sub: 'Opens the graphic design website', district: 'Graphic design', accent: '#0d99ff',
    tagline: 'Brand identity, packaging and typography.',
    items: [
      { id: 'brand', title: 'deExpressions identity', kind: 'images', cover: img('brand'), images: [['Identity', img('brand')]],
        description: 'Logo and brand identity.', meta: 'Brand identity' },
      { id: 'honey', title: 'Natural Honey label', kind: 'images', cover: img('honey'), images: [['Label', img('honey')]],
        description: 'A product label for a honey jar.', meta: 'Packaging and print' },
      { id: 'typography', title: 'Type with a voice', kind: 'images', cover: img('typography'), images: [['Composition', img('typography')]],
        description: 'A typographic composition.', meta: 'Typography' },
    ],
  },
  { id: 'plot-1', type: 'plot', at: P(324, 100), w: 16, d: 14, overview: false, title: 'Coming soon', sub: 'New work moves in here', district: 'Empty plot', accent: '#e07a2d', items: [] },
  { id: 'plot-2', type: 'plot', at: P(344, 104), w: 14, d: 12, overview: false, title: 'Coming soon', sub: 'New work moves in here', district: 'Empty plot', accent: '#e07a2d', items: [] },
];

// Extra name tags shown from above for groups of buildings.
export const AREAS = [
  { title: 'Product studios', sub: 'Speaker, chair and lamp, turning in glass', at: P(43, 102), y: 24, accent: '#c9724e', focus: 'forma' },
  { title: 'Tool market', sub: 'Nine Blender add-ons, one shop each', at: P(140, 88), y: 10, accent: '#2f9c95', focus: 'shop-gameready' },
];

// Shortcut chips along the bottom of the park.
export const CHIPS = [
  { label: 'About', id: 'about', open: true },
  { label: 'Animation', id: 'animation', open: true },
  { label: 'Products', id: 'forma' },
  { label: 'Games', id: 'game-foxfire' },
  { label: 'Characters', id: 'characters', open: true },
  { label: 'Tools', id: 'shop-gameready' },
  { label: 'Design', id: 'design', open: true },
  { label: 'Video', id: 'video', open: true },
];

// Sections for the plain list view (classic.html, kept as a no-3D fallback).
export const GROUPS = [
  { title: '3D and animation', tagline: 'Rigs, character animation, real-time effects and product renders.', ids: ['animation', 'aster', 'forma', 'arc'] },
  { title: 'Games', tagline: 'Games built for Project 0, plus Hive Adapt on itch.io.', ids: ['game-foxfire', 'game-mirror', 'game-hive', 'game-neon'] },
  { title: 'Characters', tagline: 'Characters built for Project 0.', ids: ['characters'] },
  { title: 'Tools for artists', tagline: 'A free web toolkit and Blender add-ons on Gumroad.', ids: ['toolkit', ...TOOLS.map(t => `shop-${t[0]}`)] },
  { title: 'Graphic design', tagline: 'Brand identity, packaging and typography.', ids: ['design'] },
  { title: 'Video editing', tagline: 'Television edits, motion graphics and short film.', ids: ['video'] },
  { title: 'About', tagline: 'Who made this, and how to reach him.', ids: ['about'] },
];
