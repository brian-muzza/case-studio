// Generación automática de un set de imágenes a partir de las capturas del caso.
import { FORMATS, gridFormats, newFrame, uid } from './model.js';
import { applyTemplate, suggestTemplates, TEMPLATE_BY_ID } from './templates.js';

/**
 * opts: { count, kind: 'webflow'|'instagram'|'libre', grilla, format, templates?: string[], background? }
 * Para webflow, el formato de cada imagen sale de la grilla (1, 2 o 3 columnas).
 * Para instagram, todas usan `format` (el carrusel exige la misma proporción).
 */
export function buildFrames(project, opts) {
  const count = Math.max(1, Math.min(25, opts.count || 6));
  const formats = opts.kind === 'webflow' ? gridFormats(count, opts.grilla) : Array(count).fill(opts.format || 'ig-4x5');
  const usage = {};
  const usedTemplates = {};
  const frames = [];
  // Scroll grabado: en Webflow va grande en la primera fila de 1; en Instagram como slide 2.
  const video = opts.video ? pickScrollVideo(project, opts.kind === 'webflow' ? 'desktop' : 'mobile') : null;
  const videoAt = !video ? -1 : opts.kind === 'webflow' ? formats.indexOf('wf-1') : Math.min(1, formats.length - 1);
  // Animaciones puntuales (carga, mapa, 3D, Lottie…): hasta 2 en Webflow y 1 en Instagram, repartidas.
  const clipSlots = {};
  if (opts.video) {
    const clips = pickClips(project, opts.kind === 'webflow' ? 2 : 1);
    const free = formats.map((f, i) => i).filter((i) => i !== videoAt && i > 1 && (opts.kind !== 'webflow' || formats[i] !== 'wf-3'));
    const targets = clips.length === 1 ? [free[Math.floor(free.length * 0.35)]] : [free[Math.floor(free.length * 0.2)], free[Math.floor(free.length * 0.7)]];
    clips.forEach((c, k) => targets[k] !== undefined && (clipSlots[targets[k]] = c));
  }
  formats.forEach((fmt, i) => {
    if (clipSlots[i]) {
      const clip = clipSlots[i];
      let cf = newFrame(fmt, project.brand);
      if (opts.bgMode === 'variado') {
        const v = backgroundVariants(project);
        cf.background = { ...cf.background, ...v[i % v.length] };
      } else if (opts.background) cf.background = { ...cf.background, ...opts.background };
      cf.layers = [{ id: 'tmp', type: 'video', asset: clip.id }];
      cf = applyTemplate(cf, 'hero-float', project, usage, true);
      cf.layers.forEach((l) => (l.shadow = opts.shadow || 'subtle'));
      cf.name = `${String(i + 1).padStart(2, '0')} · ${clip.meta.clip === 'carga' ? 'Pantalla de carga' : `Animación (${clip.meta.kind})`} (video)`;
      frames.push(cf);
      return;
    }
    if (i === videoAt) {
      let vf = newFrame(fmt, project.brand);
      vf.background = { ...vf.background, ...(opts.bgMode === 'variado' ? { type: 'gradient', color: mix(project.brand.color || '#1E1E24', '#FFFFFF', 0.15), color2: mix(project.brand.color || '#1E1E24', '#000000', 0.55), angle: 165 } : opts.background || {}) };
      vf.layers = [{ id: 'tmp', type: 'video', asset: video.id }];
      vf = applyTemplate(vf, opts.kind === 'webflow' ? 'hero-float' : 'tramo', project, usage, true);
      vf.layers.forEach((l) => {
        l.shadow = opts.shadow || 'subtle';
        if (opts.kind !== 'webflow') l.radius = Math.round(l.w * 0.055);
      });
      vf.name = `${String(i + 1).padStart(2, '0')} · Scroll ${video.meta && video.meta.viewport === 'mobile' ? 'mobile' : 'de la home'} (video)`;
      frames.push(vf);
      return;
    }
    let tid = opts.templates && opts.templates[i % opts.templates.length];
    if (!tid || !TEMPLATE_BY_ID[tid]) {
      // Orden propio de cada caso (mezcla estable por slug), así no todos los casos arrancan igual.
      const seq = seededShuffle(suggestTemplates(fmt, count, project.assets, { full: opts.full, devices: opts.devices }), `${project.slug}|${opts.kind}|${fmt}`);
      // La menos usada del set (variedad), respetando ese orden.
      tid = [...seq].sort((a, b) => (usedTemplates[a] || 0) - (usedTemplates[b] || 0) || seq.indexOf(a) - seq.indexOf(b))[0];
    }
    usedTemplates[tid] = (usedTemplates[tid] || 0) + 1;
    let frame = newFrame(fmt, project.brand);
    if (opts.bgMode === 'variado') {
      const v = backgroundVariants(project);
      frame.background = { ...frame.background, ...v[i % v.length] };
    } else if (opts.background) frame.background = { ...frame.background, ...opts.background };
    frame = applyTemplate(frame, tid, project, usage, false);
    if (opts.devices === false) frame = stripDevices(frame, project);
    if (opts.shadow) frame.layers.forEach((l) => (l.type === 'screen' || l.type === 'video') && (l.shadow = opts.shadow));
    frame.name = `${String(i + 1).padStart(2, '0')} · ${TEMPLATE_BY_ID[tid].name}`;
    frames.push(frame);
  });
  return frames;
}

