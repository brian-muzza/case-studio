import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { StudioBrand } from './types';

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// Marca del estudio: se pide una vez al servidor y se comparte entre componentes.
let brandCache: Promise<StudioBrand> | null = null;
export function useBrand(): StudioBrand {
  const [brand, setBrand] = useState<StudioBrand>({});
  useEffect(() => {
    const pending = (brandCache ||= api.config().then((c): StudioBrand => c.marca || {}));
    pending.then(setBrand, (error) => console.warn('No se pudo leer la marca de la configuración', error));
  }, []);
  return brand;
}
