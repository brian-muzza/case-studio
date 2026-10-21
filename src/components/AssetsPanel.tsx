import { useRef, useState } from 'react';
import { ASSET_ROLES } from '../../shared/model.js';
import { api, fileUrl } from '../api';
import { currentLayer, getState, log, toast, update, updateLayer, useStore } from '../store';
import type { Asset, Layer, Project, Role } from '../types';

const ORDER: Role[] = ['hero', 'screen', 'section', 'tramo', 'component', 'page', 'mobile', 'tramo-mobile', 'mobile-page', 'video', 'photo', 'logo', 'other'];

export function AssetsPanel({ project, onCapture }: { project: Project; onCapture: () => void }) {
  const [filter, setFilter] = useState<'all' | Role>('all');
  const [showHidden, setShowHidden] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const layer = useStore((s) => currentLayer(s));

  async function upload(files: FileList | File[]) {
    const list = [...files].filter((f) => /^(image|video)\//.test(f.type) || /\.(mov|mp4|webm|png|jpe?g|webp|avif)$/i.test(f.name));
    if (!list.length) return;
    setUploading((n) => n + list.length);
    for (const f of list) {
      try {
        log(`Subiendo ${f.name}`);
        const { asset } = await api.upload(project.slug, f);
        update((p) => {
          asset.order = p.assets.length;
          p.assets.push(asset);
        });
      } catch (e) {
        toast(`Error subiendo ${f.name}: ${(e as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const visible = project.assets.filter((a) => (showHidden || !a.hidden) && (filter === 'all' || a.role === filter));
  const groups = ORDER.map((r) => ({ role: r, items: visible.filter((a) => a.role === r) })).filter((g) => g.items.length);
  const counts = ORDER.reduce<Record<string, number>>((acc, r) => ((acc[r] = project.assets.filter((a) => a.role === r && !a.hidden).length), acc), {});
  const selected = project.assets.find((a) => a.id === sel);

  const clickAsset = (a: Asset) => {
    setSel(a.id);
    const s = getState();
    if (layer && (layer.type === 'screen' || layer.type === 'video') && s.frameId) {
      updateLayer(s.frameId, layer.id, { asset: a.id, type: a.kind === 'video' ? 'video' : 'screen', cropY: 0 } as Partial<Layer>);
    }
  };

  return (
    <aside
      className={`assets ${over ? 'drop' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        upload(e.dataTransfer.files);
      }}
    >
      <div className="assets-actions">
        <button className="btn primary grow" onClick={onCapture}>
          ⌖ Capturar URL
        </button>
        <button className="btn grow" onClick={() => input.current?.click()}>
          ⇪ Subir
        </button>
        <input ref={input} type="file" multiple accept="image/*,video/*,.mov" hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>
      <p className="muted small pad">Arrastrá capturas o grabaciones de pantalla acá. Arrastralas al lienzo para sumarlas a una imagen.</p>
      {uploading > 0 && <p className="pad small">Subiendo {uploading}…</p>}
      <div className="role-filter">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          Todo
        </button>
        {ORDER.filter((r) => counts[r]).map((r) => (
          <button key={r} className={filter === r ? 'on' : ''} onClick={() => setFilter(r)}>
            {(ASSET_ROLES as Record<string, string>)[r].split(' ')[0]} {counts[r]}
          </button>
        ))}
      </div>
      <div className="assets-scroll">
        {groups.map((g) => (
          <div key={g.role} className="agroup">
            <h5>{(ASSET_ROLES as Record<string, string>)[g.role]}</h5>
            <div className="agrid">
              {g.items.map((a) => (
                <button
                  key={a.id}
                  className={`athumb ${a.id === sel ? 'on' : ''} ${a.hidden ? 'hidden' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/asset-id', a.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => clickAsset(a)}
                  title={`${a.label}\n${a.w} × ${a.h}`}
                >
                  <img src={a.kind === 'video' ? fileUrl(project.slug, a.poster || a.file) : fileUrl(project.slug, a.file, 320)} alt="" loading="lazy" style={a.role === 'logo' ? { objectFit: 'contain', background: '#fff', padding: 6 } : undefined} />
                  {a.kind === 'video' && <span className="vbadge">▶ {Math.round(a.duration || 0)}s</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!project.assets.length && (
          <div className="empty-assets">
            <p>Todavía no hay capturas.</p>
            <button className="btn primary" onClick={onCapture}>
              Capturar desde una URL
            </button>
          </div>
        )}
      </div>
      {selected && (
        <div className="asset-detail">
          <img src={selected.kind === 'video' ? fileUrl(project.slug, selected.poster || selected.file) : fileUrl(project.slug, selected.file, 320)} alt="" />
          <input className="txt" value={selected.label} onChange={(e) => update((p) => void (p.assets.find((x) => x.id === selected.id)!.label = e.target.value), `al:${selected.id}`)} />
          <div className="muted small">
            {selected.w} × {selected.h} · {selected.source === 'capture' ? 'captura' : selected.source === 'upload' ? 'subida' : 'importada'}
          </div>
          <select className="sel" value={selected.role} onChange={(e) => update((p) => void (p.assets.find((x) => x.id === selected.id)!.role = e.target.value as Role))}>
            {Object.entries(ASSET_ROLES as Record<string, string>).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <div className="row-btns">
            <button className="btn sm" onClick={() => update((p) => void (p.assets.find((x) => x.id === selected.id)!.hidden = !selected.hidden))}>
              {selected.hidden ? 'Mostrar en plantillas' : 'Ocultar de plantillas'}
            </button>
            <button className="btn sm" onClick={() => api.reveal(project.slug, selected.file)}>
              Ver archivo
            </button>
          </div>
          <label className="check small">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Ver ocultas
          </label>
        </div>
      )}
    </aside>
  );
}
