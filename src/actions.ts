// Acciones de edición reutilizadas por la UI y los atajos de teclado.
import { FORMATS, gridFormats, newFrame, uid } from '../shared/model.js';
import { applyTemplate, contentKey, TEMPLATE_BY_ID } from '../shared/templates.js';
import { changeFormat, generateSet, buildFrames } from '../shared/generate.js';
import { currentSet, findFrame, getState, setState, update, updateFrame } from './store';
import type { Background, Frame, FrameSet, Layer, Project, ScreenLayer } from './types';

const setOf = (p: Project, setId: string) => p.sets.find((s) => s.id === setId)!;

export function addFrame(setId: string, templateId: string | null, format?: string, at?: number) {
  const id = uid('f');
  update((p) => {
    const set = setOf(p, setId);
    const pos = at ?? set.frames.length;
    const fmt = format || (set.kind === 'webflow' ? gridFormats(pos + 1, set.grilla)[pos] : set.format);
    const prev = set.frames[pos - 1] || set.frames[0];
    let f = newFrame(fmt, p.brand) as Frame;
    f.id = id;
    if (prev) f.background = structuredClone(prev.background);
    if (templateId) f = applyTemplate(f, templateId, p, usageOf(set)) as Frame;
    f.name = templateId ? TEMPLATE_BY_ID[templateId].name : 'Imagen vacía';
    set.frames.splice(pos, 0, f);
  });
  setState({ frameId: id, layerId: null });
}

function usageOf(set: FrameSet) {
  const p = getState().project!;
  const u: Record<string, number> = {};
  set.frames.forEach((f) =>
    f.layers.forEach((l) => {
      const a = 'asset' in l && l.asset ? p.assets.find((x) => x.id === l.asset) : null;
      if (a) u[contentKey(a)] = (u[contentKey(a)] || 0) + 1;
    }),
  );
  return u;
}

export function duplicateFrame(frameId: string) {
  const id = uid('f');
  update((p) => {
    for (const s of p.sets) {
      const i = s.frames.findIndex((f) => f.id === frameId);
      if (i < 0) continue;
      const c = structuredClone(s.frames[i]);
      c.id = id;
      c.name = `${c.name} (copia)`;
      c.layers.forEach((l) => (l.id = uid('l')));
      s.frames.splice(i + 1, 0, c);
    }
  });
  setState({ frameId: id, layerId: null });
}

export function deleteFrame(frameId: string) {
  update((p) => {
    for (const s of p.sets) s.frames = s.frames.filter((f) => f.id !== frameId);
  });
  setState({ frameId: null, layerId: null });
}

export function moveFrame(frameId: string, to: number) {
  update((p) => {
    for (const s of p.sets) {
      const i = s.frames.findIndex((f) => f.id === frameId);
      if (i < 0) continue;
      const [f] = s.frames.splice(i, 1);
      s.frames.splice(Math.max(0, Math.min(s.frames.length, to)), 0, f);
    }
  });
}

export function setTemplate(frameId: string, templateId: string, keepAssets = true) {
  update((p) => {
    for (const s of p.sets) {
      const i = s.frames.findIndex((f) => f.id === frameId);
      if (i >= 0) s.frames[i] = applyTemplate(s.frames[i], templateId, p, usageOf(s), keepAssets) as Frame;
    }
  });
  setState({ layerId: null });
}

// Cambia las capturas de la plantilla por otras (variedad), manteniendo el layout.
export function shuffleAssets(frameId: string) {
  update((p) => {
    for (const s of p.sets) {
      const i = s.frames.findIndex((f) => f.id === frameId);
      if (i < 0 || !s.frames[i].template) continue;
      const u = usageOf(s);
      s.frames[i].layers.forEach((l) => { const a = "asset" in l && l.asset ? p.assets.find((x) => x.id === l.asset) : null; if (a) u[contentKey(a)] = (u[contentKey(a)] || 0) + 5; });
      const old = s.frames[i];
      const fresh = applyTemplate(old, old.template!, p, u, false) as Frame;
      // Conserva posiciones y estilos editados; solo cambia qué captura va en cada pantalla.
      const freshScreens = fresh.layers.filter((l) => l.type === 'screen' || l.type === 'video');
      let k = 0;
      old.layers.forEach((l) => {
        if ((l.type === 'screen' || l.type === 'video') && freshScreens[k]) (l as ScreenLayer).asset = (freshScreens[k++] as ScreenLayer).asset;
      });
    }
  });
}

