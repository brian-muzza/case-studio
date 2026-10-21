import { useState } from 'react';
import { FORMATS, WEBFLOW_GALLERY, gridRows, gridFormats } from '../../shared/model.js';
import { InteractiveFrame } from './InteractiveFrame';
import { FrameView } from '../FrameView';
import { setState, useStore, currentSet } from '../store';
import { deleteFrame, duplicateFrame, fitFormatsToGrid, formatLabel, moveFrame, setFrameFormat } from '../actions';
import { useBrand, useSize } from '../hooks';
import type { Frame, FrameSet, Project } from '../types';
import { openComments } from './Comments';

function FrameTools({ set, frame, index, onAdd }: { set: FrameSet; frame: Frame; index: number; onAdd?: () => void }) {
  return (
    <div className="ftools" onPointerDown={(e) => e.stopPropagation()}>
      <span className="ftools-n">{String(index + 1).padStart(2, '0')}</span>
      <span className="ftools-name" title={frame.name}>
        {frame.name.replace(/^\d+\s*·\s*/, '')}
      </span>
      <span className="ftools-fmt">{formatLabel(frame.format)}</span>
      <button title="Mover antes" onClick={() => moveFrame(frame.id, index - 1)} disabled={index === 0}>
        ←
      </button>
      <button title="Mover después" onClick={() => moveFrame(frame.id, index + 1)} disabled={index === set.frames.length - 1}>
        →
      </button>
      <button title="Duplicar" onClick={() => duplicateFrame(frame.id)}>
        ⧉
      </button>
      <button title="Editar en grande" onClick={() => setState({ frameId: frame.id, view: 'frame' })}>
        ⤢
      </button>
      <button title="Borrar" className="danger" onClick={() => deleteFrame(frame.id)}>
        ✕
      </button>
      {onAdd && (
        <button title="Agregar imagen después" onClick={onAdd}>
          +
        </button>
      )}
    </div>
  );
}

function Cell({ project, set, frame, index, cw, ch }: { project: Project; set: FrameSet; frame: Frame; index: number; cw: number; ch: number }) {
  const active = useStore((s) => s.frameId === frame.id);
  const scale = Math.max(cw / frame.w, ch / frame.h);
  const off = { x: (cw / scale - frame.w) / 2, y: (ch / scale - frame.h) / 2 };
  const ratioFrame = frame.h / frame.w;
  const ratioCell = ch / cw;
  const crops = Math.abs(ratioFrame - ratioCell) / ratioCell > 0.03;
  const expected = set.kind === 'webflow' ? gridFormats(set.frames.length, set.grilla)[index] : set.format;
  return (
    <div className={`cell ${active ? 'active' : ''}`} style={{ width: cw, height: ch }} onPointerDownCapture={() => !active && setState({ frameId: frame.id, layerId: null })}>
      <InteractiveFrame frame={frame} project={project} scale={scale} offset={off} box={{ w: cw, h: ch }} interactive={active} />
      {openComments(frame) > 0 && <span className="cbadge">💬 {openComments(frame)}</span>}
      <FrameTools set={set} frame={frame} index={index} />
      {crops && (
        <button className="badge warn" title="La galería recorta la imagen con object-fit: cover" onPointerDown={(e) => e.stopPropagation()} onClick={() => setFrameFormat(frame.id, expected, 'template')}>
          Se recorta · usar {formatLabel(expected)}
        </button>
      )}
    </div>
  );
}

