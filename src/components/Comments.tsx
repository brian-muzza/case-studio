// Comentarios por imagen: seleccionar un cuadrado y dejar una nota para revisar después.
import { useState } from 'react';
import { uid } from '../../shared/model.js';
import { updateFrame } from '../store';
import type { Frame } from '../types';

export const openComments = (f: Frame) => (f.comments || []).filter((c) => !c.done).length;

export function Comments({ frame, compact }: { frame: Frame; compact?: boolean }) {
  const [text, setText] = useState('');
  const list = frame.comments || [];
  const add = () => {
    const t = text.trim();
    if (!t) return;
    updateFrame(frame.id, (f) => {
      f.comments = [...(f.comments || []), { id: uid('c'), text: t, at: new Date().toISOString() }];
    });
    setText('');
  };
  return (
    <div className={`comments ${compact ? 'compact' : ''}`}>
      {list.map((c) => (
        <div key={c.id} className={`cmt ${c.done ? 'done' : ''}`}>
          <input type="checkbox" checked={!!c.done} title={c.done ? 'Reabrir' : 'Marcar como resuelto'} onChange={() => updateFrame(frame.id, (f) => (f.comments = (f.comments || []).map((x) => (x.id === c.id ? { ...x, done: !x.done } : x))))} />
          <span className="cmt-t">{c.text}</span>
          <button className="cmt-x" title="Borrar comentario" onClick={() => updateFrame(frame.id, (f) => (f.comments = (f.comments || []).filter((x) => x.id !== c.id)))}>
            ×
          </button>
        </div>
      ))}
      <div className="cmt-new">
        <input
          className="txt"
          placeholder="Dejar un comentario en esta imagen…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') add();
          }}
        />
        <button className="btn sm primary" onClick={add} disabled={!text.trim()}>
          Comentar
        </button>
      </div>
    </div>
  );
}