export function setFrameFormat(frameId: string, format: string, mode: 'template' | 'scale') {
  update((p) => {
    for (const s of p.sets) {
      const i = s.frames.findIndex((f) => f.id === frameId);
      if (i >= 0) s.frames[i] = changeFormat(s.frames[i], format, p, mode) as Frame;
    }
  });
}

export function fitFormatsToGrid(setId: string) {
  update((p) => {
    const s = setOf(p, setId);
    const fmts = s.kind === 'webflow' ? gridFormats(s.frames.length, s.grilla) : s.frames.map(() => s.format);
    s.frames = s.frames.map((f, i) => (f.format === fmts[i] ? f : (changeFormat(f, fmts[i], p, 'template') as Frame)));
  });
}

export function applyBackgroundToSet(frameId: string) {
  update((p) => {
    const src = findFrame(p, frameId);
    if (!src) return;
    for (const s of p.sets) if (s.frames.some((f) => f.id === frameId)) s.frames.forEach((f) => (f.background = structuredClone(src.background)));
  });
}

export function patchBackground(frameId: string, patch: Partial<Background>, key?: string) {
  updateFrame(frameId, (f) => Object.assign(f.background, patch), key);
}

export function applyLayerStyleToSet(frameId: string, layerId: string) {
  update((p) => {
    const src = findFrame(p, frameId)?.layers.find((l) => l.id === layerId) as ScreenLayer | undefined;
    if (!src) return;
    for (const s of p.sets) {
      if (!s.frames.some((f) => f.id === frameId)) continue;
      for (const f of s.frames)
        for (const l of f.layers)
          if ((l.type === 'screen' || l.type === 'video') && (l as ScreenLayer).device === src.device) {
            Object.assign(l, { shadow: src.shadow, radius: src.radius, border: src.border, deviceTone: src.deviceTone });
          }
    }
  });
}

export function deleteLayer(frameId: string, layerId: string) {
  updateFrame(frameId, (f) => (f.layers = f.layers.filter((l) => l.id !== layerId)));
  setState({ layerId: null });
}

export function duplicateLayer(frameId: string, layerId: string) {
  const id = uid('l');
  updateFrame(frameId, (f) => {
    const i = f.layers.findIndex((l) => l.id === layerId);
    if (i < 0) return;
    const c = { ...structuredClone(f.layers[i]), id, x: f.layers[i].x + 24, y: f.layers[i].y + 24 };
    f.layers.splice(i + 1, 0, c);
  });
  setState({ layerId: id });
}

export function zOrder(frameId: string, layerId: string, dir: 1 | -1 | 'top' | 'bottom') {
  updateFrame(frameId, (f) => {
    const i = f.layers.findIndex((l) => l.id === layerId);
    if (i < 0) return;
    const [l] = f.layers.splice(i, 1);
    const to = dir === 'top' ? f.layers.length : dir === 'bottom' ? 0 : Math.max(0, Math.min(f.layers.length, i + dir));
    f.layers.splice(to, 0, l);
  });
}

