// Estado global mínimo con deshacer/rehacer, autoguardado y recarga en vivo (SSE).
import { useSyncExternalStore } from 'react';
import { api } from './api';
import type { Frame, FrameSet, Layer, Project } from './types';

export type View = 'grid' | 'carousel' | 'frame';

export interface State {
  slug: string | null;
  project: Project | null;
  past: Project[];
  future: Project[];
  setId: string | null;
  frameId: string | null;
  layerId: string | null;
  view: View;
  saving: 'idle' | 'pending' | 'saving' | 'error';
  logs: { t: number; msg: string }[];
  busy: string | null;
  toast: string | null;
}

let state: State = {
  slug: null,
  project: null,
  past: [],
  future: [],
  setId: null,
  frameId: null,
  layerId: null,
  view: 'grid',
  saving: 'idle',
  logs: [],
  busy: null,
  toast: null,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  emit();
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

// ---------- guardado ----------
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let savePromise: Promise<void> = Promise.resolve();
function scheduleSave() {
  setState({ saving: 'pending' });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave(), 450);
}
export async function flushSave() {
  clearTimeout(saveTimer);
  const { slug, project, saving } = state;
  if (!slug || !project || saving === 'idle') return savePromise;
  savePromise = savePromise.then(async () => {
    setState({ saving: 'saving' });
    try {
      await api.save(slug, state.project!);
      setState({ saving: 'idle' });
    } catch (e) {
      setState({ saving: 'error', toast: `No se pudo guardar: ${(e as Error).message}` });
    }
  });
  return savePromise;
}

// ---------- mutaciones ----------
let lastKey = '';
let lastKeyAt = 0;
/** Muta una copia del proyecto. `key` agrupa cambios seguidos (arrastre) en un solo paso de deshacer. */
export function update(fn: (p: Project) => void | Project, key?: string) {
  if (!state.project) return;
  const draft = structuredClone(state.project);
  const out = (fn(draft) as Project | undefined) || draft;
  const now = Date.now();
  const coalesce = key && key === lastKey && now - lastKeyAt < 1200;
  lastKey = key || '';
  lastKeyAt = now;
  setState({
    project: out,
    past: coalesce ? state.past : [...state.past.slice(-80), state.project],
    future: [],
  });
  scheduleSave();
}

export function undo() {
  const { past, project, future } = state;
  if (!past.length || !project) return;
  setState({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future] });
  lastKey = '';
  scheduleSave();
}
export function redo() {
  const { past, project, future } = state;
  if (!future.length || !project) return;
  setState({ project: future[0], past: [...past, project], future: future.slice(1) });
  lastKey = '';
  scheduleSave();
}

export function currentSet(s: State = state): FrameSet | undefined {
  return s.project?.sets.find((x) => x.id === s.setId) || s.project?.sets[0];
}
export function currentFrame(s: State = state): Frame | undefined {
  return currentSet(s)?.frames.find((f) => f.id === s.frameId);
}
export function currentLayer(s: State = state): Layer | undefined {
  return currentFrame(s)?.layers.find((l) => l.id === s.layerId);
}

export function findFrame(p: Project, frameId: string) {
  for (const s of p.sets) {
    const f = s.frames.find((x) => x.id === frameId);
    if (f) return f;
  }
  return undefined;
}

export function updateFrame(frameId: string, fn: (f: Frame, p: Project) => void, key?: string) {
  update((p) => {
    const f = findFrame(p, frameId);
    if (f) fn(f, p);
  }, key);
}

export function updateLayer(frameId: string, layerId: string, patch: Partial<Layer> | ((l: Layer) => void), key?: string) {
  updateFrame(
    frameId,
    (f) => {
      const l = f.layers.find((x) => x.id === layerId);
      if (!l) return;
      if (typeof patch === 'function') patch(l);
      else Object.assign(l, patch);
    },
    key,
  );
}

export function log(msg: string) {
  setState((s) => ({ logs: [...s.logs.slice(-40), { t: Date.now(), msg }] }));
}
export function toast(msg: string) {
  setState({ toast: msg });
  setTimeout(() => state.toast === msg && setState({ toast: null }), 4000);
}

// ---------- carga y eventos ----------
// Última versión de un tipo de set (el número más alto en el nombre: v3 > v2 > sin número).
export function latestSet(p: Project, kind: FrameSet['kind']) {
  const ver = (s: FrameSet) => {
    const m = s.name.match(/v(\d+)\s*$/i);
    return m ? parseInt(m[1], 10) : 1;
  };
  return p.sets
    .filter((s) => s.kind === kind && s.frames.length)
    .sort((a, b) => ver(b) - ver(a) || p.sets.indexOf(b) - p.sets.indexOf(a))[0];
}

let es: EventSource | null = null;
function listen(slug: string) {
  es?.close();
  es = new EventSource(`/api/events/${slug}`);
  es.addEventListener('changed', async () => {
    if (state.slug !== slug) return;
    const p = await api.project(slug);
    // Cambio hecho fuera del editor (chat/CLI): lo tomamos y se puede deshacer.
    setState((s) => ({
      project: p,
      past: s.project ? [...s.past, s.project] : s.past,
      future: [],
      setId: p.sets.some((x) => x.id === s.setId) ? s.setId : p.sets[0]?.id || null,
      frameId: p.sets.some((x) => x.frames.some((f) => f.id === s.frameId)) ? s.frameId : null,
    }));
    toast('Actualizado desde fuera del editor');
  });
  es.addEventListener('log', (e) => {
    const d = JSON.parse((e as MessageEvent).data);
    log(d.msg);
  });
}

export async function openProject(slug: string) {
  await flushSave();
  const project = await api.project(slug);
  // Abre la última versión (primero Webflow, si no Instagram).
  const first = latestSet(project, 'webflow') || latestSet(project, 'instagram') || project.sets[0];
  setState({ slug, project, past: [], future: [], setId: first?.id || null, frameId: first?.frames[0]?.id || null, layerId: null, view: 'grid', saving: 'idle' });
  localStorage.setItem('cs:lastSlug', slug);
  history.replaceState(null, '', `?caso=${slug}`);
  listen(slug);
}

/** Para el tablero: hace activo un proyecto ya cargado sin tocar la URL ni la vista. */
export async function activateProject(project: Project, setId: string, frameId: string | null) {
  if (state.slug === project.slug) {
    setState({ setId, frameId, layerId: null });
    return;
  }
  await flushSave();
  setState({ slug: project.slug, project, past: [], future: [], setId, frameId, layerId: null, saving: 'idle' });
  listen(project.slug);
}
