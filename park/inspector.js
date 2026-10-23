// The building panel (renders, videos, games, 3D models, links) and the website viewer.
// Shared by the park (index.html) and the classic view (classic.html).
import { SITE } from './catalog.js';

const dialog = document.querySelector('#inspector');
let siteDialog = null;
let current = null;          // { lot, item }
let viewer = null;           // active GLB viewer
const listeners = new Set();

export const isOpen = () => dialog.open || !!siteDialog?.open;
export const onInspectorChange = fn => listeners.add(fn);
const notify = () => { const open = isOpen(); listeners.forEach(fn => fn(open)); };

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};

function cleanupStage() {
  if (viewer) { viewer.dispose(); viewer = null; }
  dialog.querySelector('.stage')?.replaceChildren();
}

export function openBuilding(lot, itemId) {
  if (!lot || !lot.items.length) return;
  if (siteDialog?.open) siteDialog.close();
  const item = lot.items.find(i => i.id === itemId) || lot.items[0];
  current = { lot, item };
  render();
  if (!dialog.open) { dialog.showModal(); notify(); }
}
export const openLot = openBuilding;

export function closeInspector() { if (dialog.open) dialog.close(); if (siteDialog?.open) siteDialog.close(); }

dialog.addEventListener('close', () => { cleanupStage(); current = null; notify(); });
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

