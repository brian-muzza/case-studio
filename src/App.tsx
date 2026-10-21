import { useEffect, useState } from 'react';
import { api } from './api';
import { useBrand } from './hooks';
import { currentSet, getState, openProject, redo, setState, undo, useStore, flushSave, updateLayer } from './store';
import { addFrame, deleteFrame, deleteLayer, deleteSet, duplicateFrame, duplicateLayer, duplicateSetAs, setTemplate, formatLabel } from './actions';
import { gridFormats } from '../shared/model.js';
import { AssetsPanel } from './components/AssetsPanel';
import { Inspector } from './components/Inspector';
import { CarouselView, FrameEditorView, GridView } from './components/Views';
import { TemplateGallery } from './components/TemplateGallery';
import { CaptureDialog, ExportDialog, GenerateDialog } from './components/Dialogs';
import type { CaseInfo, Frame, Layer } from './types';

type Dialog = null | 'generate' | 'capture' | 'export' | { kind: 'template'; frameId: string } | { kind: 'add'; at?: number };

function Home({ onOpen }: { onOpen: (slug: string) => void }) {
  const [cases, setCases] = useState<CaseInfo[] | null>(null);
  const [dir, setDir] = useState('');
  const [q, setQ] = useState('');
  const brand = useBrand();
  useEffect(() => {
    api.cases().then((r) => {
      setCases(r.cases);
      setDir(r.casosDir);
    });
  }, []);
  const list = (cases || []).filter((c) => !q || `${c.name} ${c.slug}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="home">
      <div className="home-in">
        <h1>
          Case Studio {brand.nombre && <span>· {brand.nombre}</span>}
        </h1>
        <p className="muted">Imágenes para los casos de estudio: grilla de Webflow y carrusel de Instagram. Elegí un caso.</p>
        <a className="btn primary preview-btn" href="/?vista=tablero">
          ▦ Previsualizar todos
        </a>
        <input className="txt search" placeholder="Buscar caso…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="cases">
          {list.map((c) => (
            <button key={c.slug} className="case" onClick={() => onOpen(c.slug)}>
              <b>{c.name}</b>
              <span className="muted small">{c.url ? c.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : 'sin URL en caso.md'}</span>
              <span className="case-meta">{c.hasStudio ? `${c.latest?.webflow?.name || 'sin Webflow'} · ${c.latest?.instagram?.name || 'sin Instagram'}` : 'sin empezar'}</span>
              {c.status && <span className={`case-status st-${c.status}`}>{c.status.replace('-', ' ')}</span>}
            </button>
          ))}
        </div>
        <p className="muted small">Carpeta: {dir}</p>
      </div>
    </div>
  );
}

export function App() {
  const project = useStore((s) => s.project);
  const slug = useStore((s) => s.slug);
  const view = useStore((s) => s.view);
  const saving = useStore((s) => s.saving);
  const toastMsg = useStore((s) => s.toast);
  const set = useStore((s) => currentSet(s));
  const frameId = useStore((s) => s.frameId);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [setMenu, setSetMenu] = useState(false);
  const [cases, setCases] = useState<CaseInfo[]>([]);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('caso');
    if (q) openProject(q).catch(() => setState({ slug: null }));
    api.cases().then((r) => setCases(r.cases));
  }, []);

  // Atajos de teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const s = getState();
      const mod = e.metaKey || e.ctrlKey;
      const set = currentSet(s);
      const frame = set?.frames.find((f) => f.id === s.frameId) as Frame | undefined;
      const layer = frame?.layers.find((l) => l.id === s.layerId) as Layer | undefined;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flushSave();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (frame && layer) duplicateLayer(frame.id, layer.id);
        else if (frame) duplicateFrame(frame.id);
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && frame) {
        e.preventDefault();
        if (layer) deleteLayer(frame.id, layer.id);
        else if (confirm(`¿Borrar la imagen «${frame.name}»?`)) deleteFrame(frame.id);
        return;
      }
      if (e.key === 'Escape') {
        setState({ layerId: null });
        return;
      }
      if (layer && frame && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        updateLayer(frame.id, layer.id, { x: layer.x + dx, y: layer.y + dy }, `nudge:${layer.id}`);
        return;
      }
      if (!layer && set && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && s.view !== 'grid') {
        const i = set.frames.findIndex((f) => f.id === s.frameId);
        const n = set.frames[Math.max(0, Math.min(set.frames.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))];
        if (n) setState({ frameId: n.id });
        return;
      }
      if (e.key === '1') setState({ view: 'grid' });
      if (e.key === '2') setState({ view: 'carousel' });
      if (e.key === '3') setState({ view: 'frame' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (getState().saving !== 'idle') {
        flushSave();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);

  if (!slug || !project) return <Home onOpen={(s) => openProject(s)} />;

  const frame = set?.frames.find((f) => f.id === frameId);
  const addAt = (at?: number) => setDialog({ kind: 'add', at });

  return (
    <div className="app">
      <header className="top">
        <div className="top-l">
          <button className="logo" onClick={() => (flushSave(), setState({ slug: null, project: null }), history.replaceState(null, '', '/'))} title="Todos los casos">
            CS
          </button>
          <select className="case-sel" value={slug} onChange={(e) => openProject(e.target.value)}>
            {cases.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="sets">
            {project.sets.map((s) => (
              <button key={s.id} className={`set-tab ${s.id === set?.id ? 'on' : ''}`} onClick={() => setState({ setId: s.id, frameId: s.frames[0]?.id || null, layerId: null })}>
                {s.name}
                <small>{s.frames.length}</small>
              </button>
            ))}
            <div className="menu-wrap">
              <button className="set-tab add" onClick={() => setSetMenu(!setMenu)} title="Sets">
                ⋯
              </button>
              {setMenu && (
                <div className="menu" onMouseLeave={() => setSetMenu(false)}>
                  <button onClick={() => (setDialog('generate'), setSetMenu(false))}>Generar set nuevo…</button>
                  {set && set.frames.length > 0 && (
                    <>
                      <button onClick={() => (duplicateSetAs(set.id, 'instagram', 'ig-4x5'), setSetMenu(false))}>Duplicar como carrusel Instagram 4:5</button>
                      <button onClick={() => (duplicateSetAs(set.id, 'instagram', 'ig-3x4'), setSetMenu(false))}>Duplicar como carrusel Instagram 3:4</button>
                      <button onClick={() => (duplicateSetAs(set.id, 'instagram', 'ig-1x1'), setSetMenu(false))}>Duplicar como carrusel Instagram 1:1</button>
                      <button onClick={() => (duplicateSetAs(set.id, 'webflow', undefined, '2,1,2,3'), setSetMenu(false))}>Duplicar como galería Webflow</button>
                    </>
                  )}
                  {set && project.sets.length > 1 && (
                    <button className="danger" onClick={() => (confirm(`¿Borrar el set «${set.name}»? Las capturas no se borran.`) && deleteSet(set.id), setSetMenu(false))}>
                      Borrar este set
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="top-c">
          <div className="seg views">
            <button className={view === 'grid' ? 'on' : ''} onClick={() => setState({ view: 'grid' })} title="1">
              ▦ Grilla
            </button>
            <button className={view === 'carousel' ? 'on' : ''} onClick={() => setState({ view: 'carousel', frameId: frameId || set?.frames[0]?.id || null })} title="2">
              ◫ Carrusel
            </button>
            <button className={view === 'frame' ? 'on' : ''} onClick={() => setState({ view: 'frame', frameId: frameId || set?.frames[0]?.id || null })} title="3">
              ▢ Frame
            </button>
          </div>
        </div>
        <div className="top-r">
          <button className="icon" disabled={!canUndo} onClick={undo} title="Deshacer (⌘Z)">
            ↶
          </button>
          <button className="icon" disabled={!canRedo} onClick={redo} title="Rehacer (⇧⌘Z)">
            ↷
          </button>
          <span className={`save ${saving}`}>{saving === 'idle' ? 'Guardado' : saving === 'error' ? 'Error al guardar' : 'Guardando…'}</span>
          <a className="btn" href="/?vista=tablero" onClick={() => flushSave()}>
            ▦ Tablero
          </a>
          <button className="btn" onClick={() => setDialog('generate')}>
            ✦ Generar
          </button>
          <button className="btn primary" onClick={() => setDialog('export')} disabled={!set?.frames.length}>
            Exportar
          </button>
        </div>
      </header>
      <div className="main">
        <AssetsPanel project={project} onCapture={() => setDialog('capture')} />
        <main className="center">
          {set && set.frames.length === 0 ? (
            <div className="empty-state">
              <h2>{set.name} está vacío</h2>
              <p className="muted">
                {project.assets.length
                  ? `Hay ${project.assets.filter((a) => !a.hidden).length} capturas listas. Generá el set con plantillas o agregá imágenes de a una.`
                  : 'Empezá capturando la URL del sitio o subiendo capturas y grabaciones de pantalla.'}
              </p>
              <div className="row-btns">
                {!project.assets.length && (
                  <button className="btn primary" onClick={() => setDialog('capture')}>
                    ⌖ Capturar {project.url ? project.url.replace(/^https?:\/\/(www\.)?/, '') : 'URL'}
                  </button>
                )}
                <button className={`btn ${project.assets.length ? 'primary' : ''}`} onClick={() => setDialog('generate')}>
                  ✦ Generar set
                </button>
                <button className="btn" onClick={() => addAt()}>
                  + Una imagen
                </button>
              </div>
            </div>
          ) : view === 'grid' ? (
            <GridView project={project} onAdd={addAt} />
          ) : view === 'carousel' ? (
            <CarouselView project={project} />
          ) : (
            <FrameEditorView project={project} />
          )}
        </main>
        <Inspector project={project} onTemplates={() => frame && setDialog({ kind: 'template', frameId: frame.id })} />
      </div>
      {dialog === 'generate' && <GenerateDialog project={project} onClose={() => setDialog(null)} />}
      {dialog === 'capture' && <CaptureDialog project={project} onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog project={project} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && dialog.kind === 'template' && (
        <TemplateGallery
          project={project}
          base={set!.frames.find((f) => f.id === dialog.frameId) || null}
          format={set!.frames.find((f) => f.id === dialog.frameId)?.format || 'wf-2'}
          title="Cambiar plantilla"
          showKeep
          onClose={() => setDialog(null)}
          onPick={(tid, keep) => {
            setTemplate(dialog.frameId, tid, keep);
            setDialog(null);
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && dialog.kind === 'add' && set && (() => {
        const at = dialog.at ?? set.frames.length;
        const fmt = set.kind === 'webflow' ? gridFormats(at + 1, set.grilla)[at] : set.format;
        return (
          <TemplateGallery
            project={project}
            base={null}
            format={fmt}
            title={`Agregar imagen · ${formatLabel(fmt)}`}
            onClose={() => setDialog(null)}
            onPick={(tid) => {
              addFrame(set.id, tid, fmt, at);
              setDialog(null);
            }}
          />
        );
      })()}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
