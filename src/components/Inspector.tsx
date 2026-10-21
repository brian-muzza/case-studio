import { useState } from 'react';
import { FORMATS, SHADOWS, DEVICES, FONTS } from '../../shared/model.js';
import { TEMPLATE_BY_ID } from '../../shared/templates.js';
import { Color, Num, Row, Section, Seg, Select, Slider } from './ui';
import { currentSet, setState, update, updateFrame, updateLayer, useStore } from '../store';
import {
  addLayer, alignLayer, applyBackgroundToSet, applyLayerStyleToSet, deleteLayer, duplicateLayer, fitFormatsToGrid,
  patchBackground, setFrameFormat, shuffleAssets, zOrder,
} from '../actions';
import { fileUrl } from '../api';
import { Comments, openComments } from './Comments';
import type { Background, Frame, Layer, Project, RectLayer, ScreenLayer, TextLayer } from '../types';

const BG_PRESETS: { label: string; get: (p: Project) => Partial<Background> }[] = [
  { label: 'Marca', get: (p) => ({ type: 'color', color: p.brand.color, overlay: { color: '#000000', opacity: 0 }, grain: 0 }) },
  { label: 'Claro', get: () => ({ type: 'color', color: '#EEEDE8', overlay: { color: '#000000', opacity: 0 }, grain: 0 }) },
  { label: 'Oscuro', get: () => ({ type: 'color', color: '#111114', overlay: { color: '#000000', opacity: 0 }, grain: 0 }) },
  { label: 'Degradé', get: (p) => ({ type: 'gradient', color: p.brand.color, color2: '#0E0E12', angle: 160 }) },
  {
    label: 'Foto blur',
    get: (p) => ({ type: 'image', image: p.assets.find((a) => a.role === 'photo')?.id || p.assets[0]?.id || null, blur: 70, imageScale: 1.2, distort: 0, overlay: { color: '#000000', opacity: 0.25 } }),
  },
  {
    label: 'Trama',
    get: (p) => ({ type: 'image', image: p.assets.find((a) => a.role === 'photo')?.id || p.assets[0]?.id || null, blur: 160, imageScale: 1.4, saturation: 1.3, grain: 35, distort: 0, overlay: { color: '#000000', opacity: 0.1 } }),
  },
  {
    label: 'Ondulado',
    get: (p) => ({ type: 'image', image: p.assets.find((a) => a.role === 'photo')?.id || p.assets[0]?.id || null, blur: 6, imageScale: 1.15, distort: 45, grain: 10, overlay: { color: '#000000', opacity: 0.35 } }),
  },
];