export function addLayer(frameId: string, type: 'screen' | 'text' | 'rect') {
  const id = uid('l');
  updateFrame(frameId, (f, p) => {
    const m = Math.min(f.w, f.h);
    let l: Layer;
    if (type === 'text') {
      l = { id, type: 'text', name: 'Texto', text: p.name, x: f.w * 0.08, y: f.h * 0.08, w: f.w * 0.84, h: m * 0.2, rotate: 0, opacity: 1, fontSize: Math.round(m * 0.08), fontWeight: 500, fontFamily: p.brand.font || 'Inter', color: '#111111', align: 'left', lineHeight: 1.05, letterSpacing: -0.02 };
    } else if (type === 'rect') {
      l = { id, type: 'rect', name: 'Bloque', x: f.w * 0.3, y: f.h * 0.3, w: f.w * 0.4, h: f.h * 0.4, rotate: 0, opacity: 1, fill: p.brand.color, radius: Math.round(m * 0.02), shadow: 'none' };
    } else {
      const a = p.assets.find((x) => !x.hidden && (x.role === 'hero' || x.role === 'section')) || p.assets[0];
      const w = f.w * 0.6;
      const h = w * Math.min(a ? a.h / a.w : 0.6, 0.66);
      l = { id, type: 'screen', name: a?.label || 'Pantalla', asset: a?.id || null, x: (f.w - w) / 2, y: (f.h - h) / 2, w, h, rotate: 0, opacity: 1, radius: Math.round(m * 0.012), shadow: 'medium', device: 'none', deviceTone: 'dark', cropX: 0.5, cropY: 0, zoom: 1, border: false };
    }
    l.x = Math.round(l.x);
    l.y = Math.round(l.y);
    l.w = Math.round(l.w);
    l.h = Math.round(l.h);
    f.layers.push(l);
  });
  setState({ layerId: id });
}

export function alignLayer(frameId: string, layerId: string, how: 'cx' | 'cy' | 'left' | 'right' | 'top' | 'bottom') {
  updateFrame(frameId, (f) => {
    const l = f.layers.find((x) => x.id === layerId);
    if (!l) return;
    if (how === 'cx') l.x = Math.round((f.w - l.w) / 2);
    if (how === 'cy') l.y = Math.round((f.h - l.h) / 2);
    if (how === 'left') l.x = 0;
    if (how === 'right') l.x = f.w - l.w;
    if (how === 'top') l.y = 0;
    if (how === 'bottom') l.y = f.h - l.h;
  });
}

export function createSet(opts: { name: string; kind: 'webflow' | 'instagram' | 'libre'; count: number; grilla?: string; format?: string; background?: Partial<Background>; bgMode?: string; devices?: boolean; shadow?: string; video?: boolean; replaceSetId?: string; templates?: string[] }) {
  let newId = '';
  update((p) => {
    if (opts.replaceSetId) {
      const s = setOf(p, opts.replaceSetId);
      s.frames = buildFrames(p, { ...opts, kind: s.kind === 'libre' ? 'instagram' : s.kind, grilla: opts.grilla ?? s.grilla, format: opts.format || s.format }) as Frame[];
      if (opts.grilla !== undefined) s.grilla = opts.grilla;
      if (opts.format) s.format = opts.format;
      newId = s.id;
    } else {
      const s = generateSet(p, { ...opts, kind: opts.kind === 'libre' ? 'instagram' : opts.kind }) as FrameSet;
      s.kind = opts.kind;
      p.sets.push(s);
      newId = s.id;
    }
  });
  const set = getState().project!.sets.find((s) => s.id === newId)!;
  setState({ setId: newId, frameId: set.frames[0]?.id || null, layerId: null, view: 'grid' });
}

export function deleteSet(setId: string) {
  update((p) => {
    p.sets = p.sets.filter((s) => s.id !== setId);
  });
  setState({ setId: getState().project!.sets[0]?.id || null, frameId: null, layerId: null });
}

export function duplicateSetAs(setId: string, kind: 'webflow' | 'instagram', format?: string, grilla?: string) {
  const id = uid('s');
  update((p) => {
    const src = setOf(p, setId);
    const fmts = kind === 'webflow' ? gridFormats(src.frames.length, grilla || '2,1,2,3') : src.frames.map(() => format || 'ig-4x5');
    p.sets.push({
      id,
      name: kind === 'instagram' ? `${src.name} · Instagram` : `${src.name} · Webflow`,
      kind,
      grilla: kind === 'webflow' ? grilla || '2,1,2,3' : '',
      format: format || (kind === 'instagram' ? 'ig-4x5' : 'wf-2'),
      frames: src.frames.map((f, i) => {
        const c = structuredClone(f);
        c.id = uid('f');
        c.layers.forEach((l) => (l.id = uid('l')));
        return changeFormat(c, fmts[i], p, 'template') as Frame;
      }),
    });
  });
  setState({ setId: id, frameId: null, layerId: null });
}

export const formatLabel = (k: string) => (FORMATS as Record<string, { short: string }>)[k]?.short || k;
export const activeSet = () => currentSet();