export function generateSet(project, opts) {
  const set = {
    id: uid('s'),
    name: opts.name || (opts.kind === 'instagram' ? 'Instagram' : 'Webflow'),
    kind: opts.kind || 'webflow',
    grilla: opts.kind === 'webflow' ? opts.grilla || '2,1,2,3' : '',
    format: opts.format || (opts.kind === 'instagram' ? 'ig-4x5' : 'wf-2'),
    frames: buildFrames(project, opts),
  };
  return set;
}

// Cambia el formato de un frame. `mode`: 'template' re-aplica la plantilla, 'scale' escala las capas.
export function changeFormat(frame, formatKey, project, mode = 'template') {
  const f = FORMATS[formatKey];
  if (!f) return frame;
  if (mode === 'template' && frame.template) {
    return applyTemplate({ ...frame, format: formatKey, w: f.w, h: f.h }, frame.template, project, {}, true);
  }
  const sx = f.w / frame.w;
  const sy = f.h / frame.h;
  const s = Math.min(sx, sy);
  const dx = (f.w - frame.w * s) / 2;
  const dy = (f.h - frame.h * s) / 2;
  return {
    ...frame,
    format: formatKey,
    w: f.w,
    h: f.h,
    layers: frame.layers.map((l) => ({
      ...l,
      x: Math.round(l.x * s + dx),
      y: Math.round(l.y * s + dy),
      w: Math.round(l.w * s),
      h: Math.round(l.h * s),
      ...(l.fontSize ? { fontSize: Math.round(l.fontSize * s) } : {}),
      ...(l.radius ? { radius: Math.round(l.radius * s) } : {}),
    })),
  };
}

