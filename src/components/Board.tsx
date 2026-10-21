// Tablero «Previsualizar»: todos los casos uno al lado del otro con su última versión.
// Edición mínima: clic en una imagen, seleccionar una pantalla y ajustar posición y tamaño.
import { useEffect, useMemo, useRef, useState } from 'react';
import { WEBFLOW_GALLERY, gridRows } from '../../shared/model.js';
import { api } from '../api';
import { FrameView } from '../FrameView';
import { InteractiveFrame } from './InteractiveFrame';
import { activateProject, flushSave, getState, latestSet, redo, setState, undo, update, updateLayer, useStore } from '../store';
import { deleteLayer } from '../actions';
import { Num } from './ui';
import { Comments, openComments } from './Comments';
import type { CaseInfo, Frame, FrameSet, Project } from '../types';

export const STATUSES: { v: string; l: string; c: string }[] = [
  { v: 'pendiente', l: 'Pendiente', c: '#7d7d88' },
  { v: 'en-revision', l: 'En revisión', c: '#f5b301' },
  { v: 'ajustes', l: 'Ajustes', c: '#ff7a3d' },
  { v: 'aprobado', l: 'Aprobado', c: '#2fbf71' },
];
const statusOf = (v?: string) => STATUSES.find((s) => s.v === v) || STATUSES[0];

type Kind = 'webflow' | 'instagram';
type BatchInfo = Record<string, { state: string; at: string; msg?: string }>;

const COL_W = 440; // ancho de la galería en el tablero

function Cell({ project, set, frame, w, h, active }: { project: Project; set: FrameSet; frame: Frame; w: number; h: number; active: boolean }) {
  const scale = Math.max(w / frame.w, h / frame.h);
  const off = { x: (w / scale - frame.w) / 2, y: (h / scale - frame.h) / 2 };
  return (
    <div
      className={`cell ${active ? 'active' : ''}`}
      style={{ width: w, height: h }}
      onPointerDownCapture={() => {
        if (!active) activateProject(project, set.id, frame.id);
      }}
    >
      {openComments(frame) > 0 && <span className="cbadge" title="Comentarios abiertos">💬 {openComments(frame)}</span>}
      {active ? (
        <InteractiveFrame frame={frame} project={project} scale={scale} offset={off} box={{ w, h }} interactive playVideos />
      ) : (
        <div style={{ transform: `translate(${off.x * scale}px, ${off.y * scale}px) scale(${scale})`, transformOrigin: '0 0' }}>
          <FrameView frame={frame} project={project} displayScale={scale} />
        </div>
      )}
    </div>
  );
}

function SetPreview({ project, set, activeFrameId }: { project: Project; set: FrameSet; activeFrameId: string | null }) {
  if (set.kind === 'webflow') {
    const G = WEBFLOW_GALLERY;
    const z = COL_W / G.width;
    return (
      <div className="wf-gallery" style={{ width: COL_W, gap: G.gap * z }}>
        {gridRows(set.frames, set.grilla).map((row: { cols: number; frames: Frame[] }, ri: number) => {
          const [cw, ch] = (G.cells as unknown as Record<number, [number, number]>)[row.cols];
          return (
            <div key={ri} className="wf-row" style={{ gap: G.gap * z }}>
              {row.frames.map((f) => (
                <Cell key={f.id} project={project} set={set} frame={f} w={cw * z} h={ch * z} active={activeFrameId === f.id} />
              ))}
            </div>
          );
        })}
      </div>
    );
  }
  const sw = (COL_W - 8) / 2;
  return (
    <div className="board-ig" style={{ width: COL_W }}>
      {set.frames.map((f) => (
        <Cell key={f.id} project={project} set={set} frame={f} w={sw} h={(sw * f.h) / f.w} active={activeFrameId === f.id} />
      ))}
    </div>
  );
}

