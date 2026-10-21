// Operaciones de corrección sobre el último set de un caso (para aplicar los comentarios de la revisión).
import { applyTemplate, contentKey } from '../shared/templates.js';
import { stripDevices, backgroundVariants } from '../shared/generate.js';
import { newFrame, gridFormats } from '../shared/model.js';

const BASE = process.env.CS_URL || 'http://localhost:4510';
export const get = async (slug) => (await fetch(`${BASE}/api/project/${slug}`)).json();
export const put = async (slug, p) => {
  const r = await fetch(`${BASE}/api/project/${slug}/replace`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
  if (!r.ok) throw new Error(`replace ${slug}: ${r.status}`);
};
const ver = (x) => +(x.name.match(/v(\d+)\s*$/i) || [0, 1])[1];
export const latest = (p, kind = 'webflow') => p.sets.filter((x) => x.kind === kind && x.frames.length).sort((a, b) => ver(b) - ver(a))[0];

export function usageExcept(p, set, frame) {
  const u = {};
  for (const f of set.frames) {
    if (f === frame) continue;
    for (const l of f.layers) {
      const a = l.asset && p.assets.find((x) => x.id === l.asset);
      if (a) u[contentKey(a)] = (u[contentKey(a)] || 0) + 1;
    }
  }
  return u;
}

const finish = (f) => {
  f.layers.forEach((l) => (l.type === 'screen' || l.type === 'video') && (l.shadow = 'subtle'));
  return f;
};

// Cambia la plantilla de una imagen eligiendo contenido que no se repita en el set.
export function retemplate(p, set, idx, tid, assets) {
  const f = set.frames[idx];
  let nf = { ...f, layers: (assets || []).map((id) => ({ id: 'tmp', type: 'screen', asset: id })) };
  nf = applyTemplate(nf, tid, p, usageExcept(p, set, f), !!assets);
  nf = stripDevices(nf, p);
  nf.name = f.name.replace(/·.*$/, `· ${tid}`);
  set.frames[idx] = finish(nf);
  return set.frames[idx];
}

export function setAsset(p, set, idx, layerIdx, assetId) {
  const l = set.frames[idx].layers[layerIdx];
  const a = p.assets.find((x) => x.id === assetId);
  l.asset = assetId;
  l.type = a.kind === 'video' ? 'video' : 'screen';
  l.cropY = 0;
  l.name = a.label;
}

// Mejores capturas de un rol que no estén en uso en el set (menos vacío primero, sin footer).
export function freshAssets(p, set, role, { exclude = [], filter = () => true } = {}) {
  const used = new Set(set.frames.flatMap((f) => f.layers.map((l) => l.asset)).filter(Boolean).map((id) => contentKey(p.assets.find((a) => a.id === id) || { id })));
  return p.assets
    .filter((a) => a.role === role && !a.hidden && !(a.meta && a.meta.atEnd) && !used.has(contentKey(a)) && !exclude.includes(a.id) && filter(a))
    .sort((a, b) => (a.blank || 0) - (b.blank || 0));
}

// Agrega una imagen al final con el formato que le toca en la grilla.
export function appendFrame(p, set, tid) {
  const fmt = set.kind === 'webflow' ? gridFormats(set.frames.length + 1, set.grilla)[set.frames.length] : set.format;
  let f = newFrame(fmt, p.brand);
  const v = backgroundVariants(p);
  f.background = { ...f.background, ...v[set.frames.length % v.length] };
  f = applyTemplate(f, tid, p, usageExcept(p, set, null), false);
  f = stripDevices(f, p);
  f.name = `${String(set.frames.length + 1).padStart(2, '0')} · ${tid}`;
  set.frames.push(finish(f));
  return f;
}

export function blurPhotoBackgrounds(p) {
  let n = 0;
  for (const s of p.sets)
    for (const f of s.frames)
      if (f.background.type === 'image' && (f.background.blur || 0) < 20) {
        f.background.blur = 45;
        f.background.imageScale = Math.max(1.15, f.background.imageScale || 1);
        n++;
      }
  return n;
}

// Imagen que ocupa todo el cuadrado (foto o video), sin marco ni sombra.
export function fullBleed(p, set, idx, assetId) {
  const f = set.frames[idx];
  const a = p.assets.find((x) => x.id === assetId);
  f.layers = [{ id: `l_${Math.random().toString(36).slice(2, 9)}`, type: a.kind === 'video' ? 'video' : 'screen', name: a.label, asset: a.id, x: 0, y: 0, w: f.w, h: f.h, rotate: 0, radius: 0, shadow: 'none', device: 'none', deviceTone: 'dark', cropX: 0.5, cropY: 0.5, zoom: 1, opacity: 1, border: false }];
  f.template = null;
  return f;
}
