// Frame editable: seleccionar, mover, redimensionar, rotar y recortar capas (estilo Figma).
import { useRef, useState, type DragEvent, type PointerEvent as RPointerEvent } from 'react';
import { FrameView } from '../FrameView';
import { setState, updateFrame, updateLayer, useStore } from '../store';
import { uid } from '../../shared/model.js';
import type { Frame, Layer, Project, ScreenLayer } from '../types';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';

interface Props {
  frame: Frame;
  project: Project;
  scale: number;
  interactive: boolean;
  /** Desplazamiento del frame dentro de su celda (vista grilla con recorte). */
  offset?: { x: number; y: number };
  /** Tamaño visible (px de pantalla) cuando el frame se muestra recortado en una celda. */
  box?: { w: number; h: number };
  playVideos?: boolean;
}

const SNAP = 6; // px de pantalla

export function InteractiveFrame({ frame, project, scale, interactive, offset, box, playVideos }: Props) {
  const selFrameId = useStore((s) => s.frameId);
  const selLayerId = useStore((s) => s.layerId);
  const selected = selFrameId === frame.id ? selLayerId : null;
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [cropMode, setCropMode] = useState<string | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const st = frame.stage || { rotate: 0, scale: 1 };
  // Convierte un delta de pantalla a coordenadas del frame (deshace escala y rotación del escenario).
  const toFrame = (dx: number, dy: number) => {
    const s = scale * (st.scale || 1);
    const a = (-(st.rotate || 0) * Math.PI) / 180;
    const x = dx / s;
    const y = dy / s;
    return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
  };

  const select = (layerId: string | null) => setState({ frameId: frame.id, layerId });

  function onLayerDown(e: RPointerEvent<HTMLDivElement>, l: Layer) {
    if (!interactive || e.button !== 0) return;
    e.stopPropagation();
    if (selected !== l.id) setCropMode(null);
    select(l.id);
    const start = { x: e.clientX, y: e.clientY };
    const orig = { ...l } as Layer;
    const crop = cropMode === l.id && (l.type === 'screen' || l.type === 'video');
    const key = `drag:${l.id}:${Date.now()}`;
    let moved = false;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const d = toFrame(ev.clientX - start.x, ev.clientY - start.y);
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      moved = true;
      if (crop) {
        const sl = orig as ScreenLayer;
        const asset = project.assets.find((a) => a.id === sl.asset);
        const aw = asset?.w || 1600;
        const ah = asset?.h || 1000;
        const s = Math.max(sl.w / aw, sl.h / ah) * (sl.zoom || 1);
        const extraX = aw * s - sl.w;
        const extraY = ah * s - sl.h;
        updateLayer(frame.id, l.id, {
          cropX: extraX > 1 ? clamp01(sl.cropX - d.x / extraX) : sl.cropX,
          cropY: extraY > 1 ? clamp01(sl.cropY - d.y / extraY) : sl.cropY,
        } as Partial<Layer>, key);
        return;
      }
      let nx = orig.x + d.x;
      let ny = orig.y + d.y;
      if (ev.shiftKey) {
        if (Math.abs(d.x) > Math.abs(d.y)) ny = orig.y;
        else nx = orig.x;
      }
      // Imán a centro y bordes del frame y de otras capas.
      const tol = SNAP / scale;
      const gv: number[] = [];
      const gh: number[] = [];
      if (!ev.altKey) {
        const xs = [0, frame.w / 2, frame.w];
        const ys = [0, frame.h / 2, frame.h];
        for (const o of frame.layers) {
          if (o.id === l.id || o.hidden) continue;
          xs.push(o.x, o.x + o.w / 2, o.x + o.w);
          ys.push(o.y, o.y + o.h / 2, o.y + o.h);
        }
        const cand = (pos: number, size: number, lines: number[], out: number[]) => {
          for (const anchor of [0, size / 2, size]) {
            for (const line of lines) {
              if (Math.abs(pos + anchor - line) < tol) {
                out.push(line);
                return line - anchor;
              }
            }
          }
          return pos;
        };
        nx = cand(nx, orig.w, xs, gv);
        ny = cand(ny, orig.h, ys, gh);
      }
      setGuides({ v: gv, h: gh });
      updateLayer(frame.id, l.id, { x: Math.round(nx), y: Math.round(ny) }, key);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      setGuides({ v: [], h: [] });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }

  function onHandleDown(e: RPointerEvent<HTMLDivElement>, l: Layer, h: Handle) {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    const o = { ...l };
    const key = `resize:${l.id}:${Date.now()}`;
    const rect = rootRef.current!.querySelector(`[data-layer="${l.id}"]`)!.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const lockAspect = (l.type === 'screen' || l.type === 'video') && l.device !== 'none' && l.device !== 'browser';
    const move = (ev: PointerEvent) => {
      if (h === 'rot') {
        const ang = (Math.atan2(ev.clientY - center.y, ev.clientX - center.x) * 180) / Math.PI + 90 - (st.rotate || 0);
        let r = Math.round(ang);
        if (ev.shiftKey) r = Math.round(r / 15) * 15;
        else for (const s of [0, 90, 180, -90, -180]) if (Math.abs(r - s) < 3) r = s;
        updateLayer(frame.id, l.id, { rotate: ((r + 540) % 360) - 180 }, key);
        return;
      }
      // Delta en ejes de la capa (deshace rotación de la capa).
      const d0 = toFrame(ev.clientX - start.x, ev.clientY - start.y);
      const a = (-(o.rotate || 0) * Math.PI) / 180;
      const d = { x: d0.x * Math.cos(a) - d0.y * Math.sin(a), y: d0.x * Math.sin(a) + d0.y * Math.cos(a) };
      let { x, y, w, h: hh } = o;
      if (h.includes('e')) w = o.w + d.x;
      if (h.includes('s')) hh = o.h + d.y;
      if (h.includes('w')) {
        w = o.w - d.x;
        x = o.x + d.x;
      }
      if (h.includes('n')) {
        hh = o.h - d.y;
        y = o.y + d.y;
      }
      if ((ev.shiftKey || lockAspect) && h.length === 2) {
        const ratio = o.h / o.w;
        if (Math.abs(w - o.w) * ratio > Math.abs(hh - o.h)) hh = w * ratio;
        else w = hh / ratio;
        if (h.includes('w')) x = o.x + o.w - w;
        if (h.includes('n')) y = o.y + o.h - hh;
      }
      if (ev.altKey) {
        x = o.x - (w - o.w) / 2;
        y = o.y - (hh - o.h) / 2;
      }
      w = Math.max(8, w);
      hh = Math.max(8, hh);
      updateLayer(frame.id, l.id, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) }, key);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }

  function onWheel(e: React.WheelEvent) {
    if (!cropMode) return;
    const l = frame.layers.find((x) => x.id === cropMode) as ScreenLayer | undefined;
    if (!l) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      updateLayer(frame.id, l.id, { zoom: Math.max(1, Math.min(6, (l.zoom || 1) * (1 - e.deltaY * 0.002))) } as Partial<Layer>, `zoom:${l.id}`);
    } else {
      const asset = project.assets.find((a) => a.id === l.asset);
      const s = Math.max(l.w / (asset?.w || 1600), l.h / (asset?.h || 1000)) * (l.zoom || 1);
      const extraY = (asset?.h || 1000) * s - l.h;
      if (extraY > 1) updateLayer(frame.id, l.id, { cropY: clamp01(l.cropY + e.deltaY / scale / extraY) } as Partial<Layer>, `scroll:${l.id}`);
    }
  }

  // Soltar un asset desde la biblioteca: sobre una capa la reemplaza, sobre el fondo agrega una nueva.
  function onDrop(e: DragEvent) {
    const assetId = e.dataTransfer.getData('text/asset-id');
    setDropHover(false);
    if (!assetId) return;
    e.preventDefault();
    const asset = project.assets.find((a) => a.id === assetId);
    if (!asset) return;
    const el = (e.target as HTMLElement).closest('[data-layer]') as HTMLElement | null;
    const layerId = el?.dataset.layer;
    const target = layerId && frame.layers.find((l) => l.id === layerId);
    if (target && (target.type === 'screen' || target.type === 'video')) {
      updateLayer(frame.id, target.id, { asset: asset.id, type: asset.kind === 'video' ? 'video' : 'screen', cropY: 0, cropX: 0.5 } as Partial<Layer>);
      select(target.id);
      return;
    }
    const box = rootRef.current!.getBoundingClientRect();
    const px = (e.clientX - box.left) / scale - (offset?.x || 0);
    const py = (e.clientY - box.top) / scale - (offset?.y || 0);
    const w = frame.w * (asset.role === 'mobile' || asset.role === 'mobile-page' ? 0.26 : 0.6);
    const isMobile = asset.role === 'mobile' || asset.role === 'mobile-page';
    const h = isMobile ? w * 2.06 : w * Math.min(asset.h / asset.w, 0.66);
    const id = uid('l');
    updateFrame(frame.id, (f) => {
      f.layers.push({
        id, type: asset.kind === 'video' ? 'video' : 'screen', name: asset.label, asset: asset.id,
        x: Math.round(px - w / 2), y: Math.round(py - h / 2), w: Math.round(w), h: Math.round(h),
        rotate: 0, opacity: 1, radius: isMobile ? 0 : Math.round(Math.min(frame.w, frame.h) * 0.012),
        shadow: 'medium', device: isMobile ? 'phone' : 'none', deviceTone: 'dark', cropX: 0.5, cropY: 0, zoom: 1, border: false,
      } as ScreenLayer);
    });
    select(id);
  }

  const sel = selected ? frame.layers.find((l) => l.id === selected) : undefined;
  const hs = 9 / scale; // tamaño de handle en px del frame
  const overlay = (l: Layer) => {
    if (!interactive || l.id !== selected) return null;
    const crop = cropMode === l.id;
    const b = 1.5 / scale;
    const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const pos: Record<string, [string, string]> = { nw: ['0%', '0%'], n: ['50%', '0%'], ne: ['100%', '0%'], e: ['100%', '50%'], se: ['100%', '100%'], s: ['50%', '100%'], sw: ['0%', '100%'], w: ['0%', '50%'] };
    return (
      <>
        <div className="sel-outline" style={{ inset: -b, borderWidth: b, borderColor: crop ? '#ff9f1a' : undefined }} />
        {!crop &&
          handles.map((h) => (
            <div
              key={h}
              className={`handle h-${h}`}
              onPointerDown={(e) => onHandleDown(e, l, h)}
              style={{ left: pos[h][0], top: pos[h][1], width: hs, height: hs, marginLeft: -hs / 2, marginTop: -hs / 2, borderWidth: b }}
            />
          ))}
        {!crop && (
          <div className="handle rot" onPointerDown={(e) => onHandleDown(e, l, 'rot')} style={{ left: '50%', top: -28 / scale, width: hs * 1.3, height: hs * 1.3, marginLeft: (-hs * 1.3) / 2, borderWidth: b }} />
        )}
        {crop && <div className="crop-tip" style={{ fontSize: 11 / scale, top: -22 / scale, padding: `${2 / scale}px ${6 / scale}px`, borderRadius: 4 / scale }}>Recorte: arrastrá la captura · rueda = desplazar · ⌘ + rueda = zoom · Esc para salir</div>}
      </>
    );
  };

  return (
    <div
      ref={rootRef}
      className={`iframe ${interactive ? 'interactive' : ''} ${dropHover ? 'drop' : ''}`}
      style={{ width: box?.w ?? frame.w * scale, height: box?.h ?? frame.h * scale }}
      onWheel={onWheel}
      onDoubleClick={(e) => {
        const el = (e.target as HTMLElement).closest('[data-layer]') as HTMLElement | null;
        const l = el && frame.layers.find((x) => x.id === el.dataset.layer);
        if (l && (l.type === 'screen' || l.type === 'video')) setCropMode(cropMode === l.id ? null : l.id);
      }}
      onKeyDown={(e) => e.key === 'Escape' && setCropMode(null)}
      tabIndex={-1}
      onDragOver={(e) => {
        if (interactive && e.dataTransfer.types.includes('text/asset-id')) {
          e.preventDefault();
          setDropHover(true);
        }
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={onDrop}
    >
      <div style={{ transform: `translate(${(offset?.x || 0) * scale}px, ${(offset?.y || 0) * scale}px) scale(${scale})`, transformOrigin: '0 0', width: frame.w, height: frame.h }}>
        <FrameView
          frame={frame}
          project={project}
          displayScale={scale}
          playVideos={playVideos}
          onLayerPointerDown={interactive ? onLayerDown : undefined}
          onBackgroundPointerDown={
            interactive
              ? () => {
                  setCropMode(null);
                  select(null);
                }
              : undefined
          }
          renderLayerOverlay={overlay}
        />
        {interactive && (guides.v.length > 0 || guides.h.length > 0) && (
          <div className="guides" style={{ transform: undefined }}>
            {guides.v.map((x, i) => (
              <div key={`v${i}`} className="guide-v" style={{ left: x, width: 1 / scale }} />
            ))}
            {guides.h.map((y, i) => (
              <div key={`h${i}`} className="guide-h" style={{ top: y, height: 1 / scale }} />
            ))}
          </div>
        )}
      </div>
      {interactive && sel && cropMode !== sel.id && (sel.type === 'screen' || sel.type === 'video') && scale > 0.2 && (
        <div className="hint">Doble clic para recortar la captura</div>
      )}
    </div>
  );
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