function AssetPick({ project, value, onChange, filter }: { project: Project; value: string | null; onChange: (id: string) => void; filter?: (a: Project['assets'][number]) => boolean }) {
  const [open, setOpen] = useState(false);
  const a = project.assets.find((x) => x.id === value);
  const list = project.assets.filter((x) => !x.hidden && (!filter || filter(x)));
  return (
    <div className="apick">
      <button className="apick-cur" onClick={() => setOpen(!open)}>
        {a ? <img src={a.kind === 'video' ? fileUrl(project.slug, a.poster || a.file) : fileUrl(project.slug, a.file, 320)} alt="" /> : <span className="ph" />}
        <span>{a ? a.label : 'Elegir imagen'}</span>
        <span className="muted">▾</span>
      </button>
      {open && (
        <div className="apick-list">
          {list.map((x) => (
            <button
              key={x.id}
              className={x.id === value ? 'on' : ''}
              onClick={() => {
                onChange(x.id);
                setOpen(false);
              }}
              title={x.label}
            >
              <img src={x.kind === 'video' ? fileUrl(project.slug, x.poster || x.file) : fileUrl(project.slug, x.file, 320)} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BackgroundPanel({ frame, project }: { frame: Frame; project: Project }) {
  const bg = frame.background;
  const set = (patch: Partial<Background>, key?: string) => patchBackground(frame.id, patch, key);
  const k = (n: string) => `bg:${frame.id}:${n}`;
  return (
    <Section title="Fondo" right={<button className="link" onClick={() => applyBackgroundToSet(frame.id)}>Aplicar a todo el set</button>}>
      <div className="chips">
        {BG_PRESETS.map((p) => (
          <button key={p.label} className="chip" onClick={() => set(p.get(project))}>
            {p.label}
          </button>
        ))}
      </div>
      <Row>
        <Seg
          value={bg.type}
          onChange={(v) => set({ type: v, image: v === 'image' && !bg.image ? project.assets.find((a) => a.role === 'photo')?.id || project.assets[0]?.id || null : bg.image })}
          options={[
            { v: 'color', l: 'Color' },
            { v: 'gradient', l: 'Degradé' },
            { v: 'image', l: 'Imagen' },
          ]}
        />
      </Row>
      <Row label="Color">
        <Color value={bg.color} onChange={(v) => set({ color: v })} />
      </Row>
      {bg.type === 'gradient' && (
        <>
          <Row label="Color 2">
            <Color value={bg.color2} onChange={(v) => set({ color2: v })} />
          </Row>
          <Slider label="Ángulo" value={bg.angle} min={0} max={360} onChange={(v) => set({ angle: v }, k('angle'))} fmt={(v) => `${v}°`} />
        </>
      )}
      {bg.type === 'image' && (
        <>
          <AssetPick project={project} value={bg.image} onChange={(id) => set({ image: id })} />
          <Slider label="Blur" value={bg.blur} min={0} max={250} onChange={(v) => set({ blur: v }, k('blur'))} />
          <Slider label="Ondulado (ripple)" value={bg.distort} min={0} max={100} onChange={(v) => set({ distort: v }, k('distort'))} />
          <Slider label="Escala" value={bg.imageScale} min={1} max={3} step={0.01} onChange={(v) => set({ imageScale: v }, k('scale'))} fmt={(v) => `${v.toFixed(2)}×`} />
          <Slider label="Brillo" value={bg.brightness} min={0.3} max={1.6} step={0.01} onChange={(v) => set({ brightness: v }, k('bri'))} fmt={(v) => v.toFixed(2)} />
          <Slider label="Saturación" value={bg.saturation} min={0} max={2} step={0.01} onChange={(v) => set({ saturation: v }, k('sat'))} fmt={(v) => v.toFixed(2)} />
        </>
      )}
      <Slider label="Trama (grano)" value={bg.grain} min={0} max={100} onChange={(v) => set({ grain: v }, k('grain'))} />
      <Row label="Capa de color">
        <Color value={bg.overlay.color} onChange={(v) => set({ overlay: { ...bg.overlay, color: v } })} />
      </Row>
      <Slider label="Opacidad de la capa" value={bg.overlay.opacity} min={0} max={1} step={0.01} onChange={(v) => set({ overlay: { ...bg.overlay, opacity: v } }, k('ov'))} fmt={(v) => `${Math.round(v * 100)}%`} />
    </Section>
  );
}

function FramePanel({ frame, project, onTemplates }: { frame: Frame; project: Project; onTemplates: () => void }) {
  const [fmtMode, setFmtMode] = useState<'template' | 'scale'>('template');
  const st = frame.stage;
  const setStage = (patch: Partial<Frame['stage']>, key?: string) => updateFrame(frame.id, (f) => Object.assign(f.stage, patch), key);
  const groups = Object.entries(FORMATS as Record<string, { label: string; group: string }>).reduce<Record<string, [string, string][]>>((acc, [k, v]) => {
    (acc[v.group] ||= []).push([k, v.label]);
    return acc;
  }, {});
  return (
    <>
      <Section title="Imagen">
        <Row label="Nombre">
          <input className="txt" value={frame.name} onChange={(e) => updateFrame(frame.id, (f) => (f.name = e.target.value), `name:${frame.id}`)} />
        </Row>
        <Row label="Formato">
          <Select value={frame.format} onChange={(v) => setFrameFormat(frame.id, v, fmtMode)}>
            {Object.entries(groups).map(([g, items]) => (
              <optgroup key={g} label={g}>
                {items.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Row>
        <Row label="Al cambiar">
          <Seg value={fmtMode} onChange={setFmtMode} options={[{ v: 'template', l: 'Re-armar' }, { v: 'scale', l: 'Escalar' }]} />
        </Row>
        <Row label="Plantilla">
          <button className="btn sm grow" onClick={onTemplates}>
            {frame.template ? TEMPLATE_BY_ID[frame.template]?.name : 'Elegir plantilla'} ▾
          </button>
        </Row>
        {frame.template && (
          <Row>
            <button className="btn sm grow" onClick={() => shuffleAssets(frame.id)} title="Mantiene el layout y cambia qué capturas se usan">
              ↻ Otras capturas
            </button>
          </Row>
        )}
        <Row label="Texto alt">
          <textarea className="txt" rows={2} placeholder="Qué muestra la imagen (para Webflow)" value={frame.alt} onChange={(e) => updateFrame(frame.id, (f) => (f.alt = e.target.value), `alt:${frame.id}`)} />
        </Row>
      </Section>
      <Section title={`Comentarios${openComments(frame) ? ` (${openComments(frame)})` : ''}`}>
        <Comments frame={frame} compact />
      </Section>
      <BackgroundPanel frame={frame} project={project} />
      <Section title="Escenario (todas las capas)" defaultOpen={false}>
        <Slider label="Rotación" value={st.rotate} min={-60} max={60} onChange={(v) => setStage({ rotate: v }, `st:r:${frame.id}`)} fmt={(v) => `${v}°`} />
        <Slider label="Perspectiva (inclinación)" value={st.tiltX} min={0} max={65} onChange={(v) => setStage({ tiltX: v }, `st:t:${frame.id}`)} fmt={(v) => `${v}°`} />
        <Slider label="Escala" value={st.scale} min={0.4} max={2.5} step={0.01} onChange={(v) => setStage({ scale: v }, `st:s:${frame.id}`)} fmt={(v) => `${v.toFixed(2)}×`} />
        <Row label="Mover">
          <Num value={st.x} onChange={(v) => setStage({ x: v })} suffix="X" />
          <Num value={st.y} onChange={(v) => setStage({ y: v })} suffix="Y" />
        </Row>
        <button className="link" onClick={() => setStage({ rotate: 0, tiltX: 0, tiltY: 0, scale: 1, x: 0, y: 0 })}>
          Restablecer
        </button>
      </Section>
    </>
  );
}

function LayersList({ frame }: { frame: Frame }) {
  const layerId = useStore((s) => s.layerId);
  return (
    <Section
      title="Capas"
      right={
        <span className="addl">
          <button title="Agregar pantalla" onClick={() => addLayer(frame.id, 'screen')}>
            ▭
          </button>
          <button title="Agregar texto" onClick={() => addLayer(frame.id, 'text')}>
            T
          </button>
          <button title="Agregar bloque de color" onClick={() => addLayer(frame.id, 'rect')}>
            ■
          </button>
        </span>
      }
    >
      <div className="layers">
        {[...frame.layers].reverse().map((l) => (
          <div key={l.id} className={`layer-i ${l.id === layerId ? 'on' : ''} ${l.hidden ? 'off' : ''}`} onClick={() => setState({ frameId: frame.id, layerId: l.id })}>
            <span className="lt">{l.type === 'text' ? 'T' : l.type === 'rect' ? '■' : l.type === 'video' ? '▶' : '▭'}</span>
            <span className="ln">{l.name}</span>
            <button title={l.locked ? 'Desbloquear' : 'Bloquear'} onClick={(e) => (e.stopPropagation(), updateLayer(frame.id, l.id, { locked: !l.locked }))}>
              {l.locked ? '🔒' : '·'}
            </button>
            <button title={l.hidden ? 'Mostrar' : 'Ocultar'} onClick={(e) => (e.stopPropagation(), updateLayer(frame.id, l.id, { hidden: !l.hidden }))}>
              {l.hidden ? '◌' : '◉'}
            </button>
          </div>
        ))}
        {!frame.layers.length && <p className="muted">Sin capas. Arrastrá una captura desde la biblioteca o elegí una plantilla.</p>}
      </div>
    </Section>
  );
}

function LayerPanel({ frame, layer, project }: { frame: Frame; layer: Layer; project: Project }) {
  const up = (patch: Partial<Layer>, key?: string) => updateLayer(frame.id, layer.id, patch, key);
  const k = (n: string) => `ly:${layer.id}:${n}`;
  return (
    <>
      <Section title={layer.type === 'text' ? 'Texto' : layer.type === 'rect' ? 'Bloque' : layer.type === 'video' ? 'Video' : 'Pantalla'}>
        <Row label="Nombre">
          <input className="txt" value={layer.name} onChange={(e) => up({ name: e.target.value }, k('name'))} />
        </Row>
        <div className="grid4">
          <Num value={layer.x} onChange={(v) => up({ x: v })} suffix="X" />
          <Num value={layer.y} onChange={(v) => up({ y: v })} suffix="Y" />
          <Num value={layer.w} onChange={(v) => up({ w: Math.max(4, v) })} suffix="W" min={4} />
          <Num value={layer.h} onChange={(v) => up({ h: Math.max(4, v) })} suffix="H" min={4} />
          <Num value={layer.rotate} onChange={(v) => up({ rotate: v })} suffix="°" />
          <Num value={Math.round((layer.opacity ?? 1) * 100)} onChange={(v) => up({ opacity: Math.max(0, Math.min(100, v)) / 100 })} suffix="%" />
        </div>
        <div className="aligns">
          <button title="Centrar horizontal" onClick={() => alignLayer(frame.id, layer.id, 'cx')}>
            ⇹
          </button>
          <button title="Centrar vertical" onClick={() => alignLayer(frame.id, layer.id, 'cy')}>
            ⇳
          </button>
          <button title="Al frente" onClick={() => zOrder(frame.id, layer.id, 'top')}>
            ⤒
          </button>
          <button title="Subir" onClick={() => zOrder(frame.id, layer.id, 1)}>
            ↑
          </button>
          <button title="Bajar" onClick={() => zOrder(frame.id, layer.id, -1)}>
            ↓
          </button>
          <button title="Al fondo" onClick={() => zOrder(frame.id, layer.id, 'bottom')}>
            ⤓
          </button>
          <button title="Duplicar (⌘D)" onClick={() => duplicateLayer(frame.id, layer.id)}>
            ⧉
          </button>
          <button title="Borrar (⌫)" className="danger" onClick={() => deleteLayer(frame.id, layer.id)}>
            ✕
          </button>
        </div>
      </Section>
      {(layer.type === 'screen' || layer.type === 'video') && <ScreenProps frame={frame} l={layer} project={project} />}
      {layer.type === 'text' && <TextProps frame={frame} l={layer} />}
      {layer.type === 'rect' && <RectProps frame={frame} l={layer} />}
    </>
  );
}

function ScreenProps({ frame, l, project }: { frame: Frame; l: ScreenLayer; project: Project }) {
  const up = (patch: Partial<ScreenLayer>, key?: string) => updateLayer(frame.id, l.id, patch as Partial<Layer>, key);
  const k = (n: string) => `ly:${l.id}:${n}`;
  const asset = project.assets.find((a) => a.id === l.asset);
  return (
    <>
      <Section title="Captura">
        <AssetPick
          project={project}
          value={l.asset}
          onChange={(id) => {
            const a = project.assets.find((x) => x.id === id);
            up({ asset: id, type: a?.kind === 'video' ? 'video' : 'screen', cropY: 0 });
          }}
        />
        <Slider label="Zoom" value={l.zoom} min={1} max={5} step={0.01} onChange={(v) => up({ zoom: v }, k('zoom'))} fmt={(v) => `${v.toFixed(2)}×`} />
        <Slider label="Desplazar vertical (scroll)" value={l.cropY} min={0} max={1} step={0.001} onChange={(v) => up({ cropY: v }, k('cy'))} fmt={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Desplazar horizontal" value={l.cropX} min={0} max={1} step={0.001} onChange={(v) => up({ cropX: v }, k('cx'))} fmt={(v) => `${Math.round(v * 100)}%`} />
        {asset?.kind === 'video' && (
          <Row label="Video">
            <Num value={l.start || 0} onChange={(v) => up({ start: Math.max(0, v) })} suffix="Inicio s" step={0.5} />
            <Num value={l.duration || Math.round(asset.duration || 10)} onChange={(v) => up({ duration: Math.max(1, v) })} suffix="Dura s" step={0.5} />
          </Row>
        )}
        <p className="muted small">Doble clic sobre la pantalla para arrastrar la captura adentro del marco.</p>
      </Section>
      <Section title="Estilo" right={<button className="link" onClick={() => applyLayerStyleToSet(frame.id, l.id)} title="Aplica sombra, radio y tono a todas las pantallas con el mismo marco del set">Aplicar a todas</button>}>
        <Row label="Marco">
          <Select value={l.device} onChange={(v) => up({ device: v as ScreenLayer['device'] })}>
            {Object.entries(DEVICES as Record<string, { label: string }>).map(([kk, v]) => (
              <option key={kk} value={kk}>
                {v.label}
              </option>
            ))}
          </Select>
        </Row>
        {l.device !== 'none' && (
          <Row label="Tono">
            <Seg value={l.deviceTone} onChange={(v) => up({ deviceTone: v })} options={[{ v: 'light', l: 'Claro' }, { v: 'dark', l: 'Oscuro' }]} />
          </Row>
        )}
        <Row label="Sombra">
          <Select value={l.shadow} onChange={(v) => up({ shadow: v })}>
            {Object.entries(SHADOWS as Record<string, { label: string }>).map(([kk, v]) => (
              <option key={kk} value={kk}>
                {v.label}
              </option>
            ))}
          </Select>
        </Row>
        {(l.device === 'none' || l.device === 'browser') && <Slider label="Radio de esquinas" value={l.radius} min={0} max={80} onChange={(v) => up({ radius: v }, k('r'))} />}
        <label className="check">
          <input type="checkbox" checked={l.border} onChange={(e) => up({ border: e.target.checked })} /> Borde fino
        </label>
      </Section>
    </>
  );
}

function TextProps({ frame, l }: { frame: Frame; l: TextLayer }) {
  const up = (patch: Partial<TextLayer>, key?: string) => updateLayer(frame.id, l.id, patch as Partial<Layer>, key);
  return (
    <Section title="Tipografía">
      <textarea className="txt" rows={3} value={l.text} onChange={(e) => up({ text: e.target.value }, `tx:${l.id}`)} />
      <Row label="Fuente">
        <Select value={l.fontFamily} onChange={(v) => up({ fontFamily: v })}>
          {Object.keys(FONTS).map((f) => (
            <option key={f}>{f}</option>
          ))}
        </Select>
      </Row>
      <div className="grid4">
        <Num value={l.fontSize} onChange={(v) => up({ fontSize: Math.max(4, v) })} suffix="Tam" />
        <Num value={l.fontWeight} onChange={(v) => up({ fontWeight: v })} suffix="Peso" step={100} min={100} max={900} />
        <Num value={l.lineHeight} onChange={(v) => up({ lineHeight: v })} suffix="Interl" step={0.05} />
        <Num value={l.letterSpacing} onChange={(v) => up({ letterSpacing: v })} suffix="Track" step={0.01} />
      </div>
      <Row label="Color">
        <Color value={l.color} onChange={(v) => up({ color: v })} />
      </Row>
      <Row label="Alineación">
        <Seg value={l.align} onChange={(v) => up({ align: v })} options={[{ v: 'left', l: 'Izq' }, { v: 'center', l: 'Centro' }, { v: 'right', l: 'Der' }]} />
      </Row>
    </Section>
  );
}

function RectProps({ frame, l }: { frame: Frame; l: RectLayer }) {
  const up = (patch: Partial<RectLayer>, key?: string) => updateLayer(frame.id, l.id, patch as Partial<Layer>, key);
  return (
    <Section title="Bloque">
      <Row label="Color">
        <Color value={l.fill} onChange={(v) => up({ fill: v })} />
      </Row>
      <Slider label="Radio" value={l.radius} min={0} max={200} onChange={(v) => up({ radius: v }, `rr:${l.id}`)} />
      <Row label="Sombra">
        <Select value={l.shadow} onChange={(v) => up({ shadow: v })}>
          {Object.entries(SHADOWS as Record<string, { label: string }>).map(([kk, v]) => (
            <option key={kk} value={kk}>
              {v.label}
            </option>
          ))}
        </Select>
      </Row>
    </Section>
  );
}

function SetPanel({ project }: { project: Project }) {
  const set = useStore((s) => currentSet(s));
  if (!set) return null;
  const upSet = (fn: (s: NonNullable<typeof set>) => void, key?: string) =>
    update((p) => {
      const s = p.sets.find((x) => x.id === set.id);
      if (s) fn(s);
    }, key);
  return (
    <>
      <Section title="Set">
        <Row label="Nombre">
          <input className="txt" value={set.name} onChange={(e) => upSet((s) => (s.name = e.target.value), `sn:${set.id}`)} />
        </Row>
        <Row label="Destino">
          <Seg value={set.kind} onChange={(v) => upSet((s) => (s.kind = v))} options={[{ v: 'webflow', l: 'Webflow' }, { v: 'instagram', l: 'Instagram' }, { v: 'libre', l: 'Libre' }]} />
        </Row>
        {set.kind === 'webflow' ? (
          <>
            <Row label="Grilla">
              <input className="txt" value={set.grilla} placeholder="2,1,2,3,1,2" onChange={(e) => upSet((s) => (s.grilla = e.target.value.replace(/[^0-9,\s]/g, '')), `sg:${set.id}`)} />
            </Row>
            <div className="chips">
              {['2,1,2,3', '1,2,1,2', '2,2,1', '1,3,2', '3,1,3'].map((g) => (
                <button key={g} className="chip" onClick={() => upSet((s) => (s.grilla = g))}>
                  {g}
                </button>
              ))}
            </div>
            <p className="muted small">Columnas por fila de la galería del caso (campo «grilla» del CMS). Se repite si hay más imágenes.</p>
          </>
        ) : (
          <Row label="Formato">
            <Select value={set.format} onChange={(v) => upSet((s) => (s.format = v))}>
              {['ig-4x5', 'ig-3x4', 'ig-1x1', 'story-9x16', 'land-16x9', 'land-4x3', 'sq-1x1'].map((k) => (
                <option key={k} value={k}>
                  {(FORMATS as Record<string, { label: string }>)[k].label}
                </option>
              ))}
            </Select>
          </Row>
        )}
        <button className="btn sm grow" onClick={() => fitFormatsToGrid(set.id)}>
          {set.kind === 'webflow' ? 'Ajustar formatos a la grilla' : 'Pasar todas al formato del set'}
        </button>
      </Section>
      <Section title="Marca del caso">
        <Row label="Color">
          <Color value={project.brand.color} onChange={(v) => update((p) => void (p.brand.color = v))} />
        </Row>
        <Row label="Fondo claro">
          <Color value={project.brand.bg} onChange={(v) => update((p) => void (p.brand.bg = v))} />
        </Row>
        <Row label="Fuente">
          <Select value={project.brand.font || 'Inter'} onChange={(v) => update((p) => void (p.brand.font = v))}>
            {Object.keys(FONTS).map((f) => (
              <option key={f}>{f}</option>
            ))}
          </Select>
        </Row>
        <Row label="Paleta">
          <input
            className="txt"
            placeholder="#5E34BE, #F4F1EA, …"
            value={(project.brand.palette || []).join(', ')}
            onChange={(e) =>
              update(
                (p) =>
                  void (p.brand.palette = e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)),
                'palette',
              )
            }
          />
        </Row>
      </Section>
    </>
  );
}

export function Inspector({ project, onTemplates }: { project: Project; onTemplates: () => void }) {
  const set = useStore((s) => currentSet(s));
  const frameId = useStore((s) => s.frameId);
  const layerId = useStore((s) => s.layerId);
  const frame = set?.frames.find((f) => f.id === frameId);
  const layer = frame?.layers.find((l) => l.id === layerId);
  return (
    <aside className="inspector">
      {frame ? (
        <>
          <div className="insp-tabs">
            <button className={!layer ? 'on' : ''} onClick={() => setState({ layerId: null })}>
              Imagen
            </button>
            <button className={layer ? 'on' : ''} disabled={!layer}>
              Capa
            </button>
            <button onClick={() => setState({ frameId: null, layerId: null })}>Set</button>
          </div>
          {layer ? <LayerPanel frame={frame} layer={layer} project={project} /> : <FramePanel frame={frame} project={project} onTemplates={onTemplates} />}
          <LayersList frame={frame} />
        </>
      ) : (
        <SetPanel project={project} />
      )}
    </aside>
  );
}