// ---------- full-screen viewer: websites and games ----------
// The bar shows for a few seconds, then slides away so the website or game has the whole screen.
// It comes back when the mouse reaches the top edge (or the tab is tapped on a phone). Esc also closes.
const noMenu = e => e.preventDefault();
document.addEventListener('contextmenu', noMenu);
let barTimer = null;
function fullView({ url, title, sub, game = false }) {
  if (!siteDialog) {
    siteDialog = el('dialog', { id: 'site-view', class: 'site-view', 'aria-label': 'Viewer' });
    document.body.append(siteDialog);
    siteDialog.addEventListener('close', () => { clearTimeout(barTimer); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); siteDialog.replaceChildren(); notify(); });
  }
  if (dialog.open) dialog.close();
  siteDialog.classList.toggle('is-game', game);
  const frame = el('iframe', { src: url, title, allow: game ? 'fullscreen; gamepad; autoplay' : 'fullscreen; autoplay', allowfullscreen: true });
  const loading = el('p', { class: 'site-loading', role: 'status' }, game ? `Loading ${title}…` : `Opening the ${title}…`);
  frame.addEventListener('load', () => {
    loading.remove(); frame.focus();
    try { frame.contentWindow.document.addEventListener('contextmenu', noMenu); } catch { /* another site: its own pages decide */ }
  });
  const full = document.fullscreenEnabled ? el('button', { class: 'text-btn', onclick: () => document.fullscreenElement ? document.exitFullscreen() : siteDialog.requestFullscreen().catch(() => {}) }, 'Full screen') : null;
  const bar = el('header', { class: 'site-bar' },
    el('button', { class: 'btn', onclick: () => siteDialog.close() }, 'Back to the park'),
    el('p', { class: 'site-name' }, el('b', {}, cap(title)), el('span', {}, sub)),
    full,
    game ? null : el('a', { class: 'text-btn', href: url, target: '_blank', rel: 'noopener' }, 'Open in a new tab'));
  const show = () => { clearTimeout(barTimer); siteDialog.classList.remove('bar-hidden'); };
  const hideSoon = ms => { clearTimeout(barTimer); barTimer = setTimeout(() => { if (bar.matches(':hover')) hideSoon(1200); else siteDialog.classList.add('bar-hidden'); }, ms); };
  const hot = el('div', { class: 'site-hot', 'aria-hidden': 'true', onmouseenter: show });
  const tab = el('button', { class: 'site-tab', onclick: () => { show(); hideSoon(4000); } }, '▾ Park');
  bar.addEventListener('mouseenter', show);
  bar.addEventListener('mouseleave', () => hideSoon(700));
  bar.addEventListener('focusin', show);
  bar.addEventListener('focusout', () => hideSoon(1500));
  siteDialog.replaceChildren(bar, hot, tab, el('div', { class: 'site-frame' }, loading, frame));
  siteDialog.classList.remove('bar-hidden');
  siteDialog.showModal(); notify();
  frame.focus();
  hideSoon(2800);
}
export const openSite = site => fullView({ url: site.url, title: site.title, sub: site.url.replace('https://', '') });
export const openGame = g => fullView({ url: `games/index.html?game=${g.game}`, title: g.title, sub: g.controls || 'Keyboard needed. Scores stay in this browser.', game: true });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- building panel ----------
function render() {
  cleanupStage();
  const { lot, item } = current;
  dialog.style.setProperty('--lot-accent', lot.accent);
  const head = el('header', { class: 'insp-head' },
    el('div', {},
      el('p', { class: 'insp-lot' }, lot.district || ''),
      el('h2', { id: 'insp-title' }, lot.title),
      el('p', { class: 'insp-tagline' }, lot.tagline || '')),
    el('button', { class: 'insp-close', 'aria-label': 'Close', onclick: () => dialog.close() }, '×'));

  const siteLink = lot.site ? el('button', { class: 'btn btn-wide', onclick: () => openSite(lot.site) }, `Open the ${lot.site.title}`) : null;

  const list = lot.items.length > 1 ? el('nav', { class: 'insp-items', 'aria-label': `${lot.title} pieces` },
    lot.items.map(i => el('button', {
      class: 'insp-item' + (i === item ? ' is-current' : ''), 'aria-current': i === item ? 'true' : false,
      onclick: () => { current.item = i; render(); dialog.querySelector('.insp-item.is-current')?.focus(); },
    }, i.cover ? el('img', { src: i.cover, alt: '', loading: 'lazy' }) : el('span', { class: 'insp-item-glyph', 'aria-hidden': 'true' }, i.title.slice(0, 1)),
      el('span', {}, i.title)))) : null;

  const stage = el('div', { class: 'stage' });
  const body = item.kind === 'about' ? el('div') : el('div', { class: 'insp-body' },
    el('h3', {}, item.title),
    item.description ? el('p', {}, item.description) : null,
    item.meta ? el('p', { class: 'insp-meta' }, item.meta) : null);

  dialog.replaceChildren(el('div', { class: 'insp', role: 'document' }, head, siteLink, list, stage, body));
  dialog.setAttribute('aria-labelledby', 'insp-title');
  fillStage(stage, item);
}

function fillStage(stage, item) {
  switch (item.kind) {
    case 'images': return imageStage(stage, item);
    case 'embed': return embedStage(stage, item);
    case 'game': return gameStage(stage, item);
    case 'model': return modelStage(stage, item);
    case 'link': return linkStage(stage, item);
    case 'about': return aboutStage(stage, item);
    case 'note': return stage.append(el('div', { class: 'link-card' }, el('div', { class: 'link-glyph', 'aria-hidden': 'true' }, item.title.slice(0, 1)), item.badge ? el('span', { class: 'badge' }, item.badge) : null));
  }
}

function imageStage(stage, item) {
  const main = el('img', { class: 'stage-img', src: item.images[0][1], alt: `${item.title}: ${item.images[0][0]}` });
  stage.append(el('figure', { class: 'stage-frame' }, main));
  if (item.images.length > 1) {
    const thumbs = el('div', { class: 'thumbs', role: 'group', 'aria-label': 'Views' });
    item.images.forEach(([label, src], i) => thumbs.append(el('button', {
      class: 'thumb' + (i === 0 ? ' is-current' : ''), 'aria-label': label,
      onclick: e => {
        main.src = src; main.alt = `${item.title}: ${label}`;
        thumbs.querySelectorAll('.thumb').forEach(b => b.classList.toggle('is-current', b === e.currentTarget));
      },
    }, el('img', { src, alt: '', loading: 'lazy' }), el('span', {}, label))));
    stage.append(thumbs);
  }
}