export function GridView({ project, onAdd }: { project: Project; onAdd: (at?: number) => void }) {
  const set = useStore((s) => currentSet(s))!;
  const [ref, size] = useSize<HTMLDivElement>();
  if (!set) return null;
  const isWebflow = set.kind === 'webflow';
  const G = WEBFLOW_GALLERY;
  const zoom = Math.max(0.5, Math.min(1.15, (size.w - 64) / G.width));
  const mismatched = isWebflow && set.frames.some((f, i) => f.format !== gridFormats(set.frames.length, set.grilla)[i]);

  return (
    <div className="gridview" ref={ref} onPointerDown={(e) => e.target === e.currentTarget && setState({ layerId: null })}>
      <div className="gv-head" style={{ width: isWebflow ? G.width * zoom : undefined }}>
        <div>
          <strong>{set.name}</strong>
          <span className="muted">
            {' '}
            · {set.frames.length} imágenes {isWebflow ? `· grilla ${set.grilla || '2,1,2,3,1,2'}` : `· ${formatLabel(set.format)}`}
          </span>
        </div>
        {mismatched && (
          <button className="btn sm" onClick={() => fitFormatsToGrid(set.id)}>
            Ajustar formatos a la grilla
          </button>
        )}
      </div>
      {isWebflow ? (
        <div className="wf-gallery" style={{ width: G.width * zoom, gap: G.gap * zoom }}>
          {gridRows(set.frames, set.grilla).map((row: { cols: number; frames: Frame[] }, ri: number) => {
            const [cw, ch] = (G.cells as unknown as Record<number, [number, number]>)[row.cols];
            return (
              <div key={ri} className="wf-row" style={{ gap: G.gap * zoom }}>
                {row.frames.map((f) => (
                  <Cell key={f.id} project={project} set={set} frame={f} index={set.frames.indexOf(f)} cw={cw * zoom} ch={ch * zoom} />
                ))}
                {row.frames.length < row.cols &&
                  Array.from({ length: row.cols - row.frames.length }).map((_, k) => (
                    <button key={`e${k}`} className="cell empty" style={{ width: cw * zoom, height: ch * zoom }} onClick={() => onAdd()}>
                      + Agregar imagen
                    </button>
                  ))}
              </div>
            );
          })}
          {set.frames.length === 0 || gridRows(set.frames, set.grilla).every((r: { cols: number; frames: Frame[] }) => r.frames.length === r.cols) ? (
            <button className="cell empty full" style={{ height: 120 * zoom }} onClick={() => onAdd()}>
              + Agregar imagen
            </button>
          ) : null}
        </div>
      ) : (
        <div className="free-grid">
          {set.frames.map((f, i) => {
            const h = 340;
            const w = (h * f.w) / f.h;
            return <Cell key={f.id} project={project} set={set} frame={f} index={i} cw={w} ch={h} />;
          })}
          <button className="cell empty" style={{ width: 240, height: 340 }} onClick={() => onAdd()}>
            + Agregar imagen
          </button>
        </div>
      )}
    </div>
  );
}

