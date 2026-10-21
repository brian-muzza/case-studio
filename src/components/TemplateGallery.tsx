import { useMemo, useState } from 'react';
import { TEMPLATES, FULL_SCREEN_TEMPLATES, applyTemplate, templateNeeds } from '../../shared/templates.js';
import { newFrame } from '../../shared/model.js';
import { FrameView } from '../FrameView';
import { Modal } from './ui';
import type { Frame, Project } from '../types';

interface Props {
  project: Project;
  /** Frame base (formato y fondo) para la vista previa. */
  base: Frame | null;
  format: string;
  title: string;
  onPick: (templateId: string, keepAssets: boolean) => void;
  onClose: () => void;
  showKeep?: boolean;
}

export function TemplateGallery({ project, base, format, title, onPick, onClose, showKeep }: Props) {
  const [keep, setKeep] = useState(true);
  const [cat, setCat] = useState('Completas');
  const cats = ['Completas', 'Todas', ...new Set(TEMPLATES.map((t) => t.category))];
  const frame = useMemo(() => {
    const f = base ? structuredClone(base) : (newFrame(format, project.brand) as Frame);
    return f;
  }, [base, format, project.brand]);
  const previews = useMemo(() => {
    const usage = {};
    return TEMPLATES.filter((t) => (cat === 'Completas' ? FULL_SCREEN_TEMPLATES.includes(t.id) : cat === 'Todas' || t.category === cat)).map((t) => ({
      t,
      f: applyTemplate(frame, t.id, project, usage, keep && !!base) as Frame,
      needs: templateNeeds(t, project.assets) as string[],
    }));
  }, [frame, project, keep, base, cat]);
  const W = 230;
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="tg-bar">
        <div className="seg">
          {cats.map((c) => (
            <button key={c} className={c === cat ? 'on' : ''} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        {showKeep && (
          <label className="check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Mantener las capturas actuales
          </label>
        )}
      </div>
      <div className="tg-grid">
        {previews.map(({ t, f, needs }) => {
          const s = W / f.w;
          return (
            <button key={t.id} className="tg-item" onClick={() => onPick(t.id, keep)}>
              <div className="tg-prev" style={{ width: W, height: f.h * s }}>
                <div style={{ transform: `scale(${s})`, transformOrigin: '0 0' }}>
                  <FrameView frame={f} project={project} displayScale={s} />
                </div>
              </div>
              <span className="tg-name">{t.name}</span>
              <span className="muted small">
                {t.slots.length ? `${t.slots.length} ${t.slots.length === 1 ? 'captura' : 'capturas'}` : 'Sin capturas'}
                {needs.length ? ` · faltan ${needs.join(', ')}` : ''}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
