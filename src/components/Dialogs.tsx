import { useMemo, useState } from 'react';
import { FORMATS, gridFormats, gridRows, WEBFLOW_GALLERY } from '../../shared/model.js';
import { suggestTemplates, TEMPLATE_BY_ID } from '../../shared/templates.js';
import { buildFrames } from '../../shared/generate.js';
import { FrameView } from '../FrameView';
import { Modal, Row, Seg, Select } from './ui';
import { api } from '../api';
import { currentSet, flushSave, toast, update, useStore } from '../store';
import { createSet } from '../actions';
import type { Background, Frame, Project } from '../types';

const BG_OPTIONS: { v: string; l: string; get: (p: Project) => Partial<Background> }[] = [
  { v: 'variado', l: 'Variado (rota entre imágenes)', get: () => ({}) },
  { v: 'claro', l: 'Claro', get: () => ({ type: 'color', color: '#EEEDE8' }) },
  { v: 'marca', l: 'Color de marca', get: (p) => ({ type: 'color', color: p.brand.color }) },
  { v: 'oscuro', l: 'Oscuro', get: () => ({ type: 'color', color: '#111114' }) },
  { v: 'foto', l: 'Foto con blur', get: (p) => ({ type: 'image', image: p.assets.find((a) => a.role === 'photo')?.id || null, blur: 70, imageScale: 1.2, overlay: { color: '#000000', opacity: 0.25 } }) },
  { v: 'trama', l: 'Trama (blur fuerte)', get: (p) => ({ type: 'image', image: p.assets.find((a) => a.role === 'photo')?.id || p.assets[0]?.id || null, blur: 160, imageScale: 1.4, saturation: 1.3, grain: 35, overlay: { color: '#000000', opacity: 0.1 } }) },
];