export function CarouselView({ project }: { project: Project }) {
  const set = useStore((s) => currentSet(s))!;
  const frameId = useStore((s) => s.frameId);
  const [ref, size] = useSize<HTMLDivElement>();
  const handle = useBrand().usuario || 'tu.estudio';
  const frames = set?.frames || [];
  const idx = Math.max(0, frames.findIndex((f) => f.id === frameId));
  const [stripGap, setStripGap] = useState(true);
  if (!set) return null;
  const first = frames[0];
  const ratio = first ? first.h / first.w : 1.25;
  const phoneW = Math.min(420, Math.max(300, size.w * 0.32));
  const slideH = phoneW * ratio;
  const mixed = frames.some((f) => Math.abs(f.h / f.w - ratio) > 0.01);
  const go = (d: number) => {
    const n = frames[Math.max(0, Math.min(frames.length - 1, idx + d))];
    if (n) setState({ frameId: n.id, layerId: null });
  };
  const stripH = 220;
  return (
    <div className="carousel" ref={ref}>
      <div className="ig-wrap">
        <div className="ig" style={{ width: phoneW }}>
          <div className="ig-top">
            <span className="ig-av">{handle.charAt(0).toUpperCase()}</span>
            <span>
              <b>{handle}</b>
              <small>{project.name}</small>
            </span>
            <span className="ig-dots">•••</span>
          </div>
          <div className="ig-slide" style={{ height: slideH }}>
            <div className="ig-track" style={{ transform: `translateX(${-idx * phoneW}px)` }}>
              {frames.map((f) => {
                const s = Math.max(phoneW / f.w, slideH / f.h);
                return (
                  <div key={f.id} className="ig-cell" style={{ width: phoneW, height: slideH }}>
                    <div style={{ transform: `translate(${(phoneW - f.w * s) / 2}px, ${(slideH - f.h * s) / 2}px) scale(${s})`, transformOrigin: '0 0' }}>
                      <FrameView frame={f} project={project} displayScale={s} playVideos />
                    </div>
                  </div>
                );
              })}
            </div>
            {idx > 0 && (
              <button className="ig-nav l" onClick={() => go(-1)}>
                ‹
              </button>
            )}
            {idx < frames.length - 1 && (
              <button className="ig-nav r" onClick={() => go(1)}>
                ›
              </button>
            )}
            <span className="ig-count">
              {idx + 1}/{frames.length}
            </span>
          </div>
          <div className="ig-bar">
            <span>♡ 💬 ↗</span>
            <span className="ig-pager">
              {frames.map((f, i) => (
                <i key={f.id} className={i === idx ? 'on' : ''} />
              ))}
            </span>
            <span>⌑</span>
          </div>
          <div className="ig-cap">
            <b>{handle}</b> {project.name}: caso de estudio. Deslizá para ver el proceso →
          </div>
        </div>
        <div className="ig-side">
          <h4>Carrusel · {frames.length} slides</h4>
          <p className="muted">Instagram usa la proporción de la primera imagen para todo el carrusel.</p>
          {mixed && <p className="warn-t">Hay imágenes con otra proporción: Instagram las va a recortar.</p>}
          <p className="muted">Formato: {first ? (FORMATS as Record<string, { label: string }>)[first.format]?.label : '—'}</p>
          <label className="check">
            <input type="checkbox" checked={stripGap} onChange={(e) => setStripGap(e.target.checked)} /> Separar slides en la tira
          </label>
        </div>
      </div>
      <div className="strip" style={{ gap: stripGap ? 12 : 0 }}>
        {frames.map((f, i) => {
          const s = stripH / f.h;
          return (
            <div key={f.id} className={`strip-cell ${i === idx ? 'on' : ''}`} style={{ width: f.w * s, height: stripH }} onClick={() => setState({ frameId: f.id, layerId: null })}>
              <div style={{ transform: `scale(${s})`, transformOrigin: '0 0' }}>
                <FrameView frame={f} project={project} displayScale={s} />
              </div>
              <span className="strip-n">{i + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FrameEditorView({ project }: { project: Project }) {
  const set = useStore((s) => currentSet(s))!;
  const frameId = useStore((s) => s.frameId);
  const [ref, size] = useSize<HTMLDivElement>();
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const frame = set?.frames.find((f) => f.id === frameId) || set?.frames[0];
  if (!set || !frame) return <div className="empty-state">Este set no tiene imágenes todavía.</div>;
  const fit = Math.min((size.w - 80) / frame.w, (size.h - 80) / frame.h);
  const scale = zoom === 'fit' ? Math.max(0.05, fit) : zoom;
  const idx = set.frames.indexOf(frame);
  return (
    <div className="frameview">
      <div className="fv-canvas" ref={ref} onPointerDown={(e) => e.target === e.currentTarget && setState({ layerId: null })}>
        <div className="fv-inner">
          <InteractiveFrame frame={frame} project={project} scale={scale} interactive playVideos />
        </div>
        <div className="fv-zoom">
          <button onClick={() => setState({ frameId: set.frames[Math.max(0, idx - 1)].id, layerId: null })} disabled={idx === 0}>
            ‹
          </button>
          <span>
            {idx + 1} / {set.frames.length}
          </span>
          <button onClick={() => setState({ frameId: set.frames[Math.min(set.frames.length - 1, idx + 1)].id, layerId: null })} disabled={idx === set.frames.length - 1}>
            ›
          </button>
          <span className="sep" />
          <button className={zoom === 'fit' ? 'on' : ''} onClick={() => setZoom('fit')}>
            Ajustar
          </button>
          <button className={zoom === 0.5 ? 'on' : ''} onClick={() => setZoom(0.5)}>
            50%
          </button>
          <button className={zoom === 1 ? 'on' : ''} onClick={() => setZoom(1)}>
            100%
          </button>
          <span className="muted">
            {frame.w} × {frame.h}
          </span>
        </div>
      </div>
      <Filmstrip project={project} set={set} activeId={frame.id} />
    </div>
  );
}

function Filmstrip({ project, set, activeId }: { project: Project; set: FrameSet; activeId: string }) {
  const [drag, setDrag] = useState<string | null>(null);
  const H = 76;
  return (
    <div className="film">
      {set.frames.map((f, i) => {
        const s = H / f.h;
        return (
          <div
            key={f.id}
            className={`film-cell ${f.id === activeId ? 'on' : ''}`}
            draggable
            onDragStart={() => setDrag(f.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drag && drag !== f.id && moveFrame(drag, i)}
            onClick={() => setState({ frameId: f.id, layerId: null })}
            style={{ width: f.w * s, height: H }}
            title={f.name}
          >
            <div style={{ transform: `scale(${s})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
              <FrameView frame={f} project={project} displayScale={s} />
            </div>
            <span className="strip-n">{i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}