function MiniBar() {
  const project = useStore((s) => s.project);
  const frameId = useStore((s) => s.frameId);
  const layerId = useStore((s) => s.layerId);
  const [showComments, setShowComments] = useState(false);
  if (!project || !frameId) return null;
  const frame = project.sets.flatMap((s) => s.frames).find((f) => f.id === frameId);
  const layer = frame?.layers.find((l) => l.id === layerId);
  if (!frame) return null;
  const n = openComments(frame);
  return (
    <div className="minibar-wrap">
    {showComments && (
      <div className="minibar-comments">
        <Comments frame={frame} />
      </div>
    )}
    <div className="minibar">
      <button className={`btn sm ${showComments || n ? 'primary' : ''}`} onClick={() => setShowComments(!showComments)} title="Comentarios de esta imagen">
        💬 {n || ''}
      </button>
      <span className="mb-name" title={frame.name}>
        <b>{project.name}</b> · {frame.name.replace(/^\d+\s*·\s*/, '')}
      </span>
      {layer ? (
        <>
          <Num value={layer.x} onChange={(v) => updateLayer(frame.id, layer.id, { x: v })} suffix="X" w={78} />
          <Num value={layer.y} onChange={(v) => updateLayer(frame.id, layer.id, { y: v })} suffix="Y" w={78} />
          <Num value={layer.w} onChange={(v) => updateLayer(frame.id, layer.id, { w: Math.max(8, v) })} suffix="Ancho" w={96} />
          <Num value={layer.h} onChange={(v) => updateLayer(frame.id, layer.id, { h: Math.max(8, v) })} suffix="Alto" w={90} />
          <button
            className="btn sm"
            title="Mantiene la proporción y ajusta el alto al ancho"
            onClick={() => {
              const a = project.assets.find((x) => 'asset' in layer && x.id === layer.asset);
              if (a) updateLayer(frame.id, layer.id, { h: Math.round((layer.w * a.h) / a.w) });
            }}
          >
            Alto proporcional
          </button>
          <button className="btn sm danger" onClick={() => deleteLayer(frame.id, layer.id)}>
            Quitar
          </button>
        </>
      ) : (
        <span className="muted small">Hacé clic en una pantalla para moverla o cambiar su tamaño · doble clic para recortar</span>
      )}
      <a className="btn sm" href={`/?caso=${project.slug}`} onClick={() => flushSave()}>
        Abrir en el editor
      </a>
    </div>
    </div>
  );
}