// ---- Fondos variados ----
function hexToRgb(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
}
// Paleta de fondos que rota entre imágenes: claro, tinte de marca, marca, foto, degradé, oscuro.
export function backgroundVariants(project) {
  const c = project.brand.color || '#1E1E24';
  const photos = project.assets.filter((a) => a.role === 'photo' && !a.hidden && a.source === 'capture');
  const none = { color: '#000000', opacity: 0 };
  const list = [
    { type: 'color', color: '#EEEDE8', overlay: none, grain: 0 },
    { type: 'color', color: mix(c, '#FFFFFF', 0.86), overlay: none, grain: 0 },
    photos[0] ? { type: 'image', image: photos[0].id, blur: 45, distort: 0, imageScale: 1.15, brightness: 1, saturation: 1.05, overlay: { color: '#000000', opacity: 0.18 }, grain: 0 } : null,
    { type: 'color', color: c, overlay: none, grain: 0 },
    { type: 'color', color: '#F6F6F4', overlay: none, grain: 0 },
    photos[1] || photos[0] ? { type: 'image', image: (photos[1] || photos[0]).id, blur: 150, distort: 0, imageScale: 1.4, brightness: 1, saturation: 1.25, overlay: { color: c, opacity: 0.18 }, grain: 22 } : null,
    { type: 'gradient', color: mix(c, '#FFFFFF', 0.15), color2: mix(c, '#000000', 0.55), angle: 165, overlay: none, grain: 0 },
    { type: 'color', color: mix(c, '#000000', 0.62), overlay: none, grain: 0 },
  ];
  return list.filter(Boolean);
}

// ---- Sin dispositivos: convierte navegador/celular/laptop en pantallas planas ----
export function stripDevices(frame, project) {
  const m = Math.min(frame.w, frame.h);
  return {
    ...frame,
    layers: frame.layers.map((l) => {
      if ((l.type !== 'screen' && l.type !== 'video') || !l.device || l.device === 'none') return l;
      const a = project.assets.find((x) => x.id === l.asset);
      const ratio = a && a.w ? a.h / a.w : l.device === 'phone' ? 2.164 : 0.625;
      const out = { ...l, device: 'none' };
      if (l.device === 'browser') {
        const bar = Math.max(10, Math.round(l.w * 0.032));
        out.y = Math.round(l.y + bar / 2);
        out.h = Math.round(l.h - bar);
        out.radius = Math.max(6, Math.round(m * 0.012));
      } else {
        const r = l.device === 'phone' ? Math.min(ratio, 2.3) : Math.min(ratio, 0.75);
        const w = l.device === 'phone' ? l.w * 0.94 : l.w;
        const h = w * r;
        out.x = Math.round(l.x + (l.w - w) / 2);
        out.y = Math.round(l.y + (l.h - h) / 2);
        out.w = Math.round(w);
        out.h = Math.round(h);
        out.radius = l.device === 'phone' ? Math.round(w * 0.07) : Math.max(6, Math.round(m * 0.012));
      }
      return out;
    }),
  };
}

// Elige la grabación de scroll más reciente (prioriza la home y las grabadas cuadro por cuadro).
export function pickScrollVideo(project, viewport) {
  const vids = project.assets.filter((a) => a.kind === 'video' && !a.hidden && a.meta && a.meta.scroll && a.meta.viewport === viewport);
  if (!vids.length) return null;
  const score = (a) => {
    let path = '/';
    try {
      path = new URL(a.meta.url).pathname.replace(/\/+$/, '') || '/';
    } catch {}
    return (path === '/' ? 0 : 10) + (a.file.includes('/rec-') ? 0 : 5);
  };
  return [...vids].sort((a, b) => score(a) - score(b) || String(b.addedAt).localeCompare(String(a.addedAt)))[0];
}

// Animaciones grabadas con criterio: primero la carga (si se mueve bastante), después lo más vistoso.
const CLIP_SCORE = { '3d': 3.5, mapa: 3, canvas: 3, lottie: 3, video: 2, loop: 1.2 };
export function pickClips(project, max) {
  const clips = project.assets.filter((a) => a.kind === 'video' && !a.hidden && a.meta && a.meta.clip);
  const score = (a) => (a.meta.clip === 'carga' ? (a.meta.motion >= 2.5 ? 10 : 2) : CLIP_SCORE[a.meta.kind] || 1) * Math.min(3, 1 + (a.meta.motion || 0) / 10);
  return clips.sort((a, b) => score(b) - score(a)).slice(0, max);
}

// Mezcla determinística: el mismo texto da siempre el mismo orden.
export function seededShuffle(list, seedText) {
  let h = 2166136261;
  for (const ch of String(seedText)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rand = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...new Set(list)];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
