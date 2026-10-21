// Texto alternativo descriptivo por imagen, a partir de lo que muestra (páginas, mobile, video).
import * as F from './fixlib.mjs';

const pageName = (url, home) => {
  if (!url) return 'el sitio';
  const path = new URL(url).pathname.replace(/\/+$/, '').replace(/^\/(es|en|pt|pt-br)(?=\/|$)/, '');
  if (!path || url.replace(/\/+$/, '') === (home || '').replace(/\/+$/, '')) return 'la home';
  const last = decodeURIComponent(path.split('/').filter(Boolean).pop()).replace(/[-_]+/g, ' ');
  return `la página ${last.charAt(0).toUpperCase()}${last.slice(1)}`;
};
const list = (xs) => [...new Set(xs)].reduce((s, x, i, a) => s + (i === 0 ? '' : i === a.length - 1 ? ' y ' : ', ') + x, '');

export function altFor(p, frame) {
  return altRaw(p, frame).replace(/\bde el /g, 'del ').replace(/\ba el /g, 'al ');
}
function altRaw(p, frame) {
  const name = p.name.split(' · ')[0].replace(/\s*\(.*\)$/, '');
  const assets = frame.layers.map((l) => p.assets.find((a) => a.id === l.asset)).filter(Boolean);
  if (!assets.length) return `Imagen del sitio de ${name}`;
  const pages = list(assets.map((a) => pageName(a.meta && a.meta.url, p.url)));
  const v = assets.find((a) => a.kind === 'video');
  if (v) {
    if (v.meta && v.meta.scroll) return `Recorrido animado por ${pageName(v.meta.url, p.url)} de ${name} en ${v.meta.viewport === 'mobile' ? 'mobile' : 'desktop'}`;
    if (v.meta && v.meta.clip === 'carga') return `Animación de carga del sitio de ${name}`;
    return `Animación de una sección de ${pageName(v.meta && v.meta.url, p.url)} de ${name}`;
  }
  const r = assets[0].role;
  if (r === 'photo') return `Fotografía del sitio de ${name}`;
  if (r === 'component') return `Detalle de ${pages} de ${name}`;
  if (r === 'tramo') return `${assets.length > 1 ? 'Tramos' : 'Tramo'} de ${pages} de ${name} en desktop`;
  if (r === 'tramo-mobile' || r === 'mobile' || r === 'mobile-page') return `${assets.length > 1 ? 'Pantallas' : 'Pantalla'} mobile de ${pages} de ${name}`;
  return `${assets.length > 1 ? 'Pantallas' : 'Pantalla'} de ${pages} de ${name} en desktop`;
}

if (process.argv[2]) {
  for (const slug of process.argv.slice(2)) {
    const p = await F.get(slug);
    let n = 0;
    for (const s of p.sets) for (const f of s.frames) if (!f.alt) (f.alt = altFor(p, f)), n++;
    await F.put(slug, p);
    const w = F.latest(p, 'webflow');
    console.log(`${slug}: ${n} textos · ej.: «${w.frames[0].alt}» / «${w.frames[Math.min(2, w.frames.length - 1)].alt}»`);
  }
}