export function Board() {
  const [cases, setCases] = useState<CaseInfo[]>([]);
  const [projects, setProjects] = useState<Record<string, Project>>({});
  const [batch, setBatch] = useState<BatchInfo>({});
  const [kind, setKind] = useState<Kind>(() => (localStorage.getItem('cs:boardKind') as Kind) || 'webflow');
  const [filter, setFilter] = useState<string>('todos');
  const [focus, setFocus] = useState<string | null>(null);
  const active = useStore((s) => s.project);
  const activeFrame = useStore((s) => s.frameId);
  const scroller = useRef<HTMLDivElement>(null);

  // Lista de casos y estado del armado masivo (se refresca solo mientras corre).
  const seenBatch = useRef<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [{ cases }, cfg] = await Promise.all([api.cases(), fetch('/api/config').then((r) => r.json())]);
      if (!alive) return;
      setCases(cases);
      const b: BatchInfo = cfg.batch || {};
      setBatch(b);
      for (const c of cases) {
        if (!c.hasStudio || getState().slug === c.slug) continue;
        const stamp = b[c.slug] ? `${b[c.slug].state}|${b[c.slug].at}` : 'none';
        if (projectsRef.current[c.slug] && seenBatch.current[c.slug] === stamp) continue;
        seenBatch.current[c.slug] = stamp;
        api.project(c.slug).then((p) => alive && setProjects((m) => ({ ...m, [c.slug]: p })));
      }
    };
    load();
    const t = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  // El proyecto activo vive en el store; al cambiar, guardamos su copia en el tablero.
  useEffect(() => {
    if (active) setProjects((m) => ({ ...m, [active.slug]: active }));
  }, [active]);

  useEffect(() => {
    try {
      localStorage.setItem('cs:boardKind', kind);
    } catch {}
  }, [kind]);

  // Atajos mínimos: deshacer, mover con flechas, Esc, borrar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      const s = getState();
      if (!s.project || !s.frameId) return;
      const frame = s.project.sets.flatMap((x) => x.frames).find((f) => f.id === s.frameId);
      const layer = frame?.layers.find((l) => l.id === s.layerId);
      if (e.key === 'Escape') setState({ layerId: null });
      if (layer && frame && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 2;
        updateLayer(frame.id, layer.id, {
          x: layer.x + (e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0),
          y: layer.y + (e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0),
        }, `nudge:${layer.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const visible = useMemo(
    () => cases.filter((c) => filter === 'todos' || c.status === filter),
    [cases, filter],
  );

  async function changeStatus(slug: string, status: string) {
    setCases((cs) => cs.map((c) => (c.slug === slug ? { ...c, status } : c)));
    if (active?.slug === slug) {
      update((p) => void (p.status = status));
      return;
    }
    const p = projects[slug] || (await api.project(slug));
    const next = { ...p, status };
    setProjects((m) => ({ ...m, [slug]: next }));
    await api.save(slug, next);
  }

  function goTo(slug: string) {
    setFocus(slug);
    document.getElementById(`col-${slug}`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    setTimeout(() => setFocus(null), 1600);
  }

  const counts = STATUSES.map((s) => ({ ...s, n: cases.filter((c) => c.status === s.v).length }));

  return (
    <div className="board">
      <header className="board-top">
        <div className="board-row">
          <a className="logo" href="/" onClick={() => flushSave()} title="Todos los casos">
            CS
          </a>
          <strong>Previsualizar</strong>
          <div className="seg">
            <button className={kind === 'webflow' ? 'on' : ''} onClick={() => setKind('webflow')}>
              Webflow
            </button>
            <button className={kind === 'instagram' ? 'on' : ''} onClick={() => setKind('instagram')}>
              Instagram
            </button>
          </div>
          <div className="seg">
            <button className={filter === 'todos' ? 'on' : ''} onClick={() => setFilter('todos')}>
              Todos {cases.length}
            </button>
            {counts.map((s) => (
              <button key={s.v} className={filter === s.v ? 'on' : ''} onClick={() => setFilter(s.v)}>
                <i className="dot" style={{ background: s.c }} /> {s.l} {s.n}
              </button>
            ))}
          </div>
        </div>
        <div className="board-tabs">
          {visible.map((c) => (
            <button key={c.slug} className={`btab ${active?.slug === c.slug ? 'on' : ''}`} onClick={() => goTo(c.slug)}>
              <i className="dot" style={{ background: statusOf(c.status).c }} />
              {c.name}
              {batch[c.slug] && batch[c.slug].state !== 'listo' && <small className="bstate">{batch[c.slug].state}</small>}
            </button>
          ))}
        </div>
      </header>
      <div className="board-cols" ref={scroller} onPointerDown={(e) => e.target === e.currentTarget && setState({ layerId: null })}>
        {visible.map((c) => {
          const p = active?.slug === c.slug ? active : projects[c.slug];
          const set = p ? latestSet(p, kind) : undefined;
          const b = batch[c.slug];
          return (
            <section key={c.slug} id={`col-${c.slug}`} className={`bcol ${focus === c.slug ? 'focus' : ''}`}>
              <header className="bcol-h">
                <div className="bcol-title">
                  <b>{c.name}</b>
                  <span className="muted small">{set ? `${set.name} · ${set.frames.length}` : 'sin imágenes'}</span>
                </div>
                <select className="status-sel" value={c.status || 'pendiente'} style={{ borderColor: statusOf(c.status).c }} onChange={(e) => changeStatus(c.slug, e.target.value)}>
                  {STATUSES.map((s) => (
                    <option key={s.v} value={s.v}>
                      {s.l}
                    </option>
                  ))}
                </select>
              </header>
              {b && b.state !== 'listo' && <div className={`bbatch ${b.state}`}>{b.state === 'error' ? `Error: ${b.msg}` : `Armando: ${b.state}…`}</div>}
              {p && set ? (
                <SetPreview project={p} set={set} activeFrameId={active?.slug === c.slug ? activeFrame : null} />
              ) : (
                <div className="bempty">{p ? 'Todavía no hay un set de este tipo.' : c.hasStudio ? 'Cargando…' : 'Sin empezar'}</div>
              )}
            </section>
          );
        })}
      </div>
      <MiniBar />
    </div>
  );
}
