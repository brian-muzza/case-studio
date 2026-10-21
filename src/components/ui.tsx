import { useEffect, useState, type ReactNode } from 'react';

export function Section({ title, children, right, defaultOpen = true }: { title: string; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="sec">
      <header className="sec-h" onClick={() => setOpen(!open)}>
        <span className={`chev ${open ? 'open' : ''}`}>›</span>
        <span>{title}</span>
        <span className="sec-r" onClick={(e) => e.stopPropagation()}>
          {right}
        </span>
      </header>
      {open && <div className="sec-b">{children}</div>}
    </section>
  );
}

export function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="row">
      {label && <label className="row-l">{label}</label>}
      <div className="row-c">{children}</div>
    </div>
  );
}

export function Num({ value, onChange, step = 1, min, max, suffix, w }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string; w?: number }) {
  const [txt, setTxt] = useState(String(round(value)));
  useEffect(() => setTxt(String(round(value))), [value]);
  const commit = (s: string) => {
    const v = parseFloat(s.replace(',', '.'));
    if (!Number.isNaN(v)) onChange(clamp(v, min, max));
    else setTxt(String(round(value)));
  };
  return (
    <span className="num" style={w ? { width: w } : undefined}>
      {suffix && <i>{suffix}</i>}
      <input
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            onChange(clamp(round(value + d), min, max));
          }
        }}
      />
    </span>
  );
}

export function Slider({ label, value, min, max, step = 1, onChange, fmt }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div className="slider">
      <div className="slider-top">
        <span>{label}</span>
        <span className="slider-v">{fmt ? fmt(value) : round(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

export function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  return (
    <span className="color">
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      <input
        className="color-t"
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => (/^#[0-9a-f]{6}$/i.test(txt) ? onChange(txt.toUpperCase()) : setTxt(value))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: ReactNode; t?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} title={o.t} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <select className="sel" value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <header className="modal-h">
          <h3>{title}</h3>
          <button className="icon" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <div className="modal-b">{children}</div>
      </div>
    </div>
  );
}

export const round = (v: number) => Math.round(v * 100) / 100;
export const clamp = (v: number, min?: number, max?: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
