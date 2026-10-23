// Happy Singh Park — content catalogue.
// Every building holds one body of work. To add a piece: add an item to a building, or copy a
// building entry (a product showroom, a game lot or a tool shop) and give it a free spot.
// Positions use A(avenue angle, distance, side) along the six district avenues (or P(angle, radius) from the
// fountain plaza). Buildings at the end of an avenue face the plaza; buildings along it face the avenue.

export const SITE = {
  name: 'Happy Singh',
  role: '3D artist and animator',
  email: 'harpreetsinghuppal26@gmail.com',
  // "Classic view" goes to the earlier homepage, kept at /classic.html when the park went live.
  classicUrl: 'https://happysingh3d.com/classic.html',
  resumeUrl: 'https://happysingh3d.com/assets/Harpreet-Singh-Resume.pdf',
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
// A(avenue angle, distance, side): a spot along a district avenue; side > 0 is the right-hand side walking outward.
const A = (a, d, s = 0) => { const t = a * Math.PI / 180; return [+(Math.sin(t) * d + Math.cos(t) * s).toFixed(2), +(PLAZA[1] - Math.cos(t) * d + Math.sin(t) * s).toFixed(2)]; };
export { A };
// The park is a fountain plaza with six district avenues. Each avenue has its own exhibits along the way.
export const AVENUES = [
  { id: 'north', angle: 0, length: 136, width: 7 },
  { id: 'design', angle: 45, length: 90, width: 6 },
  { id: 'east', angle: 90, length: 117, width: 7 },
  { id: 'market', angle: 140, length: 98, width: 10 },
  { id: 'south', angle: 180, length: 156, width: 7 },
  { id: 'games', angle: 255, length: 116, width: 8 },
  { id: 'frontier', angle: 315, length: 92, width: 6 },
];
export const GATE = { d: 140 }, SPAWN = { d: 150 };
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
const SHOP_SPOTS = [[30, 9], [42, -9], [42, 9], [54, -9], [54, 9], [66, -9], [66, 9], [78, -9], [78, 9]]; // [distance, side] on the market street

const GAME_CONTROLS = {
  foxfire: 'WASD to run, drag or Q/E to turn the camera, Space or Shift to dash. Stand on a pad to build a lantern.',
  'mirror-race': 'W to accelerate, S to brake, Shift to boost. Steering is reversed: A turns right, D turns left.',
  'neon-rescue': 'WASD to move, Shift to sprint, R to restart. Find your friends and bring them home.',
  afterglow: 'Drag across the sea or use A/D to aim the beam. W lifts it over rocks, S lowers it for a longer road. Space starts a run and fires a flare during play.',
  'hive-adapt': 'WASD move, mouse to look (click to capture it, Esc to free it), left click fire, right click aim, E/Q build on amber pads, G starts the wave, B gear.',
};

export const BUILDINGS = [
  {
    id: 'animation', type: 'tower', at: A(0, 148), w: 20, d: 20, h: 54,
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
    id: 'aster', type: 'showroom', variant: 'tower', at: A(0, 86, -15), face: A(0, 86), w: 11, d: 11, h: 17, overview: false,
    model: 'assets/products/aster-speaker.glb', productH: 6.2,
    title: 'Aster speaker', sub: 'Walnut bookshelf speaker', district: 'Product studios', accent: '#d9944f',
    tagline: 'A bookshelf speaker concept rendered in Blender.',
    items: [{ id: 'aster-speaker', title: 'Aster studio speaker', kind: 'images', cover: img('speaker-hero'),
      images: [['Finished render', img('speaker-hero')], ['Side', img('speaker-side')], ['Detail', img('speaker-detail')], ['Rear', img('speaker-rear')]],
      description: 'A bookshelf speaker concept in smoked walnut with champagne-metal driver rings.',
      meta: 'Concept study, Blender and Cycles, AI-assisted scripting' }],
  },
  {
    id: 'forma', type: 'showroom', variant: 'cube', at: A(0, 98, 16), face: A(0, 98), w: 16, d: 14, h: 11, overview: false,
    model: 'assets/products/forma-chair.glb', productH: 5.2,
    title: 'Forma chair', sub: 'Leather lounge chair', district: 'Product studios', accent: '#c9724e',
    tagline: 'A lounge chair concept rendered in Blender.',
    items: [{ id: 'forma-chair', title: 'Forma lounge chair', kind: 'images', cover: img('chair-hero'),
      images: [['Finished render', img('chair-hero')], ['Profile', img('chair-profile')], ['Detail', img('chair-detail')], ['Clay', img('chair-clay')]],
      description: 'A lounge chair with a walnut frame and cognac leather cushions. The seat tilts back 5°, the backrest reclines 18°, and the seat sits about 43 cm high.',
      meta: 'Concept study, Blender and Cycles, AI-assisted scripting' }],
  },
  {
    id: 'arc', type: 'showroom', variant: 'round', at: A(0, 118, 18), face: A(0, 118), r: 7.5, h: 13, overview: false,
    model: 'assets/products/arc-lamp.glb', productH: 6.8,
    title: 'Arc lamp', sub: 'Brass desk lamp', district: 'Product studios', accent: '#5b7bd5',
    tagline: 'A desk lamp concept rendered in Blender.',
    items: [{ id: 'arc-lamp', title: 'Arc desk lamp', kind: 'images', cover: img('arc-hero'),
      images: [['Finished render', img('arc-hero')], ['Detail', img('arc-detail')], ['Clay', img('arc-clay')]],
      description: 'A task light with a curved brass neck, a hollow graphite shade and a weighted base.',
      meta: 'Concept study, Blender and Cycles, AI-assisted scripting' }],
  },
  {
    id: 'creatures', type: 'gallery', hidden: true, at: A(0, 50), title: 'Hive Adapt creatures', sub: 'Game-ready creature models', district: '3D and animation', accent: '#9a6bd8',
    tagline: 'The swarm from Hive Adapt. Spin them in 3D.',
    items: [
      { id: 'crawler', base: [0.15, 0.11, 0.08], emis: [4.5, 1.2, 0.2], title: 'Crawler', kind: 'model', model: 'games/hive-adapt/assets/models/SK_Crawler.glb', description: 'The basic swarm bug: fast, low and many. Modelled for Hive Adapt.', meta: 'Game-ready creature, GLB' },
      { id: 'spitter', base: [0.25, 0.3, 0.16], emis: [2.2, 6, 0.45], title: 'Spitter', kind: 'model', model: 'games/hive-adapt/assets/models/SK_Spitter.glb', description: 'Hangs back and lobs acid. Modelled for Hive Adapt.', meta: 'Game-ready creature, GLB' },
      { id: 'flyer', base: [0.1, 0.13, 0.09], emis: [1.6, 4.2, 0.6], title: 'Flyer', kind: 'model', model: 'games/hive-adapt/assets/models/SK_Flyer.glb', description: 'Dives at defenders from above. Modelled for Hive Adapt.', meta: 'Game-ready creature, GLB' },
      { id: 'skyqueen', base: [0.09, 0.07, 0.13], emis: [0.9, 3.8, 6.5], title: 'Sky Queen', kind: 'model', model: 'games/hive-adapt/assets/models/SK_SkyQueen.glb', description: 'An airborne queen that arrives on a fifth wave. Modelled for Hive Adapt.', meta: 'Game-ready creature, GLB' },
      { id: 'hiveboss', base: [0.13, 0.07, 0.06], emis: [6, 1.1, 0.15], title: 'Hive Boss', kind: 'model', model: 'games/hive-adapt/assets/models/SK_HiveBoss.glb', description: 'The heavy boss of the swarm. Modelled for Hive Adapt.', meta: 'Game-ready creature, GLB' },
      { id: 'matriarch', base: [0.16, 0.16, 0.17], emis: [6.5, 4.2, 1.6], title: 'Armored Matriarch', kind: 'model', model: 'games/hive-adapt/assets/models/SK_ArmoredMatriarch.glb', description: 'A plated queen built to soak damage. Modelled for Hive Adapt.', meta: 'Game-ready creature, GLB' },
    ],
  },
  {
    id: 'video', type: 'video', at: A(90, 125), w: 22, d: 16, h: 17, opens: 'site', site: SITES.video,
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
    id: 'toolkit', type: 'workshop', at: A(140, 105), w: 22, d: 14, h: 9, opens: 'site', site: SITES.toolkit,
    title: '3D Artist Toolkit', sub: 'Free web app: opens the toolkit', district: 'Tool market', accent: '#2f9c95',
    tagline: 'Free tools that run in your browser.',
    items: [{ id: 'toolkit', title: '3D Artist Toolkit', kind: 'link', cover: img('toolkit'), href: SITES.toolkit.url, hrefLabel: 'Open the toolkit',
      description: 'Free and runs in your browser: normal-map generator, material preview, Maya and Blender script generators, texture packer.', meta: 'Free, web' }],
  },
  ...TOOLS.map(([id, title, sub, slug, icon], i) => ({
    id: `shop-${id}`, type: 'shop', icon, at: A(140, SHOP_SPOTS[i][0], SHOP_SPOTS[i][1]), face: A(140, SHOP_SPOTS[i][0]), w: 6, d: 5, h: 4.6, overview: false,
    title, sub: `${sub}, Blender`, district: 'Tool market', accent: SHOP_ACCENTS[i], body: SHOP_BODIES[i],
    tagline: 'A Blender add-on on Gumroad.',
    items: [{ id, title, kind: 'link', href: gum(slug), hrefLabel: 'View on Gumroad', description: `${sub}. A Blender add-on sold on Gumroad.`, meta: 'Blender add-on' }],
  })),
  {
    id: 'shop-happy3d', type: 'shop', icon: 'radial', at: A(140, 30, -9), face: A(140, 30), w: 6, d: 5, h: 4.6, overview: false,
    title: 'Happy3D', sub: 'Maya-style controls, Blender', district: 'Tool market', accent: '#e8a33d', body: '#fbe6c4',
    tagline: 'Free and open source. In development.',
    items: [{ id: 'happy3d', title: 'Happy3D', kind: 'note', badge: 'In development',
      description: 'A free, open-source Blender add-on for artists coming from Maya: right-click marking menus, Shift and Ctrl right-click menus, and Maya hotkeys for modelling, UVs, rigging, skinning, sculpting and animation, on top of Blender’s own keymap. Built for Blender 5.2 LTS.',
      meta: 'Blender add-on, Python, GPL · coming soon' }],
  },
  {
    id: 'about', type: 'kiosk', at: A(180, 118, 10), face: A(180, 118), w: 5, d: 3.6, h: 3.6,
    title: 'About Happy', sub: 'Who made this park', district: 'Welcome', accent: '#3f8f5a',
    tagline: 'Who built this park, and how to reach him.',
    items: [{ id: 'about', title: 'Hello', kind: 'about', photo: img('happy-portrait'), body: [
      'I’m Happy Singh (Harpreet Singh Uppal), a 3D artist and animator in Mohali, India. I model, rig, texture and animate for games and real-time apps, and I build the tools and small games you’ll find around this park.',
      'AI helps me explore and move fast at the start. The finishing — topology, UVs, materials, timing — I do by hand.',
      'Every building here holds a piece of my work. Empty plots are where new pieces will move in.',
    ] }],
  },
  // Game district: the real Project 0 lot builds. Click one to play full screen.
  {
    id: 'game-foxfire', type: 'lot', at: A(255, 44, -21), face: A(255, 44), lot: [24, 24], boxH: 22, model: 'assets/lots/ink-fox-shrine.glb', fit: [20, 20, 20],
    anim: 'stand_idle', toon: true, opens: 'game', game: 'foxfire',
    title: 'Foxfire Watch', sub: 'Ink Fox Shrine: play the game', district: 'Games', accent: '#f0a030', lotLabel: 'Project 0 lot 343',
    tagline: 'Defend the shrine as the Ink Fox.', controls: GAME_CONTROLS.foxfire,
    items: [{ id: 'foxfire', title: 'Foxfire Watch', kind: 'game', game: 'foxfire', cover: img('foxfire'), controls: GAME_CONTROLS.foxfire,
      description: 'Defend the shrine as the Ink Fox: dash between attacks and build lantern turrets. Every fifth wave the hive adapts to what hurt it most.', meta: 'Three.js, keyboard' }],
  },
  {
    id: 'game-mirror', type: 'lot', at: A(255, 48, 18), face: A(255, 48), lot: [26, 18], boxH: 12, model: 'assets/lots/mirror-race.glb', fit: [22, 14, 12],
    opens: 'game', game: 'mirror-race',
    title: 'Mirror Race', sub: 'Racing pavilion: play the game', district: 'Games', accent: '#2fd3e8', lotLabel: 'Project 0 lot 3076',
    tagline: 'A neon time trial with reversed steering.', controls: GAME_CONTROLS['mirror-race'],
    items: [{ id: 'mirror-race', title: 'Mirror Race', kind: 'game', game: 'mirror-race', cover: img('mirror-race'), controls: GAME_CONTROLS['mirror-race'],
      description: 'A two-lap neon time trial against seven racers, with reversed steering. Start on a practice difficulty.', meta: 'Three.js, keyboard' }],
  },
  {
    id: 'game-hive', type: 'lot', at: A(255, 86, -23), face: A(255, 86), lot: [34, 24], boxH: 26, model: 'assets/lots/hive-queen.glb', fit: [30, 21, 26],
    anim: '*', game: 'hive-adapt', href: 'https://deadhunk.itch.io/hive-adapt',
    title: 'Hive Adapt', sub: 'The Hive Queen: play here or on itch.io', district: 'Games', accent: '#f5c430', lotLabel: 'Project 0 lot 297',
    tagline: 'Hold the Core against a swarm that learns how you fight.', controls: GAME_CONTROLS['hive-adapt'],
    items: [{ id: 'hive-adapt', title: 'Hive Adapt', kind: 'game', game: 'hive-adapt', cover: img('hive-adapt'), controls: GAME_CONTROLS['hive-adapt'],
      href: 'https://deadhunk.itch.io/hive-adapt', hrefLabel: 'Full game on itch.io',
      description: 'Play here: the Project 0 version, single player, as the Foxfire Ronin (the Ink Fox in armour). Fight bug waves in third person, build turrets on the amber pads and power the Core Shield. Every fifth wave the Hive studies how you fight and evolves. The full game, with co-op, is on itch.io.',
      meta: 'Three.js (Project 0 version) · full game on itch.io' }],
  },
  {
    id: 'game-neon', type: 'lot', at: A(255, 86, 18), face: A(255, 86), lot: [26, 18], boxH: 12, model: 'assets/lots/haven-station.glb', fit: [22, 14, 11],
    opens: 'game', game: 'neon-rescue',
    title: 'Neon Rescue', sub: 'Haven Station: play the game', district: 'Games', accent: '#ff5fa8', lotLabel: 'Project 0 build',
    tagline: 'Find your friends in District 07.', controls: GAME_CONTROLS['neon-rescue'],
    items: [{ id: 'neon-rescue', title: 'Neon Rescue', kind: 'game', game: 'neon-rescue', cover: img('neon-rescue'), controls: GAME_CONTROLS['neon-rescue'],
      description: 'Find your friends in District 07 and bring everyone home before your energy runs out.', meta: 'Three.js, keyboard' }],
  },
  {
    id: 'game-afterglow', type: 'lot', at: A(255, 111, 19), face: A(255, 111), lot: [12, 12], boxH: 19, model: 'assets/lots/afterglow-lighthouse.glb', fit: [11, 11, 18.5],
    opens: 'game', game: 'afterglow',
    title: 'Afterglow', sub: 'The Last Lighthouse: play the game', district: 'Games', accent: '#3fd0c9', lotLabel: 'Project 0 lot 788',
    tagline: 'Guide seven lost sky rays home before nightfall.', controls: GAME_CONTROLS.afterglow,
    items: [{ id: 'afterglow', title: 'The Last Lighthouse: Afterglow', kind: 'game', game: 'afterglow', cover: img('afterglow'), controls: GAME_CONTROLS.afterglow,
      description: 'A 90-second rescue puzzle. Paint fading roads of light across a sea of cloud and guide seven lost manta rays home before night falls. Lift the beam over rocks, keep several roads alive at once, and spend two flares to calm the squall. Every ray you save counts, with three stars for a perfect night.', meta: 'Three.js, mouse or keyboard' }],
  },
  {
    id: 'characters', type: 'garden', at: A(0, 52, 25), face: A(0, 52), r: 13,
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
    id: 'design', type: 'design', at: A(45, 98), w: 22, d: 16, h: 19, opens: 'site', site: SITES.graphic,
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
  {
    id: 'frontier', type: 'outpost', at: A(315, 100), w: 14, d: 10, h: 6.5,
    title: 'Project Frontier', sub: 'Survival game in Unity, in development', district: 'Games in development', accent: '#d98a3a',
    tagline: 'A first-person survival game. The war ended; the instructions didn’t.',
    items: [{ id: 'frontier', title: 'Project Frontier', kind: 'images', cover: img('frontier-river'),
      images: [['River, in the engine', img('frontier-river')], ['Meadow, in the engine', img('frontier-meadow')], ['Forest, in the engine', img('frontier-forest')], ['Concept: the starting region', img('frontier-concept-start')], ['Concept: the reclaimed world', img('frontier-concept-reclaimed')]],
      description: 'My first-person survival game in Unity, in development: procedural terrain, rivers and forests, survival needs, tools and a day–night sky. The first three pictures are captured in the engine. The two concept boards set the look of the world. The other galleries here show the game’s assets.',
      meta: 'Unity (URP), C#, procedural terrain · in development' },
    { id: 'frontier-vehicles', title: 'Frontier assets: vehicles', kind: 'images', cover: 'assets/web/pf-pickup-truck-a.webp',
      images: [['Pickup truck', 'assets/web/pf-pickup-truck-a.webp'], ['Pickup truck, rear', 'assets/web/pf-pickup-truck-b.webp'], ['Pickup truck, another angle', 'assets/web/pf-pickup-truck-c.webp'], ['Utility van', 'assets/web/pf-rusted-van-a.webp'], ['Utility van, rear', 'assets/web/pf-rusted-van-b.webp'], ['Utility van, another angle', 'assets/web/pf-rusted-van-c.webp'], ['Rusted sedan', 'assets/web/pf-rusted-sedan-a.webp'], ['Rusted sedan, rear', 'assets/web/pf-rusted-sedan-b.webp'], ['Rusted sedan, another angle', 'assets/web/pf-rusted-sedan-c.webp']],
      description: 'Abandoned vehicles that fill the roads of the reclaimed world, at real size. AI-assisted game assets in production, not final art: generated in Tripo, then curated, textured and set up for Unity. Rendered in Blender (Cycles) from three angles.', meta: 'Tripo (AI) + Blender + Unity · 3 assets · in production' },
    { id: 'frontier-yard', title: 'Frontier assets: maintenance yard', kind: 'images', cover: 'assets/web/pf-workshop-shed-a.webp',
      images: [['Workshop shed', 'assets/web/pf-workshop-shed-a.webp'], ['Workshop shed, rear', 'assets/web/pf-workshop-shed-b.webp'], ['Workshop shed, another angle', 'assets/web/pf-workshop-shed-c.webp'], ['Corrugated fence', 'assets/web/pf-fence-corrugated-a.webp'], ['Corrugated fence, rear', 'assets/web/pf-fence-corrugated-b.webp'], ['Corrugated fence, another angle', 'assets/web/pf-fence-corrugated-c.webp'], ['Road barrier', 'assets/web/pf-road-barrier-a.webp'], ['Road barrier, rear', 'assets/web/pf-road-barrier-b.webp'], ['Road barrier, another angle', 'assets/web/pf-road-barrier-c.webp'], ['Work light', 'assets/web/pf-work-light-a.webp'], ['Work light, rear', 'assets/web/pf-work-light-b.webp'], ['Work light, another angle', 'assets/web/pf-work-light-c.webp'], ['Oil drum', 'assets/web/pf-oil-drum-blue-a.webp'], ['Oil drum, rear', 'assets/web/pf-oil-drum-blue-b.webp'], ['Oil drum, another angle', 'assets/web/pf-oil-drum-blue-c.webp'], ['Supply crate', 'assets/web/pf-supply-crate-a.webp'], ['Supply crate, rear', 'assets/web/pf-supply-crate-b.webp'], ['Supply crate, another angle', 'assets/web/pf-supply-crate-c.webp'], ['Wooden pallet', 'assets/web/pf-wooden-pallet-a.webp'], ['Wooden pallet, rear', 'assets/web/pf-wooden-pallet-b.webp'], ['Wooden pallet, another angle', 'assets/web/pf-wooden-pallet-c.webp']],
      description: 'A corrugated workshop shed, fencing and the clutter around it: the first building set. AI-assisted game assets in production, not final art: generated in Tripo, then curated, textured and set up for Unity. Rendered in Blender (Cycles) from three angles.', meta: 'Tripo (AI) + Blender + Unity · 7 assets · in production' },
    { id: 'frontier-props', title: 'Frontier assets: world props', kind: 'images', cover: 'assets/web/pf-vending-machine-a.webp',
      images: [['Vending machine', 'assets/web/pf-vending-machine-a.webp'], ['Vending machine, rear', 'assets/web/pf-vending-machine-b.webp'], ['Vending machine, another angle', 'assets/web/pf-vending-machine-c.webp'], ['Street terminal', 'assets/web/pf-info-kiosk-a.webp'], ['Street terminal, rear', 'assets/web/pf-info-kiosk-b.webp'], ['Street terminal, another angle', 'assets/web/pf-info-kiosk-c.webp'], ['Locker', 'assets/web/pf-locker-a.webp'], ['Locker, rear', 'assets/web/pf-locker-b.webp'], ['Locker, another angle', 'assets/web/pf-locker-c.webp'], ['Dumpster', 'assets/web/pf-dumpster-a.webp'], ['Dumpster, rear', 'assets/web/pf-dumpster-b.webp'], ['Dumpster, another angle', 'assets/web/pf-dumpster-c.webp'], ['Water tote', 'assets/web/pf-water-tote-ibc-a.webp'], ['Water tote, rear', 'assets/web/pf-water-tote-ibc-b.webp'], ['Water tote, another angle', 'assets/web/pf-water-tote-ibc-c.webp'], ['Generator', 'assets/web/pf-portable-generator-a.webp'], ['Generator, rear', 'assets/web/pf-portable-generator-b.webp'], ['Generator, another angle', 'assets/web/pf-portable-generator-c.webp'], ['Tool chest', 'assets/web/pf-toolbox-wheeled-a.webp'], ['Tool chest, rear', 'assets/web/pf-toolbox-wheeled-b.webp'], ['Tool chest, another angle', 'assets/web/pf-toolbox-wheeled-c.webp'], ['Metal case', 'assets/web/pf-metal-case-ammo-a.webp'], ['Metal case, rear', 'assets/web/pf-metal-case-ammo-b.webp'], ['Metal case, another angle', 'assets/web/pf-metal-case-ammo-c.webp'], ['Stretcher', 'assets/web/pf-stretcher-military-a.webp'], ['Stretcher, rear', 'assets/web/pf-stretcher-military-b.webp'], ['Stretcher, another angle', 'assets/web/pf-stretcher-military-c.webp'], ['Fuel can', 'assets/web/pf-fuel-can-a.webp'], ['Fuel can, rear', 'assets/web/pf-fuel-can-b.webp'], ['Fuel can, another angle', 'assets/web/pf-fuel-can-c.webp']],
      description: 'Containers, machines and equipment the player searches and uses. AI-assisted game assets in production, not final art: generated in Tripo, then curated, textured and set up for Unity. Rendered in Blender (Cycles) from three angles.', meta: 'Tripo (AI) + Blender + Unity · 10 assets · in production' },
    { id: 'frontier-salvage', title: 'Frontier assets: salvage', kind: 'images', cover: 'assets/web/pf-scrap-metal-bars-a.webp',
      images: [['Scrap metal', 'assets/web/pf-scrap-metal-bars-a.webp'], ['Scrap metal, rear', 'assets/web/pf-scrap-metal-bars-b.webp'], ['Scrap metal, another angle', 'assets/web/pf-scrap-metal-bars-c.webp'], ['Scrap pipes', 'assets/web/pf-scrap-pipes-bundle-a.webp'], ['Scrap pipes, rear', 'assets/web/pf-scrap-pipes-bundle-b.webp'], ['Scrap pipes, another angle', 'assets/web/pf-scrap-pipes-bundle-c.webp'], ['Cable coil', 'assets/web/pf-cable-bundle-coiled-a.webp'], ['Cable coil, rear', 'assets/web/pf-cable-bundle-coiled-b.webp'], ['Cable coil, another angle', 'assets/web/pf-cable-bundle-coiled-c.webp'], ['Wire bundle', 'assets/web/pf-wire-cable-bundle-a.webp'], ['Wire bundle, rear', 'assets/web/pf-wire-cable-bundle-b.webp'], ['Wire bundle, another angle', 'assets/web/pf-wire-cable-bundle-c.webp'], ['Mechanical parts', 'assets/web/pf-mechanical-parts-a-a.webp'], ['Mechanical parts, rear', 'assets/web/pf-mechanical-parts-a-b.webp'], ['Mechanical parts, another angle', 'assets/web/pf-mechanical-parts-a-c.webp'], ['Mechanical parts B', 'assets/web/pf-mechanical-parts-b-a.webp'], ['Mechanical parts B, rear', 'assets/web/pf-mechanical-parts-b-b.webp'], ['Mechanical parts B, another angle', 'assets/web/pf-mechanical-parts-b-c.webp'], ['Electronics salvage', 'assets/web/pf-electronics-salvage-a-a.webp'], ['Electronics salvage, rear', 'assets/web/pf-electronics-salvage-a-b.webp'], ['Electronics salvage, another angle', 'assets/web/pf-electronics-salvage-a-c.webp'], ['Electronics salvage B', 'assets/web/pf-electronics-salvage-b-a.webp'], ['Electronics salvage B, rear', 'assets/web/pf-electronics-salvage-b-b.webp'], ['Electronics salvage B, another angle', 'assets/web/pf-electronics-salvage-b-c.webp'], ['Old battery', 'assets/web/pf-power-cell-battery-a.webp'], ['Old battery, rear', 'assets/web/pf-power-cell-battery-b.webp'], ['Old battery, another angle', 'assets/web/pf-power-cell-battery-c.webp'], ['Battery cells', 'assets/web/pf-battery-cells-a.webp'], ['Battery cells, rear', 'assets/web/pf-battery-cells-b.webp'], ['Battery cells, another angle', 'assets/web/pf-battery-cells-c.webp']],
      description: 'Scrap, cable, parts, cells and electronics picked up in the world and turned into tools. AI-assisted game assets in production, not final art: generated in Tripo, then curated, textured and set up for Unity. Rendered in Blender (Cycles) from three angles.', meta: 'Tripo (AI) + Blender + Unity · 10 assets · in production' },
    { id: 'frontier-packs', title: 'Frontier assets: backpacks', kind: 'images', cover: 'assets/web/pf-backpack-expedition-a.webp',
      images: [['Expedition pack', 'assets/web/pf-backpack-expedition-a.webp'], ['Expedition pack, rear', 'assets/web/pf-backpack-expedition-b.webp'], ['Expedition pack, another angle', 'assets/web/pf-backpack-expedition-c.webp'], ['Medium pack', 'assets/web/pf-backpack-tactical-a.webp'], ['Medium pack, rear', 'assets/web/pf-backpack-tactical-b.webp'], ['Medium pack, another angle', 'assets/web/pf-backpack-tactical-c.webp'], ['Daypack', 'assets/web/pf-backpack-daypack-a.webp'], ['Daypack, rear', 'assets/web/pf-backpack-daypack-b.webp'], ['Daypack, another angle', 'assets/web/pf-backpack-daypack-c.webp'], ['Medium pack B', 'assets/web/pf-backpack-tactical-b-a.webp'], ['Medium pack B, rear', 'assets/web/pf-backpack-tactical-b-b.webp'], ['Medium pack B, another angle', 'assets/web/pf-backpack-tactical-b-c.webp']],
      description: 'Each size carries more and weighs more. AI-assisted game assets in production, not final art: generated in Tripo, then curated, textured and set up for Unity. Rendered in Blender (Cycles) from three angles.', meta: 'Tripo (AI) + Blender + Unity · 4 assets · in production' },
    { id: 'frontier-tools', title: 'Frontier assets: tools and weapons', kind: 'images', cover: 'assets/web/pf-tool-knife-a.webp',
      images: [['Knife', 'assets/web/pf-tool-knife-a.webp'], ['Knife, rear', 'assets/web/pf-tool-knife-b.webp'], ['Knife, another angle', 'assets/web/pf-tool-knife-c.webp'], ['Stone axe', 'assets/web/pf-tool-stone-axe-a.webp'], ['Stone axe, rear', 'assets/web/pf-tool-stone-axe-b.webp'], ['Stone axe, another angle', 'assets/web/pf-tool-stone-axe-c.webp'], ['Pickaxe', 'assets/web/pf-tool-pickaxe-crude-a.webp'], ['Pickaxe, rear', 'assets/web/pf-tool-pickaxe-crude-b.webp'], ['Pickaxe, another angle', 'assets/web/pf-tool-pickaxe-crude-c.webp'], ['Hammer', 'assets/web/pf-tool-hammer-a.webp'], ['Hammer, rear', 'assets/web/pf-tool-hammer-b.webp'], ['Hammer, another angle', 'assets/web/pf-tool-hammer-c.webp'], ['Wooden spear', 'assets/web/pf-weapon-spear-wooden-a.webp'], ['Wooden spear, rear', 'assets/web/pf-weapon-spear-wooden-b.webp'], ['Wooden spear, another angle', 'assets/web/pf-weapon-spear-wooden-c.webp'], ['Hunting bow', 'assets/web/pf-weapon-bow-hunting-a.webp'], ['Hunting bow, rear', 'assets/web/pf-weapon-bow-hunting-b.webp'], ['Hunting bow, another angle', 'assets/web/pf-weapon-bow-hunting-c.webp'], ['Survival knife', 'assets/web/pf-survival-knife-serrated-a.webp'], ['Survival knife, rear', 'assets/web/pf-survival-knife-serrated-b.webp'], ['Survival knife, another angle', 'assets/web/pf-survival-knife-serrated-c.webp'], ['Torch', 'assets/web/pf-tactical-flashlight-a.webp'], ['Torch, rear', 'assets/web/pf-tactical-flashlight-b.webp'], ['Torch, another angle', 'assets/web/pf-tactical-flashlight-c.webp']],
      description: 'Held tools and weapons. Six were made from the game’s own inventory icons; first-person grips come next. AI-assisted game assets in production, not final art: generated in Tripo, then curated, textured and set up for Unity. Rendered in Blender (Cycles) from three angles.', meta: 'Tripo (AI) + Blender + Unity · 8 assets · in production' }],
  },
  {
    id: 'itch', type: 'marquee', at: A(255, 120), w: 10, d: 3, h: 9, opens: 'link', href: 'https://deadhunk.itch.io/',
    title: '18 games on itch.io', sub: 'Browser games: opens itch.io', district: 'Games', accent: '#fa5c5c',
    tagline: 'Eighteen browser games, from bullet-heaven to streamer party games.',
    games: ['Hive Adapt', 'Shardfall', 'Block City Mayhem', 'Marble Mayhem', 'Chat Court', 'Chat Royale', 'Crowd Defusal', 'Dungeon Panic', 'Titan Rumble', 'Aetherforge', 'Rhythm Surge', 'Shadow Blade', 'Cosmic Forge', 'Abyss Deck', 'Void Drifter', 'Neon Grid', 'Deep Core', 'Chrono Survivors'],
    items: [{ id: 'itch', title: 'DeadHunk on itch.io', kind: 'link', href: 'https://deadhunk.itch.io/', hrefLabel: 'See all 18 games',
      description: 'Eighteen games that play in the browser: Hive Adapt, Shardfall, Block City Mayhem, Marble Mayhem, Chrono Survivors, Rhythm Surge, Shadow Blade, Void Drifter and more, including party games made for streamers and their chat.', meta: 'Browser games' }],
  },
  { id: 'plot-2', type: 'plot', at: A(315, 64, -18), face: A(315, 64), w: 14, d: 12, overview: false, title: 'Coming soon', sub: 'New work moves in here', district: 'Empty plot', accent: '#e07a2d', items: [] },
];

// Extra name tags shown from above for groups of buildings.
export const AREAS = [
  { title: '3D street', sub: 'Creatures, animation, products, characters', at: A(0, 66), y: 12, accent: '#3d8fb8', focus: 'characters' },
  { title: 'Video street', sub: 'Edits, motion graphics, short film', at: A(90, 62), y: 12, accent: '#d4577a', focus: 'video' },
  { title: 'Design walk', sub: 'Brand, packaging, typography', at: A(45, 52), y: 12, accent: '#0d99ff', focus: 'design' },
  { title: 'Tool market', sub: 'Blender add-ons, one shop each', at: A(140, 56), y: 10, accent: '#2f9c95', focus: 'shop-gameready' },
  { title: 'Games street', sub: 'Project 0 builds and more games', at: A(255, 68), y: 12, accent: '#f0a030', focus: 'game-foxfire' },
  { title: 'Frontier trail', sub: 'Games in development', at: A(315, 58), y: 10, accent: '#d98a3a', focus: 'frontier' },
]


// Exhibits stand along the avenues. Click one to open its piece. side: -1 left, +1 right (walking outward).
const STANDEES = [
  ['Shardfall', 'Break its horns and tail', 'shardfall', '#7b5cff'],
  ['Block City Mayhem', 'Five story levels of chaos', 'block-city-mayhem', '#ff7a3c'],
  ['Chrono Survivors', 'Outlast the swarm', 'chrono-survivors-zero-protocol', '#2fd3e8'],
  ['Marble Mayhem', 'Tiny marbles, massive rivalries', 'marble-mayhem', '#3fbf6a'],
  ['Rhythm Surge', 'Find your flow', 'rhythm-surge', '#ff4fa3'],
  ['Shadow Blade', 'One blade, a thousand chances', 'shadow-blade', '#e8c33d'],
];
export const EXHIBITS = [
  { avenue: 0, d: 26, side: -1, kind: 'poster', building: 'animation', item: 'character-rig' },
  { avenue: 0, d: 26, side: 1, kind: 'poster', building: 'animation', item: 'animation-04' },
  { avenue: 0, d: 38, side: -1, kind: 'model', building: 'creatures', item: 'crawler', h: 1.6 },
  { avenue: 0, d: 38, side: 1, kind: 'model', building: 'creatures', item: 'spitter', h: 1.8 },
  { avenue: 0, d: 50, side: -1, kind: 'poster', building: 'animation', item: 'animation-01' },
  { avenue: 0, d: 50, side: 1, kind: 'model', building: 'creatures', item: 'flyer', h: 1.8 },
  { avenue: 0, d: 62, side: -1, kind: 'model', building: 'creatures', item: 'skyqueen', h: 2.6 },
  { avenue: 0, d: 62, side: 1, kind: 'poster', building: 'animation', item: 'animation-03' },
  { avenue: 0, d: 74, side: -1, kind: 'poster', building: 'animation', item: 'particles' },
  { avenue: 0, d: 74, side: 1, kind: 'model', building: 'creatures', item: 'hiveboss', h: 2.8 },
  { avenue: 0, d: 82, side: 1, kind: 'model', building: 'creatures', item: 'matriarch', h: 2.6 },
  { avenue: 0, d: 104, side: -1, kind: 'poster', building: 'animation', item: 'pipeline' },
  { avenue: 90, d: 30, side: 1, kind: 'screen', building: 'video', item: 'judge-edit' },
  { avenue: 90, d: 50, side: -1, kind: 'screen', building: 'video', item: 'motion' },
  { avenue: 90, d: 70, side: 1, kind: 'screen', building: 'video', item: 'short-film' },
  { avenue: 45, d: 30, side: -1, kind: 'easel', building: 'design', item: 'brand' },
  { avenue: 45, d: 46, side: 1, kind: 'easel', building: 'design', item: 'honey' },
  { avenue: 45, d: 62, side: -1, kind: 'easel', building: 'design', item: 'typography' },
  { avenue: 315, d: 30, side: -1, kind: 'poster', building: 'frontier', item: 'frontier', image: 3 },
  { avenue: 315, d: 30, side: 1, kind: 'poster', building: 'frontier', item: 'frontier', image: 0 },
  { avenue: 315, d: 46, side: -1, kind: 'poster', building: 'frontier', item: 'frontier-vehicles', image: 0 },
  { avenue: 315, d: 46, side: 1, kind: 'poster', building: 'frontier', item: 'frontier-props', image: 0 },
  { avenue: 315, d: 62, side: 1, kind: 'poster', building: 'frontier', item: 'frontier-yard', image: 0 },
  { avenue: 315, d: 80, side: -1, kind: 'poster', building: 'frontier', item: 'frontier-packs', image: 0 },
  { avenue: 315, d: 80, side: 1, kind: 'poster', building: 'frontier', item: 'frontier-tools', image: 3 },
  ...[[22, -1], [22, 1], [64, -1], [64, 1], [108, -1], [108, 1]].map(([d, side], i) => ({ avenue: 255, d, side, kind: 'standee',
    title: STANDEES[i][0], sub: STANDEES[i][1], href: `https://deadhunk.itch.io/${STANDEES[i][2]}`, color: STANDEES[i][3] })),
];

// Shortcut chips along the bottom of the park.
export const CHIPS = [
  { label: 'About', id: 'about', open: true },
  { label: 'Animation', id: 'animation', open: true },
  { label: 'Products', id: 'forma' },
  { label: 'Games', id: 'game-foxfire' },
  { label: 'Characters', id: 'characters', open: true },
  { label: 'Frontier', id: 'frontier', open: true },
  { label: 'Tools', id: 'shop-gameready' },
  { label: 'Design', id: 'design', open: true },
  { label: 'Video', id: 'video', open: true },
];

// Sections for the plain list view (classic.html, kept as a no-3D fallback).
export const GROUPS = [
  { title: '3D and animation', tagline: 'Rigs, character animation, real-time effects and product renders.', ids: ['animation', 'creatures', 'aster', 'forma', 'arc'] },
  { title: 'Games', tagline: 'Games built for Project 0, plus Hive Adapt on itch.io.', ids: ['game-foxfire', 'game-mirror', 'game-hive', 'game-neon', 'game-afterglow', 'frontier', 'itch'] },
  { title: 'Characters', tagline: 'Characters built for Project 0.', ids: ['characters'] },
  { title: 'Tools for artists', tagline: 'A free web toolkit and Blender add-ons on Gumroad.', ids: ['toolkit', 'shop-happy3d', ...TOOLS.map(t => `shop-${t[0]}`)] },
  { title: 'Graphic design', tagline: 'Brand identity, packaging and typography.', ids: ['design'] },
  { title: 'Video editing', tagline: 'Television edits, motion graphics and short film.', ids: ['video'] },
  { title: 'About', tagline: 'Who made this, and how to reach him.', ids: ['about'] },
];
