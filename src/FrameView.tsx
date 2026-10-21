// Renderizador de un frame. Lo usan el editor, las miniaturas y la exportación (Playwright),
// así lo que se ve en el editor es exactamente lo que se exporta.
import { useId, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { SHADOWS, FONTS } from '../shared/model.js';
import { fileUrl } from './api';
import type { Asset, Background, Frame, Layer, Project, ScreenLayer } from './types';

export type RenderMode = 'full' | `below:${string}` | `above:${string}`;

interface Props {
  frame: Frame;
  project: Project;
  /** Escala con la que se muestra (para pedir miniaturas del tamaño justo). 0 = originales. */
  displayScale?: number;
  mode?: RenderMode;
  playVideos?: boolean;
  onLayerPointerDown?: (e: RPointerEvent<HTMLDivElement>, layer: Layer) => void;
  onBackgroundPointerDown?: (e: RPointerEvent<HTMLDivElement>) => void;
  renderLayerOverlay?: (layer: Layer) => ReactNode;
  className?: string;
}

const BUCKETS = [320, 640, 960, 1280, 1920, 2560];

export function assetSrc(project: Project, asset: Asset | undefined, neededPx: number) {
  if (!asset) return '';
  if (asset.kind === 'video') return fileUrl(project.slug, asset.file);
  if (!neededPx || neededPx >= asset.w) return fileUrl(project.slug, asset.file);
  const b = BUCKETS.find((x) => x >= neededPx) || 0;
  if (!b || b >= asset.w) return fileUrl(project.slug, asset.file);
  return fileUrl(project.slug, asset.file, b);
}

export function shadowCss(key: string) {
  return (SHADOWS as Record<string, { css: string }>)[key]?.css || 'none';
}

const NOISE =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 1.4 -.2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

function BackgroundView({ bg, frame, project, displayScale }: { bg: Background; frame: Frame; project: Project; displayScale: number }) {
  const fid = useId().replace(/:/g, '');
  const unit = Math.min(frame.w, frame.h) / 1000;
  const base: CSSProperties = { position: 'absolute', inset: 0, overflow: 'hidden' };
  const asset = bg.image ? project.assets.find((a) => a.id === bg.image) : undefined;
  let fill: ReactNode = null;
  if (bg.type === 'gradient') {
    fill = <div style={{ ...base, background: `linear-gradient(${bg.angle}deg, ${bg.color}, ${bg.color2})` }} />;
  } else if (bg.type === 'image' && asset) {
    const filters = [
      bg.distort > 0 ? `url(#${fid}-d)` : '',
      bg.blur > 0 ? `blur(${(bg.blur * unit).toFixed(1)}px)` : '',
      bg.brightness !== 1 ? `brightness(${bg.brightness})` : '',
      bg.saturation !== 1 ? `saturate(${bg.saturation})` : '',
    ].join(' ');
    // Con blur fuerte basta una imagen chica: la pedimos reducida (más rápido, mismo resultado).
    const need = displayScale ? frame.w * displayScale * 1.5 : bg.blur > 30 ? Math.min(asset.w, frame.w * 0.6) : 0;
    const src = asset.kind === 'video' ? fileUrl(project.slug, asset.poster || asset.file) : assetSrc(project, asset, need);
    fill = (
      <>
        {bg.distort > 0 && (
          <svg width="0" height="0" style={{ position: 'absolute' }}>
            <filter id={`${fid}-d`} x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency={0.004 + bg.distort * 0.00012} numOctaves={2} seed={3} />
              <feDisplacementMap in="SourceGraphic" scale={bg.distort * unit * 1.6} xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </svg>
        )}
        <img
          src={src}
          alt=""
          data-wait
          draggable={false}
          style={{ ...base, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${bg.imageScale})`, filter: filters.trim() || undefined }}
        />
      </>
    );
  }
  return (
    <div style={{ ...base, background: bg.color }} data-bg>
      {fill}
      {bg.overlay && bg.overlay.opacity > 0 && <div style={{ ...base, background: bg.overlay.color, opacity: bg.overlay.opacity }} />}
      {bg.grain > 0 && (
        <div style={{ ...base, backgroundImage: NOISE, backgroundSize: `${Math.round(220 * unit * 1.2)}px`, mixBlendMode: 'overlay', opacity: bg.grain / 100 }} />
      )}
    </div>
  );
}

// Geometría del marco de dispositivo: dónde cae el contenido dentro de la capa.
export function deviceGeometry(l: ScreenLayer) {
  const { w, h } = l;
  if (l.device === 'browser') {
    const bar = Math.max(10, Math.round(w * 0.032));
    const r = l.radius;
    return { content: { x: 0, y: bar, w, h: h - bar }, radii: [0, 0, r, r] as number[], bar };
  }
  if (l.device === 'phone') {
    const bez = Math.max(3, w * 0.035);
    const outerR = w * 0.155;
    const innerR = Math.max(0, outerR - bez);
    // Barra de estado: la captura empieza debajo de la isla, como en un teléfono real.
    const status = (w - bez * 2) * 0.115;
    return { content: { x: bez, y: bez + status, w: w - bez * 2, h: h - bez * 2 - status }, radii: [0, 0, innerR, innerR], outerR, bez, innerR, status };
  }
  if (l.device === 'laptop') {
    const baseH = w * 0.035;
    const lidW = w * 0.84;
    const lidH = h - baseH;
    const lidX = (w - lidW) / 2;
    const pad = lidW * 0.022;
    const top = lidW * 0.03;
    return {
      content: { x: lidX + pad, y: top, w: lidW - pad * 2, h: lidH - top - pad },
      radii: [2, 2, 2, 2],
      lid: { x: lidX, w: lidW, h: lidH },
      baseH,
    };
  }
  const r = l.radius;
  return { content: { x: 0, y: 0, w, h }, radii: [r, r, r, r] };
}

// Cálculo de recorte de la imagen dentro del contenido (cover + zoom + desplazamiento).
export function imagePlacement(asset: Asset | undefined, cw: number, ch: number, l: ScreenLayer) {
  const aw = asset?.w || 1600;
  const ah = asset?.h || 1000;
  const s = Math.max(cw / aw, ch / ah) * (l.zoom || 1);
  const iw = aw * s;
  const ih = ah * s;
  return { iw, ih, ix: (cw - iw) * (l.cropX ?? 0.5), iy: (ch - ih) * (l.cropY ?? 0) };
}

function ScreenView({ l, project, displayScale, playVideos, placeholder }: { l: ScreenLayer; project: Project; displayScale: number; playVideos: boolean; placeholder: boolean }) {
  const asset = project.assets.find((a) => a.id === l.asset);
  const g = deviceGeometry(l);
  const c = g.content;
  const p = imagePlacement(asset, c.w, c.h, l);
  const need = displayScale ? p.iw * displayScale * (window.devicePixelRatio || 1) : 0;
  const radii = g.radii.map((r) => `${r}px`).join(' ');
  const dark = l.deviceTone === 'dark';
  let media: ReactNode;
  if (!asset) {
    media = <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(45deg,#d9d9de 0 12px,#e6e6ea 12px 24px)' }} />;
  } else if (asset.kind === 'video' || l.type === 'video') {
    media = placeholder ? (
      <div data-video-slot style={{ position: 'absolute', inset: 0, background: '#000' }} />
    ) : playVideos ? (
      <video
        src={fileUrl(project.slug, asset.file)}
        poster={asset.poster ? fileUrl(project.slug, asset.poster) : undefined}
        muted
        loop
        autoPlay
        playsInline
        style={{ position: 'absolute', left: p.ix, top: p.iy, width: p.iw, height: p.ih, maxWidth: 'none' }}
      />
    ) : (
      <img data-wait src={asset.poster ? fileUrl(project.slug, asset.poster) : ''} alt="" draggable={false} style={{ position: 'absolute', left: p.ix, top: p.iy, width: p.iw, height: p.ih, maxWidth: 'none' }} />
    );
  } else {
    media = (
      <img
        data-wait
        src={assetSrc(project, asset, need)}
        alt=""
        draggable={false}
        style={{ position: 'absolute', left: p.ix, top: p.iy, width: p.iw, height: p.ih, maxWidth: 'none', userSelect: 'none' }}
      />
    );
  }
  const contentBox = (
    <div style={{ position: 'absolute', left: c.x, top: c.y, width: c.w, height: c.h, overflow: 'hidden', borderRadius: radii, background: '#fff', isolation: 'isolate' }}>
      {media}
      {l.border && <div style={{ position: 'absolute', inset: 0, borderRadius: radii, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)', pointerEvents: 'none' }} />}
    </div>
  );
  const shadow = shadowCss(l.shadow);

  if (l.device === 'browser') {
    const bar = g.bar!;
    const dot = Math.max(3, bar * 0.26);
    return (
      <div style={{ position: 'absolute', inset: 0, borderRadius: l.radius, boxShadow: shadow, background: dark ? '#1c1c20' : '#f3f3f5', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: bar, display: 'flex', alignItems: 'center', gap: dot * 0.7, paddingLeft: bar * 0.55 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((col) => (
            <span key={col} style={{ width: dot, height: dot, borderRadius: '50%', background: dark ? '#3a3a40' : col, display: 'block' }} />
          ))}
          <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '34%', height: bar * 0.52, borderRadius: bar, background: dark ? '#2a2a30' : '#e4e4e8' }} />
        </div>
        {contentBox}
      </div>
    );
  }
  if (l.device === 'phone') {
    return (
      <div style={{ position: 'absolute', inset: 0, borderRadius: g.outerR, boxShadow: `${shadow === 'none' ? '' : shadow + ','} inset 0 0 0 ${Math.max(1, l.w * 0.006)}px ${dark ? '#3b3b40' : '#d7d7dc'}`, background: dark ? '#0d0d10' : '#f2f2f4' }}>
        <div style={{ position: 'absolute', left: g.bez, top: g.bez, right: g.bez, height: g.status! + 1, borderRadius: `${g.innerR}px ${g.innerR}px 0 0`, background: dark ? '#000' : '#fff' }} />
        {contentBox}
        <div style={{ position: 'absolute', left: '50%', top: g.bez! + g.status! * 0.28, transform: 'translateX(-50%)', width: l.w * 0.27, height: g.status! * 0.5, borderRadius: l.w, background: '#000' }} />
      </div>
    );
  }
  if (l.device === 'laptop') {
    const lid = g.lid!;
    const baseH = g.baseH!;
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <div style={{ position: 'absolute', left: lid.x, top: 0, width: lid.w, height: lid.h, borderRadius: `${lid.w * 0.025}px ${lid.w * 0.025}px 0 0`, background: dark ? '#141416' : '#d9dade', boxShadow: shadow }} />
        {contentBox}
        <div style={{ position: 'absolute', left: 0, bottom: 0, width: l.w, height: baseH, borderRadius: `0 0 ${l.w * 0.04}px ${l.w * 0.04}px / 0 0 ${baseH}px ${baseH}px`, background: dark ? 'linear-gradient(#3a3a3f,#1b1b1e)' : 'linear-gradient(#e9e9ec,#b9b9bf)', boxShadow: shadow }}>
          <div style={{ position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)', width: l.w * 0.14, height: baseH * 0.35, borderRadius: `0 0 ${baseH}px ${baseH}px`, background: dark ? '#0e0e10' : '#a9a9b0' }} />
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: 'absolute', inset: 0, borderRadius: radii, boxShadow: shadow }}>
      {contentBox}
    </div>
  );
}

function LayerContent({ l, project, displayScale, playVideos, placeholder }: { l: Layer; project: Project; displayScale: number; playVideos: boolean; placeholder: boolean }) {
  if (l.type === 'text') {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          whiteSpace: 'pre-wrap',
          fontFamily: (FONTS as Record<string, string>)[l.fontFamily] || l.fontFamily,
          fontSize: l.fontSize,
          fontWeight: l.fontWeight,
          color: l.color,
          textAlign: l.align,
          lineHeight: l.lineHeight,
          letterSpacing: `${l.letterSpacing}em`,
        }}
      >
        {l.text}
      </div>
    );
  }
  if (l.type === 'rect') {
    return <div style={{ position: 'absolute', inset: 0, background: l.fill, borderRadius: l.radius, boxShadow: shadowCss(l.shadow) }} />;
  }
  return <ScreenView l={l} project={project} displayScale={displayScale} playVideos={playVideos} placeholder={placeholder} />;
}

export function stageTransform(s: Frame['stage']) {
  if (!s) return undefined;
  const id = !s.rotate && !s.tiltX && !s.tiltY && s.scale === 1 && !s.x && !s.y;
  if (id) return undefined;
  return `translate(${s.x}px, ${s.y}px) scale(${s.scale}) rotateX(${s.tiltX}deg) rotateY(${s.tiltY}deg) rotateZ(${s.rotate}deg)`;
}

export function FrameView({ frame, project, displayScale = 0, mode = 'full', playVideos = false, onLayerPointerDown, onBackgroundPointerDown, renderLayerOverlay, className }: Props) {
  let layers = frame.layers.filter((l) => !l.hidden);
  let showBg = true;
  let placeholderId: string | null = null;
  if (mode.startsWith('below:')) {
    const id = mode.slice(6);
    const i = layers.findIndex((l) => l.id === id);
    layers = layers.slice(0, i + 1);
    placeholderId = id;
  } else if (mode.startsWith('above:')) {
    const id = mode.slice(6);
    const i = layers.findIndex((l) => l.id === id);
    layers = layers.slice(i + 1);
    showBg = false;
  }
  return (
    <div className={className} style={{ position: 'relative', width: frame.w, height: frame.h, overflow: 'hidden', background: showBg ? undefined : 'transparent' }}>
      {showBg && (
        <div onPointerDown={onBackgroundPointerDown} style={{ position: 'absolute', inset: 0 }}>
          <BackgroundView bg={frame.background} frame={frame} project={project} displayScale={displayScale} />
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, transform: stageTransform(frame.stage), transformOrigin: '50% 50%', pointerEvents: 'none' }}>
        {layers.map((l) => (
          <div
            key={l.id}
            data-layer={l.id}
            onPointerDown={onLayerPointerDown ? (e) => onLayerPointerDown(e, l) : undefined}
            style={{
              position: 'absolute',
              left: l.x,
              top: l.y,
              width: l.w,
              height: l.h,
              transform: l.rotate ? `rotate(${l.rotate}deg)` : undefined,
              opacity: l.opacity ?? 1,
              pointerEvents: onLayerPointerDown && !l.locked ? 'auto' : 'none',
              cursor: onLayerPointerDown && !l.locked ? 'move' : undefined,
            }}
          >
            <LayerContent l={l} project={project} displayScale={displayScale} playVideos={playVideos} placeholder={l.id === placeholderId} />
            {renderLayerOverlay?.(l)}
          </div>
        ))}
      </div>
    </div>
  );
}