function embedStage(stage, item) {
  const frame = el('div', { class: 'stage-frame ratio' });
  const start = () => frame.replaceChildren(el('iframe', {
    src: item.embed, title: item.title, allow: 'autoplay; fullscreen; picture-in-picture', allowfullscreen: true, loading: 'lazy',
  }));
  frame.append(el('button', { class: 'poster', onclick: start, 'aria-label': `Play ${item.title}` },
    item.cover ? el('img', { src: item.cover, alt: '' }) : null, el('span', { class: 'play-pill' }, 'Play video')));
  stage.append(frame);
}

function gameStage(stage, item) {
  const frame = el('div', { class: 'stage-frame ratio game' });
  frame.append(el('button', { class: 'poster', onclick: () => openGame(item), 'aria-label': `Play ${item.title} full screen` },
    el('img', { src: item.cover, alt: '' }), el('span', { class: 'play-pill' }, 'Play full screen')));
  const actions = el('div', { class: 'stage-actions' },
    el('button', { class: 'btn', onclick: () => openGame(item) }, 'Play here, full screen'),
    item.href ? el('a', { class: 'btn btn-ghost', href: item.href, target: '_blank', rel: 'noopener' }, item.hrefLabel || 'Open') : null);
  stage.append(frame, actions, el('p', { class: 'hint' }, item.controls || 'Keyboard needed. Scores stay in this browser.'));
}

function linkStage(stage, item) {
  stage.append(el('div', { class: 'link-card' },
    item.cover ? el('img', { src: item.cover, alt: '' }) : el('div', { class: 'link-glyph', 'aria-hidden': 'true' }, item.title.slice(0, 1)),
    el('a', { class: 'btn', href: item.href, target: '_blank', rel: 'noopener' }, item.hrefLabel || 'Open')));
}

function aboutStage(stage, item) {
  stage.append(el('div', { class: 'about' },
    item.photo ? el('img', { class: 'about-photo', src: item.photo, alt: 'Happy Singh', width: 160, height: 160 }) : null,
    item.body.map(p => el('p', {}, p)),
    el('p', { class: 'about-actions' }, el('a', { class: 'btn', href: `mailto:${SITE.email}?subject=Project%20enquiry` }, 'Email me'),
      SITE.resumeUrl ? el('a', { class: 'btn btn-ghost', href: SITE.resumeUrl, target: '_blank', rel: 'noopener' }, 'Résumé (PDF)') : null),
    el('ul', { class: 'about-links' }, SITE.links.map(([label, href]) => el('li', {}, el('a', { href, target: '_blank', rel: 'noopener' }, label))))));
}

async function modelStage(stage, item) {
  const wrap = el('div', { class: 'stage-frame model' }, el('p', { class: 'model-status', role: 'status' }, 'Loading the model…'));
  const controls = el('div', { class: 'stage-actions' });
  stage.append(wrap, controls);
  try {
    const { createViewer } = await import('./viewer.js');
    if (!current || current.item !== item) return;
    viewer = await createViewer(wrap, item.model);
    if (!current || current.item !== item) { viewer.dispose(); viewer = null; return; }
    wrap.querySelector('.model-status')?.remove();
    if (viewer.clips.length) {
      const select = el('select', { 'aria-label': 'Animation', onchange: e => viewer.play(e.target.value) },
        viewer.clips.map(c => el('option', { value: c, selected: c === viewer.active }, c)));
      controls.append(el('label', { class: 'field' }, 'Animation ', select));
    }
    controls.append(el('span', { class: 'hint' }, 'Drag to turn, scroll or pinch to zoom.'));
  } catch (err) {
    console.error(err);
    wrap.querySelector('.model-status').textContent = 'This model needs WebGL. Try another browser or device.';
  }
}