function shuffle<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export function GenerateDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const cur = useStore((s) => currentSet(s));
  const [kind, setKind] = useState<'webflow' | 'instagram' | 'libre'>(cur?.kind || 'webflow');
  const [count, setCount] = useState(6);
  const [grilla, setGrilla] = useState(cur?.grilla || '2,1,2,3');
  const [format, setFormat] = useState(cur?.kind === 'instagram' ? cur.format : 'ig-4x5');
  const [bg, setBg] = useState('variado');
  const [target, setTarget] = useState<'new' | 'replace'>(cur && cur.frames.length === 0 ? 'replace' : 'new');
  const [name, setName] = useState('');
  const [variant, setVariant] = useState(0);
  const [full, setFull] = useState(true);
  const [devices, setDevices] = useState(false);
  const [withVideo, setWithVideo] = useState(true);
  const [shadow, setShadow] = useState('subtle');

  const formats: string[] = kind === 'webflow' ? gridFormats(count, grilla) : Array(count).fill(format);
  const templates = useMemo(() => {
    const used = new Set<string>();
    return formats.map((f) => {
      let seq: string[] = suggestTemplates(f, count, project.assets, { full, devices });
      if (variant) seq = shuffle(seq);
      const t = seq.find((x) => !used.has(x)) || seq[0];
      used.add(t);
      return t;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formats.join(), variant, project.assets, full, devices]);
  const background = BG_OPTIONS.find((b) => b.v === bg)!.get(project);
  const frames = useMemo(() => buildFrames(project, { kind: kind === 'libre' ? 'instagram' : kind, count, grilla, format, templates, background, bgMode: bg, devices, shadow: shadow || undefined, video: withVideo }) as Frame[], [project, kind, count, grilla, format, templates, bg, devices, shadow, withVideo]);

  const W = 520;
  const zoom = W / WEBFLOW_GALLERY.width;
  const noAssets = !project.assets.filter((a) => !a.hidden).length;

  return (
    <Modal title="Generar set de imágenes" onClose={onClose} wide>
      <div className="gen">
        <div className="gen-form">
          <Row label="Destino">
            <Seg value={kind} onChange={setKind} options={[{ v: 'webflow', l: 'Webflow' }, { v: 'instagram', l: 'Instagram' }, { v: 'libre', l: 'Libre' }]} />
          </Row>
          <Row label="Cantidad">
            <input type="range" min={1} max={25} value={count} onChange={(e) => setCount(+e.target.value)} />
            <b className="cnt">{count}</b>
          </Row>
          <div className="chips">
            {[3, 4, 5, 6, 8, 10].map((n) => (
              <button key={n} className={`chip ${n === count ? 'on' : ''}`} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
          {kind === 'webflow' ? (
            <>
              <Row label="Grilla">
                <input className="txt" value={grilla} onChange={(e) => setGrilla(e.target.value.replace(/[^0-9,\s]/g, ''))} />
              </Row>
              <div className="chips">
                {['2,1,2,3', '1,2,1,2', '2,2,1', '1,3,2', '1,1'].map((g) => (
                  <button key={g} className={`chip ${g === grilla ? 'on' : ''}`} onClick={() => setGrilla(g)}>
                    {g}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <Row label="Formato">
              <Select value={format} onChange={setFormat}>
                {['ig-4x5', 'ig-3x4', 'ig-1x1', 'story-9x16', 'land-16x9', 'land-4x3', 'sq-1x1'].map((k) => (
                  <option key={k} value={k}>
                    {(FORMATS as Record<string, { label: string }>)[k].label}
                  </option>
                ))}
              </Select>
            </Row>
          )}
          <Row label="Fondo">
            <Select value={bg} onChange={setBg}>
              {BG_OPTIONS.map((b) => (
                <option key={b.v} value={b.v}>
                  {b.l}
                </option>
              ))}
            </Select>
          </Row>
          <label className="check">
            <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Solo pantallas completas (sin recortes, mosaicos ni páginas cortadas)
          </label>
          <label className="check">
            <input type="checkbox" checked={devices} onChange={(e) => setDevices(e.target.checked)} /> Usar dispositivos (celular, laptop, navegador)
          </label>
          <label className="check">
            <input type="checkbox" checked={withVideo} onChange={(e) => setWithVideo(e.target.checked)} /> Incluir el scroll grabado (si hay)
          </label>
          <Row label="Sombra">
            <Select value={shadow} onChange={setShadow}>
              <option value="none">Sin sombra</option>
              <option value="subtle">Sutil (filete)</option>
              <option value="soft">Suave</option>
              <option value="">Según la plantilla</option>
            </Select>
          </Row>
          <Row label="Dónde">
            <Seg value={target} onChange={setTarget} options={[{ v: 'new', l: 'Set nuevo' }, { v: 'replace', l: `Reemplazar «${cur?.name || ''}»` }]} />
          </Row>
          {target === 'new' && (
            <Row label="Nombre">
              <input className="txt" placeholder={kind === 'instagram' ? 'Instagram' : 'Webflow'} value={name} onChange={(e) => setName(e.target.value)} />
            </Row>
          )}
          <ol className="gen-list">
            {templates.map((t, i) => (
              <li key={i}>
                {TEMPLATE_BY_ID[t]?.name} <span className="muted">· {(FORMATS as Record<string, { short: string }>)[formats[i]].short}</span>
              </li>
            ))}
          </ol>
          <div className="row-btns">
            <button className="btn" onClick={() => setVariant(variant + 1)}>
              ↻ Otra variante
            </button>
            <button
              className="btn primary"
              disabled={noAssets}
              onClick={() => {
                createSet({ name: name || (kind === 'instagram' ? 'Instagram' : kind === 'libre' ? 'Libre' : 'Webflow'), kind, count, grilla, format, background, bgMode: bg, devices, shadow: shadow || undefined, video: withVideo, templates, replaceSetId: target === 'replace' ? cur?.id : undefined });
                onClose();
              }}
            >
              Crear {count} imágenes
            </button>
          </div>
          {noAssets && <p className="warn-t">Primero capturá una URL o subí capturas.</p>}
        </div>
        <div className="gen-prev">
          {kind === 'webflow' ? (
            <div className="wf-gallery" style={{ width: W, gap: WEBFLOW_GALLERY.gap * zoom }}>
              {gridRows(frames, grilla).map((row: { cols: number; frames: Frame[] }, ri: number) => {
                const [cw, ch] = (WEBFLOW_GALLERY.cells as unknown as Record<number, [number, number]>)[row.cols];
                return (
                  <div key={ri} className="wf-row" style={{ gap: WEBFLOW_GALLERY.gap * zoom }}>
                    {row.frames.map((f) => {
                      const s = Math.max((cw * zoom) / f.w, (ch * zoom) / f.h);
                      return (
                        <div key={f.id} className="cell" style={{ width: cw * zoom, height: ch * zoom }}>
                          <div style={{ transform: `scale(${s})`, transformOrigin: '0 0' }}>
                            <FrameView frame={f} project={project} displayScale={s} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="gen-strip">
              {frames.map((f) => {
                const s = 150 / f.w;
                return (
                  <div key={f.id} className="cell" style={{ width: 150, height: f.h * s }}>
                    <div style={{ transform: `scale(${s})`, transformOrigin: '0 0' }}>
                      <FrameView frame={f} project={project} displayScale={s} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function CaptureDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [url, setUrl] = useState(project.url || '');
  const [desktop, setDesktop] = useState(true);
  const [mobile, setMobile] = useState(true);
  const [sections, setSections] = useState(true);
  const [fullPage, setFullPage] = useState(true);
  const [components, setComponents] = useState(true);
  const [video, setVideo] = useState(false);
  const [width, setWidth] = useState('1440');
  const [hide, setHide] = useState('');
  const [running, setRunning] = useState(false);
  const logs = useStore((s) => s.logs);
  const [startAt] = useState(Date.now());

  async function go() {
    setRunning(true);
    try {
      const { assets } = await api.capture(project.slug, { url, desktop, mobile, sections, components, fullPage, video, width: +width, height: +width === 1920 ? 1080 : +width === 1280 ? 800 : 900, hide });
      update((p) => {
        assets.forEach((a, i) => (a.order = p.assets.length + i));
        p.assets.push(...assets);
        if (!p.url) p.url = url;
      });
      toast(`${assets.length} capturas nuevas`);
      onClose();
    } catch (e) {
      toast(`Error capturando: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal title="Capturar desde una URL" onClose={onClose}>
      <Row label="URL">
        <input className="txt" autoFocus placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url && !running && go()} />
      </Row>
      <div className="checks">
        <label className="check">
          <input type="checkbox" checked={desktop} onChange={(e) => setDesktop(e.target.checked)} /> Desktop (hero)
        </label>
        <label className="check">
          <input type="checkbox" checked={sections} onChange={(e) => setSections(e.target.checked)} disabled={!desktop} /> Secciones
        </label>
        <label className="check">
          <input type="checkbox" checked={fullPage} onChange={(e) => setFullPage(e.target.checked)} /> Página completa
        </label>
        <label className="check">
          <input type="checkbox" checked={mobile} onChange={(e) => setMobile(e.target.checked)} /> Mobile (390 px)
        </label>
        <label className="check">
          <input type="checkbox" checked={components} onChange={(e) => setComponents(e.target.checked)} disabled={!desktop} /> Componentes sueltos
        </label>
        <label className="check">
          <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} /> Grabar el scroll (video)
        </label>
      </div>
      <Row label="Ancho desktop">
        <Seg value={width} onChange={setWidth} options={[{ v: '1280', l: '1280' }, { v: '1440', l: '1440' }, { v: '1920', l: '1920' }]} />
      </Row>
      <Row label="Ocultar">
        <input className="txt" placeholder="Selectores CSS extra (ej. .popup, #promo)" value={hide} onChange={(e) => setHide(e.target.value)} />
      </Row>
      <p className="muted small">Se recorre la página para que carguen las animaciones, se cierran banners de cookies y se ocultan chats flotantes. Cada captura es una unidad completa: vistas al inicio de cada sección, secciones enteras y componentes. La grabación del scroll suma 20 a 40 segundos. Para páginas internas, pegá la URL de cada una.</p>
      {running && (
        <div className="logbox">
          {logs
            .filter((l) => l.t >= startAt)
            .map((l) => (
              <div key={l.t + l.msg}>{l.msg}</div>
            ))}
          <div className="spinner">Capturando…</div>
        </div>
      )}
      <div className="row-btns end">
        <button className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn primary" disabled={!url || running} onClick={go}>
          {running ? 'Capturando…' : 'Capturar'}
        </button>
      </div>
    </Modal>
  );
}

export function ExportDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const set = useStore((s) => currentSet(s))!;
  const frameId = useStore((s) => s.frameId);
  const [format, setFormat] = useState(set.kind === 'instagram' ? 'jpg' : 'webp');
  const [scale, setScale] = useState('1');
  const [which, setWhich] = useState<'all' | 'one'>('all');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ dir: string; files: { file: string; order: number; video: boolean }[] } | null>(null);
  const logs = useStore((s) => s.logs);
  const [startAt] = useState(Date.now());
  const hasVideo = set.frames.some((f) => f.layers.some((l) => l.type === 'video'));

  async function go() {
    setRunning(true);
    try {
      await flushSave();
      const r = await api.export(project.slug, { setId: set.id, format, scale: +scale, frameIds: which === 'one' && frameId ? [frameId] : undefined });
      setResult(r);
    } catch (e) {
      toast(`Error exportando: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }
  const prompt = `Subí a Webflow el set «${set.name}» del caso ${project.slug} (exportado en casos/${project.slug}/${result?.dir || 'visual/export'}): galería en orden${set.kind === 'webflow' ? ` y grilla ${set.grilla}` : ''}, como borrador.`;

  return (
    <Modal title={`Exportar «${set.name}»`} onClose={onClose}>
      <Row label="Imágenes">
        <Seg value={which} onChange={setWhich} options={[{ v: 'all', l: `Todas (${set.frames.length})` }, { v: 'one', l: 'Solo la seleccionada' }]} />
      </Row>
      <Row label="Archivo">
        <Seg value={format} onChange={setFormat} options={[{ v: 'webp', l: 'WebP', t: 'Liviano, ideal Webflow' }, { v: 'jpg', l: 'JPG', t: 'Instagram' }, { v: 'png', l: 'PNG', t: 'Máxima calidad' }]} />
      </Row>
      <Row label="Resolución">
        <Seg value={scale} onChange={setScale} options={[{ v: '1', l: '1× (tamaño del formato)' }, { v: '2', l: '2×' }]} />
      </Row>
      {hasVideo && <p className="muted small">Las imágenes con video se exportan como MP4 (H.264, sin audio), WebP animado (para la galería de Webflow) y póster JPG.</p>}
      {running && (
        <div className="logbox">
          {logs
            .filter((l) => l.t >= startAt)
            .map((l) => (
              <div key={l.t + l.msg}>{l.msg}</div>
            ))}
          <div className="spinner">Exportando…</div>
        </div>
      )}
      {result && (
        <div className="result">
          <p>
            <b>{result.files.length} archivos</b> en <code>casos/{project.slug}/{result.dir}</code>
          </p>
          <ul className="muted small">
            {result.files.map((f) => (
              <li key={f.file}>{f.file}</li>
            ))}
          </ul>
          <div className="row-btns">
            <button className="btn" onClick={() => api.reveal(project.slug, result.dir)}>
              Abrir carpeta
            </button>
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard.writeText(prompt);
                toast('Pedido copiado: pegalo en el chat con Claude');
              }}
            >
              Copiar pedido para Webflow
            </button>
          </div>
          <p className="muted small">La subida a Webflow la hago yo desde el chat (con tu OK), cargando la galería y la grilla del caso como borrador.</p>
        </div>
      )}
      <div className="row-btns end">
        <button className="btn" onClick={onClose}>
          Cerrar
        </button>
        <button className="btn primary" disabled={running || !set.frames.length} onClick={go}>
          {running ? 'Exportando…' : result ? 'Exportar de nuevo' : 'Exportar'}
        </button>
      </div>
    </Modal>
  );
}

