// Librería de layouts. Cada plantilla recibe el tamaño del frame y los assets asignados
// a sus slots, y devuelve capas en píxeles. Basada en los patrones de Dribbble/Behance
// relevados el 2026-10-20 (pantalla flotante, secciones cortadas, mosaico, columnas
// escalonadas, desktop + mobile, mini guía de marca, etc.).

import { uid } from './model.js';

// Regla de oro (relevada en ~100 referencias de Dribbble, 2026-10-20): cada tarjeta muestra
// una unidad completa (vista, sección o componente) con la proporción real de su captura.
// Lo único que se corta es lo que sale por el borde del frame (sangrado).
const PHONE_RATIO = 2.19; // alto / ancho del celular con marco (pantalla 390×844 sin recorte)
const LAPTOP_RATIO = 0.58; // alto / ancho de la laptop (pantalla 16:10 sin recorte)
const BAR = 0.032; // barra del navegador (proporción del ancho)

const radiusFor = (w, h, k = 0.012) => Math.max(6, Math.round(Math.min(w, h) * k));

// Radio real del componente escalado al tamaño en que se muestra (así las esquinas coinciden).
function componentRadius(asset, w, fallback) {
  const m = asset && asset.meta;
  if (!m || !m.cssW || m.radius === undefined) return fallback;
  return Math.round(m.radius * (w / m.cssW));
}

function screen(asset, x, y, w, h, o = {}) {
  if (asset && asset.role === 'component') o = { ...o, radius: componentRadius(asset, w, o.radius ?? 12) };
  return {
    id: uid('l'),
    type: asset && asset.kind === 'video' ? 'video' : 'screen',
    name: o.name || (asset ? asset.label || asset.role : 'Pantalla'),
    asset: asset ? asset.id : null,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    rotate: o.rotate || 0,
    radius: o.radius ?? 12,
    shadow: o.shadow || 'soft',
    device: o.device || 'none',
    deviceTone: o.deviceTone || 'dark',
    cropX: o.cropX ?? 0.5,
    cropY: o.cropY ?? 0,
    zoom: o.zoom || 1,
    opacity: 1,
    border: o.border ?? false,
  };
}

function text(content, x, y, w, h, o = {}) {
  return {
    id: uid('l'),
    type: 'text',
    name: o.name || 'Texto',
    text: content,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    rotate: 0,
    fontSize: Math.round(o.fontSize || 48),
    fontWeight: o.fontWeight || 500,
    fontFamily: o.fontFamily || 'Inter',
    color: o.color || '#111111',
    align: o.align || 'left',
    lineHeight: o.lineHeight || 1.05,
    letterSpacing: o.letterSpacing ?? -0.02,
    opacity: 1,
  };
}

function rect(x, y, w, h, o = {}) {
  return {
    id: uid('l'),
    type: 'rect',
    name: o.name || 'Bloque',
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    rotate: 0,
    fill: o.fill || '#111111',
    radius: o.radius ?? 12,
    shadow: o.shadow || 'none',
    opacity: 1,
  };
}

// Encaja una caja de proporción `ratio` (alto/ancho) dentro de maxW × maxH.
function fit(maxW, maxH, ratio) {
  let w = maxW;
  let h = w * ratio;
  if (h > maxH) {
    h = maxH;
    w = h / ratio;
  }
  return { w, h };
}

const ratioOf = (a, fallback = 0.625) => (a && a.w && a.h ? a.h / a.w : fallback);
// Proporción de una "vista" (hero/pantalla). Si la captura es una página larga, usamos 16:10.
const viewRatio = (a) => {
  const r = ratioOf(a);
  return r > 0.9 ? 0.625 : r;
};
// Alto para mostrar una página larga: entera si es corta, si no hasta `max` (sangra por el borde).
const pageHeight = (a, w, max) => Math.min(max, w * ratioOf(a, 3));

// Columnas tipo masonry: cada item entra completo con su proporción y todo se escala para caber.
function masonry(items, x0, y0, W, H, cols, gap) {
  const colW = (W - gap * (cols - 1)) / cols;
  const heights = Array(cols).fill(0);
  const placed = items.map((a) => {
    const c = heights.indexOf(Math.min(...heights));
    const h = colW * ratioOf(a, 0.7);
    const p = { a, c, y: heights[c], h };
    heights[c] += h + gap;
    return p;
  });
  const maxH = Math.max(...heights) - gap;
  const s = Math.min(1, H / maxH);
  const cw = colW * s;
  const totalW = cw * cols + gap * (cols - 1);
  const offX = x0 + (W - totalW) / 2;
  const offY = y0 + (H - maxH * s) / 2;
  return placed.map((p) => ({ a: p.a, x: offX + p.c * (cw + gap), y: offY + p.y * s, w: cw, h: p.h * s }));
}

const PHONE = { radius: 0, shadow: 'strong', device: 'phone', deviceTone: 'dark' };

export const TEMPLATES = [
  {
    id: 'hero-float',
    name: 'Pantalla flotante',
    category: 'Una pantalla',
    slots: ['hero'],
    build({ w, h, assets: [a] }) {
      const b = fit(w * 0.84, h * 0.78, viewRatio(a));
      return { layers: [screen(a, (w - b.w) / 2, (h - b.h) / 2, b.w, b.h, { radius: radiusFor(w, h), shadow: 'medium' })] };
    },
  },
  {
    id: 'browser-window',
    name: 'Ventana de navegador',
    category: 'Una pantalla',
    slots: ['hero'],
    build({ w, h, assets: [a] }) {
      const b = fit(w * 0.84, h * 0.78, viewRatio(a) + BAR);
      return { layers: [screen(a, (w - b.w) / 2, (h - b.h) / 2, b.w, b.h, { radius: radiusFor(w, h), shadow: 'medium', device: 'browser', deviceTone: 'light' })] };
    },
  },
  {
    id: 'hero-corner',
    name: 'Pantalla desde la esquina',
    category: 'Una pantalla',
    slots: ['hero'],
    build({ w, h, assets: [a] }) {
      const sw = Math.min(w * 1.22, Math.max(w * 1.0, (h * 0.92) / viewRatio(a)));
      return { layers: [screen(a, w * 0.1, h * 0.13, sw, sw * viewRatio(a), { radius: radiusFor(w, h, 0.016), shadow: 'strong' })] };
    },
  },
  {
    id: 'hero-bleed',
    name: 'Página que se sale por abajo',
    category: 'Una pantalla',
    slots: ['page'],
    build({ w, h, assets: [a] }) {
      const sw = w * (w > h * 1.2 ? 0.66 : 0.82);
      const y = h * 0.1;
      return { layers: [screen(a, (w - sw) / 2, y, sw, pageHeight(a, sw, h), { radius: radiusFor(w, h), shadow: 'strong' })] };
    },
  },
  {
    id: 'full-bleed',
    name: 'Página a sangre',
    category: 'Una pantalla',
    slots: ['page'],
    build({ w, h, assets: [a] }) {
      return { layers: [screen(a, 0, 0, w, Math.max(h, pageHeight(a, w, h)), { radius: 0, shadow: 'none' })] };
    },
  },
  {
    id: 'detail-zoom',
    name: 'Componente destacado',
    category: 'Componentes',
    slots: ['component'],
    build({ w, h, assets: [a] }) {
      const b = fit(w * 0.84, h * 0.8, ratioOf(a, 0.7));
      return { layers: [screen(a, (w - b.w) / 2, (h - b.h) / 2, b.w, b.h, { radius: radiusFor(w, h, 0.016), shadow: 'strong' })] };
    },
  },
  {
    id: 'bento',
    name: 'Componentes sueltos',
    category: 'Componentes',
    slots: ['component', 'component', 'component', 'component', 'component'],
    build({ w, h, assets }) {
      const pad = Math.min(w, h) * 0.07;
      const gap = Math.min(w, h) * 0.03;
      const cols = w > h * 1.2 ? 3 : 2;
      // Solo componentes y uno por tipo (nada de tarjetas gemelas con otro texto).
      const uniq = assets.filter((a, i) => a && a.role === 'component' && assets.findIndex((b) => b && contentKey(b) === contentKey(a)) === i);
      const boxes = masonry(uniq, pad, pad, w - pad * 2, h - pad * 2, cols, gap);
      return { layers: boxes.map((b) => screen(b.a, b.x, b.y, b.w, b.h, { radius: radiusFor(w, h, 0.012), shadow: 'medium' })) };
    },
  },
  {
    id: 'hero-overlap',
    name: 'Pantalla + componente encima',
    category: 'Componentes',
    slots: ['hero', 'component'],
    build({ w, h, assets: [a, c] }) {
      const d = fit(w * 0.78, h * 0.7, viewRatio(a));
      const dx = w * 0.07;
      const dy = h * 0.1;
      const cb = fit(w * 0.4, h * 0.42, ratioOf(c, 0.7));
      return {
        layers: [
          screen(a, dx, dy, d.w, d.h, { radius: radiusFor(w, h), shadow: 'medium' }),
          screen(c, w - cb.w - w * 0.06, h - cb.h - h * 0.07, cb.w, cb.h, { radius: radiusFor(w, h, 0.014), shadow: 'strong' }),
        ],
      };
    },
  },
  {
    id: 'laptop',
    name: 'Laptop',
    category: 'Dispositivos',
    slots: ['hero'],
    build({ w, h, assets: [a] }) {
      const b = fit(w * 0.86, h * 0.8, LAPTOP_RATIO);
      return { layers: [screen(a, (w - b.w) / 2, (h - b.h) / 2, b.w, b.h, { radius: 0, shadow: 'none', device: 'laptop', deviceTone: 'dark' })] };
    },
  },
  {
    id: 'phone-single',
    name: 'Un celular',
    category: 'Dispositivos',
    slots: ['mobile'],
    build({ w, h, assets: [a] }) {
      const b = fit(w * 0.5, h * 0.84, PHONE_RATIO);
      return { layers: [screen(a, (w - b.w) / 2, (h - b.h) / 2, b.w, b.h, PHONE)] };
    },
  },
  {
    id: 'mobile-duo',
    name: 'Dos celulares',
    category: 'Dispositivos',
    slots: ['mobile', 'mobile'],
    build({ w, h, assets: [a, b2] }) {
      const b = fit(w * 0.36, h * 0.8, PHONE_RATIO);
      const gap = w * 0.04;
      const x0 = (w - (b.w * 2 + gap)) / 2;
      return {
        layers: [
          screen(a, x0, (h - b.h) / 2 - h * 0.03, b.w, b.h, PHONE),
          screen(b2, x0 + b.w + gap, (h - b.h) / 2 + h * 0.03, b.w, b.h, PHONE),
        ],
      };
    },
  },
  {
    id: 'mobile-trio',
    name: 'Tres celulares',
    category: 'Dispositivos',
    slots: ['mobile', 'mobile', 'mobile'],
    build({ w, h, assets: [a, b2, c] }) {
      const b = fit(w * 0.27, h * 0.76, PHONE_RATIO);
      const gap = w * 0.035;
      const x0 = (w - (b.w * 3 + gap * 2)) / 2;
      const y = (h - b.h) / 2;
      return {
        layers: [
          screen(a, x0, y + h * 0.04, b.w, b.h, PHONE),
          screen(b2, x0 + b.w + gap, y - h * 0.04, b.w, b.h, PHONE),
          screen(c, x0 + (b.w + gap) * 2, y + h * 0.04, b.w, b.h, PHONE),
        ],
      };
    },
  },
  {
    id: 'mobile-flat',
    name: 'Pantallas mobile',
    category: 'Dispositivos',
    slots: ['mobile', 'mobile', 'mobile', 'mobile'],
    build({ w, h, assets }) {
      const n = w > h * 1.2 ? 4 : 3;
      const list = assets.filter((a, i) => !a || assets.findIndex((b) => b && b.id === a.id) === i).slice(0, n);
      const gap = w * 0.03;
      const r = ratioOf(list[0], 2.164);
      const b = fit((w * 0.88 - gap * (n - 1)) / n, h * 0.78, r);
      const x0 = (w - (b.w * n + gap * (n - 1))) / 2;
      return {
        layers: list.map((a, i) => screen(a, x0 + i * (b.w + gap), (h - b.h) / 2 + (i % 2 ? -1 : 1) * h * 0.035, b.w, b.h, { radius: b.w * 0.07, shadow: 'medium' })),
      };
    },
  },
  {
    id: 'desktop-mobile',
    name: 'Desktop + mobile',
    category: 'Dispositivos',
    slots: ['hero', 'mobile'],
    build({ w, h, assets: [a, m] }) {
      const d = fit(w * 0.78, h * 0.72, viewRatio(a) + BAR);
      const p = fit(w * 0.22, h * 0.68, PHONE_RATIO);
      return {
        layers: [
          screen(a, w * 0.07, (h - d.h) / 2 - h * 0.05, d.w, d.h, { radius: radiusFor(w, h), shadow: 'medium', device: 'browser', deviceTone: 'light' }),
          screen(m, w - p.w - w * 0.08, h - p.h - h * 0.07, p.w, p.h, PHONE),
        ],
      };
    },
  },
  {
    id: 'stack-cut',
    name: 'Secciones apiladas',
    category: 'Varias pantallas',
    slots: ['section', 'section', 'section'],
    build({ w, h, assets }) {
      const sw = w * (w > h * 1.2 ? 0.56 : 0.78);
      const gap = Math.min(w, h) * 0.03;
      const r = radiusFor(w, h);
      let y = h * 0.08;
      const layers = [];
      for (const a of assets) {
        if (y > h) break;
        const sh = sw * ratioOf(a, 0.56);
        layers.push(screen(a, (w - sw) / 2, y, sw, sh, { radius: r, shadow: 'soft' }));
        y += sh + gap;
      }
      return { layers };
    },
  },
  {
    id: 'duo',
    name: 'Dos páginas',
    category: 'Varias pantallas',
    slots: ['page', 'page'],
    build({ w, h, assets }) {
      const gap = w * 0.04;
      const sw = (w * 0.84 - gap) / 2;
      const x0 = (w - (sw * 2 + gap)) / 2;
      const r = radiusFor(w, h);
      return {
        layers: [
          screen(assets[0], x0, h * 0.1, sw, pageHeight(assets[0], sw, h), { radius: r, shadow: 'medium' }),
          screen(assets[1], x0 + sw + gap, h * 0.2, sw, pageHeight(assets[1], sw, h), { radius: r, shadow: 'medium' }),
        ],
      };
    },
  },
  {
    id: 'trio-stagger',
    name: 'Tres columnas escalonadas',
    category: 'Varias pantallas',
    slots: ['page', 'page', 'page'],
    build({ w, h, assets }) {
      const gap = w * 0.03;
      const sw = (w * 0.88 - gap * 2) / 3;
      const x0 = (w - (sw * 3 + gap * 2)) / 2;
      const offs = [0.16, 0.06, 0.22];
      const r = radiusFor(w, h, 0.01);
      return { layers: assets.map((a, i) => screen(a, x0 + i * (sw + gap), h * offs[i], sw, pageHeight(a, sw, h * 1.2), { radius: r, shadow: 'medium' })) };
    },
  },
  {
    id: 'main-side',
    name: 'Principal + secciones',
    category: 'Varias pantallas',
    slots: ['page', 'section', 'section'],
    build({ w, h, assets: [a, b, c] }) {
      const pad = w * 0.06;
      const gap = w * 0.025;
      const mw = (w - pad * 2 - gap) * 0.55;
      const sw = w - pad * 2 - gap - mw;
      const r = radiusFor(w, h);
      const layers = [screen(a, pad, pad, mw, pageHeight(a, mw, h), { radius: r, shadow: 'medium' })];
      let y = pad;
      for (const s of [b, c]) {
        const sh = sw * ratioOf(s, 0.6);
        layers.push(screen(s, pad + mw + gap, y, sw, sh, { radius: r, shadow: 'soft' }));
        y += sh + gap;
      }
      return { layers };
    },
  },
  {
    id: 'cascade',
    name: 'Cascada',
    category: 'Varias pantallas',
    slots: ['hero', 'screen', 'screen'],
    build({ w, h, assets }) {
      const ratio = viewRatio(assets[0]) + BAR;
      const b = fit(w * 0.66, h * 0.56, ratio);
      const stepX = w * 0.1;
      const stepY = h * 0.13;
      const x0 = (w - (b.w + stepX * 2)) / 2;
      const y0 = (h - (b.h + stepY * 2)) / 2;
      const r = radiusFor(w, h);
      return { layers: assets.map((a, i) => screen(a, x0 + i * stepX, y0 + i * stepY, b.w, b.h, { radius: r, shadow: 'strong', device: 'browser', deviceTone: 'light' })) };
    },
  },
  {
    id: 'screens-duo',
    name: 'Dos pantallas',
    category: 'Varias pantallas',
    slots: ['hero', 'screen'],
    build({ w, h, assets }) {
      const ratio = viewRatio(assets[0]) + BAR;
      const r = radiusFor(w, h);
      const o = { radius: r, shadow: 'medium', device: 'browser', deviceTone: 'light' };
      if (w > h * 1.15) {
        const gap = w * 0.035;
        const b = fit((w * 0.9 - gap) / 2, h * 0.8, ratio);
        const x0 = (w - (b.w * 2 + gap)) / 2;
        return { layers: assets.map((a, i) => screen(a, x0 + i * (b.w + gap), (h - b.h) / 2, b.w, b.h, o)) };
      }
      const gap = h * 0.04;
      const b = fit(w * 0.8, (h * 0.88 - gap) / 2, ratio);
      const y0 = (h - (b.h * 2 + gap)) / 2;
      return { layers: assets.map((a, i) => screen(a, (w - b.w) / 2 + (i ? w * 0.04 : -w * 0.04), y0 + i * (b.h + gap), b.w, b.h, o)) };
    },
  },
  {
    id: 'screens-grid',
    name: 'Grilla de pantallas',
    category: 'Varias pantallas',
    slots: ['hero', 'screen', 'screen', 'screen'],
    build({ w, h, assets }) {
      const ratio = viewRatio(assets[0]);
      const gap = Math.min(w, h) * 0.03;
      const b = fit((w * 0.88 - gap) / 2, (h * 0.86 - gap) / 2, ratio);
      const x0 = (w - (b.w * 2 + gap)) / 2;
      const y0 = (h - (b.h * 2 + gap)) / 2;
      const r = radiusFor(w, h, 0.01);
      return { layers: assets.map((a, i) => screen(a, x0 + (i % 2) * (b.w + gap), y0 + Math.floor(i / 2) * (b.h + gap), b.w, b.h, { radius: r, shadow: 'soft' })) };
    },
  },
  {
    id: 'screen-trio',
    name: 'Pantalla grande + dos chicas',
    category: 'Varias pantallas',
    slots: ['hero', 'screen', 'screen'],
    build({ w, h, assets: [a, b2, c] }) {
      const ratio = viewRatio(a);
      const gap = Math.min(w, h) * 0.03;
      const r = radiusFor(w, h, 0.01);
      // Grande arriba a todo el ancho útil, dos chicas abajo.
      const big = fit(w * 0.86, h * 0.56, ratio);
      const small = fit((big.w - gap) / 2, h * 0.3, ratio);
      const total = big.h + gap + small.h;
      const y0 = (h - total) / 2;
      const x0 = (w - big.w) / 2;
      return {
        layers: [
          screen(a, x0, y0, big.w, big.h, { radius: r, shadow: 'medium' }),
          screen(b2, x0, y0 + big.h + gap, small.w, small.h, { radius: r, shadow: 'soft' }),
          screen(c, x0 + big.w - small.w, y0 + big.h + gap, small.w, small.h, { radius: r, shadow: 'soft' }),
        ],
      };
    },
  },
  {
    id: 'tramo',
    name: 'Tramo vertical',
    category: 'Tramos verticales',
    slots: ['tramo'],
    build({ w, h, assets: [a] }) {
      const b = fit(w * 0.82, h * 0.88, ratioOf(a, 1.6));
      return { layers: [screen(a, (w - b.w) / 2, (h - b.h) / 2, b.w, b.h, { radius: radiusFor(w, h, 0.01), shadow: 'soft' })] };
    },
  },
  {
    id: 'tramos-duo',
    name: 'Dos tramos',
    category: 'Tramos verticales',
    slots: ['tramo', 'tramo'],
    build({ w, h, assets }) {
      const list = assets.filter((a, i) => !a || assets.findIndex((b) => b && b.id === a.id) === i);
      const gap = w * 0.04;
      const colW = (w * 0.86 - gap) / 2;
      const boxes = list.map((a) => fit(colW, h * 0.86, ratioOf(a, 1.6)));
      const totalW = boxes.reduce((n, b) => n + b.w, 0) + gap * (boxes.length - 1);
      let x = (w - totalW) / 2;
      const r = radiusFor(w, h, 0.01);
      return {
        layers: list.map((a, i) => {
          const b = boxes[i];
          const l = screen(a, x, (h - b.h) / 2 + (i % 2 ? h * 0.025 : -h * 0.025), b.w, b.h, { radius: r, shadow: 'soft' });
          x += b.w + gap;
          return l;
        }),
      };
    },
  },
  {
    id: 'tramos-trio',
    name: 'Tres tramos',
    category: 'Tramos verticales',
    slots: ['tramo', 'tramo', 'tramo'],
    build({ w, h, assets }) {
      const list = assets.filter((a, i) => !a || assets.findIndex((b) => b && b.id === a.id) === i);
      const gap = w * 0.03;
      const colW = (w * 0.88 - gap * 2) / 3;
      const boxes = list.map((a) => fit(colW, h * 0.86, ratioOf(a, 1.6)));
      const totalW = boxes.reduce((n, b) => n + b.w, 0) + gap * (boxes.length - 1);
      let x = (w - totalW) / 2;
      const r = radiusFor(w, h, 0.008);
      return {
        layers: list.map((a, i) => {
          const b = boxes[i];
          const l = screen(a, x, (h - b.h) / 2 + (i === 1 ? -h * 0.03 : h * 0.02), b.w, b.h, { radius: r, shadow: 'soft' });
          x += b.w + gap;
          return l;
        }),
      };
    },
  },
  {
    id: 'tramos-mobile',
    name: 'Tramos mobile',
    category: 'Tramos verticales',
    slots: ['tramo-mobile', 'tramo-mobile', 'tramo-mobile'],
    build({ w, h, assets }) {
      const list = assets.filter((a, i) => !a || assets.findIndex((b) => b && b.id === a.id) === i).slice(0, w > h * 1.15 ? 3 : 2);
      const gap = w * 0.04;
      const n = list.length;
      const colW = (w * 0.8 - gap * (n - 1)) / n;
      const boxes = list.map((a) => fit(colW, h * 0.86, ratioOf(a, 3.5)));
      const totalW = boxes.reduce((s2, b) => s2 + b.w, 0) + gap * (n - 1);
      let x = (w - totalW) / 2;
      return {
        layers: list.map((a, i) => {
          const b = boxes[i];
          const l = screen(a, x, (h - b.h) / 2 + (i % 2 ? h * 0.03 : -h * 0.03), b.w, b.h, { radius: b.w * 0.06, shadow: 'soft' });
          x += b.w + gap;
          return l;
        }),
      };
    },
  },
  {
    id: 'pages-row',
    name: 'Fila de páginas',
    category: 'Varias pantallas',
    slots: ['page', 'page', 'page', 'page'],
    build({ w, h, assets }) {
      const n = assets.length;
      const gap = w * 0.02;
      const sw = (w * 0.92 - gap * (n - 1)) / n;
      const x0 = (w - (sw * n + gap * (n - 1))) / 2;
      const r = radiusFor(w, h, 0.008);
      return { layers: assets.map((a, i) => screen(a, x0 + i * (sw + gap), h * 0.12, sw, pageHeight(a, sw, h), { radius: r, shadow: 'soft' })) };
    },
  },
  {
    id: 'mosaic',
    name: 'Mosaico inclinado',
    category: 'Muchas pantallas',
    slots: ['screen', 'screen', 'screen', 'screen', 'screen', 'screen', 'screen', 'screen', 'screen'],
    build({ w, h, assets }) {
      const cols = 3;
      const gap = w * 0.025;
      const cw = w * 0.42;
      const ch = cw * viewRatio(assets[0]);
      const gw = cols * cw + (cols - 1) * gap;
      const gh = 3 * ch + 2 * gap;
      const x0 = (w - gw) / 2;
      const y0 = (h - gh) / 2;
      const r = radiusFor(w, h, 0.01);
      const layers = assets.map((a, i) => {
        const c = i % cols;
        const row = Math.floor(i / cols);
        const shift = c === 1 ? ch * 0.35 : 0;
        return screen(a, x0 + c * (cw + gap), y0 + row * (ch + gap) - shift, cw, ch, { radius: r, shadow: 'soft' });
      });
      return { layers, stage: { rotate: -12, tiltX: 0, tiltY: 0, scale: 1.08, x: 0, y: 0 } };
    },
  },
  {
    id: 'mosaic-iso',
    name: 'Mosaico en perspectiva',
    category: 'Muchas pantallas',
    slots: ['screen', 'screen', 'screen', 'screen', 'screen', 'screen', 'screen', 'screen', 'screen'],
    build({ w, h, assets }) {
      const cols = 3;
      const gap = w * 0.03;
      const cw = w * 0.4;
      const ch = cw * viewRatio(assets[0]);
      const gw = cols * cw + (cols - 1) * gap;
      const gh = 3 * ch + 2 * gap;
      const x0 = (w - gw) / 2;
      const y0 = (h - gh) / 2;
      const r = radiusFor(w, h, 0.01);
      const layers = assets.map((a, i) => screen(a, x0 + (i % cols) * (cw + gap), y0 + Math.floor(i / cols) * (ch + gap), cw, ch, { radius: r, shadow: 'medium' }));
      return { layers, stage: { rotate: -32, tiltX: 48, tiltY: 0, scale: 1.05, x: 0, y: 0 } };
    },
  },
  {
    id: 'pages-iso',
    name: 'Páginas en perspectiva',
    category: 'Muchas pantallas',
    slots: ['page', 'page', 'page', 'page'],
    build({ w, h, assets }) {
      const n = assets.length;
      const gap = w * 0.04;
      const sw = w * 0.3;
      const x0 = (w - (sw * n + gap * (n - 1))) / 2;
      const r = radiusFor(w, h, 0.01);
      const layers = assets.map((a, i) => screen(a, x0 + i * (sw + gap), -h * 0.2 + (i % 2) * h * 0.18, sw, pageHeight(a, sw, h * 1.6), { radius: r, shadow: 'medium' }));
      return { layers, stage: { rotate: -30, tiltX: 50, tiltY: 0, scale: 1.1, x: 0, y: 0 } };
    },
  },
  {
    id: 'brand-guide',
    name: 'Mini guía de marca',
    category: 'Marca',
    slots: [],
    build({ w, h, brand, project }) {
      const pad = Math.min(w, h) * 0.08;
      const fs = Math.min(w, h);
      const colors = (brand.palette && brand.palette.length ? brand.palette : [brand.color, brand.bg, '#111111', '#FFFFFF']).slice(0, 4);
      const sw = (w - pad * 2 - pad * 0.3 * 3) / 4;
      const sh = h * 0.24;
      const ink = brand.ink || '#111111';
      return {
        layers: [
          text('Guía de marca', pad, pad, w - pad * 2, fs * 0.06, { fontSize: fs * 0.03, color: ink, fontWeight: 500, name: 'Etiqueta' }),
          text(brand.font || 'Inter', pad, pad + fs * 0.07, w - pad * 2, fs * 0.16, { fontSize: fs * 0.12, color: ink, fontFamily: brand.font || 'Inter', name: 'Tipografía' }),
          text('Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk\n0123456789', pad, pad + fs * 0.26, w - pad * 2, fs * 0.14, { fontSize: fs * 0.04, color: ink, fontFamily: brand.font || 'Inter', lineHeight: 1.4, letterSpacing: 0, name: 'Muestra' }),
          ...colors.map((c, i) => rect(pad + i * (sw + pad * 0.3), h - pad - sh, sw, sh, { fill: c, radius: radiusFor(w, h, 0.016), shadow: 'soft', name: c })),
          ...colors.map((c, i) => text(String(c).toUpperCase(), pad + i * (sw + pad * 0.3), h - pad - sh - fs * 0.05, sw, fs * 0.04, { fontSize: fs * 0.022, color: ink, letterSpacing: 0, name: `Código ${i + 1}` })),
        ],
      };
    },
  },
  {
    id: 'big-type',
    name: 'Titular grande',
    category: 'Marca',
    slots: [],
    build({ w, h, brand, project }) {
      const pad = Math.min(w, h) * 0.08;
      const fs = Math.min(w, h) * 0.11;
      return {
        layers: [
          text(project?.name || 'Nombre del proyecto', pad, h - pad - fs * 3.3, w - pad * 2, fs * 3.3, { fontSize: fs, color: brand.ink || '#111111', fontWeight: 500, lineHeight: 1, name: 'Titular' }),
        ],
      };
    },
  },
];

// Plantillas donde cada pantalla entra completa dentro de la imagen (nada se corta).
export const FULL_SCREEN_TEMPLATES = ['detail-zoom', 'bento', 'tramo', 'tramos-duo', 'tramos-trio', 'tramos-mobile', 'hero-float', 'browser-window', 'laptop', 'phone-single', 'mobile-duo', 'mobile-trio', 'mobile-flat', 'desktop-mobile', 'cascade', 'screens-duo', 'screens-grid', 'screen-trio'];

export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

// Orden de preferencia de roles cuando falta el rol exacto.
const ROLE_FALLBACK = {
  hero: ['hero', 'screen', 'section', 'page', 'video', 'photo', 'other'],
  screen: ['screen', 'hero', 'section', 'page', 'other'],
  section: ['section', 'screen', 'hero', 'page', 'other'],
  component: ['component', 'section', 'screen', 'hero', 'other'],
  page: ['page', 'section', 'hero', 'screen', 'other'],
  mobile: ['mobile', 'mobile-page', 'other'],
  'mobile-page': ['mobile-page', 'mobile', 'other'],
  tramo: ['tramo', 'section', 'page'],
  'tramo-mobile': ['tramo-mobile', 'mobile-page', 'mobile'],
};

// Elige assets para los slots de una plantilla. `usage` cuenta cuántas veces se usó cada
// asset en el set para dar variedad. `preferred` son assets ya asignados (re-aplicar plantilla).
// Clave de "contenido": todo lo que muestra el comienzo de una página (hero, mobile 1, tramo 1)
// cuenta como la misma pieza, para no repetir la portada en distintos formatos.
export function contentKey(a) {
  const url = (a.meta && a.meta.url) || a.file;
  const top = a.meta && typeof a.meta.top === 'number' ? a.meta.top : null;
  if (a.role === 'component' && a.meta && a.meta.sig) return `${(a.meta.url || '').replace(/\/[^/]*$/, '')}|comp|${a.meta.sig}`; // misma tarjeta = mismo contenido
  // Todo lo que arranca en el primer tramo de la página (hasta ~media pantalla) es la portada.
  if (a.role === 'hero' || (top !== null && top < 400)) return `${url}|inicio`;
  // Misma sección en distinto formato (vista, sección, tramo; mobile o tramo mobile) = mismo contenido.
  if (top !== null) return `${url}|${a.meta.viewport || ''}|${Math.round(top / 50)}`;
  return a.id;
}

// Elige assets para los slots de una plantilla. `usage` cuenta cuántas veces se usó cada
// contenido en el set para dar variedad. `preferred` son assets ya asignados (re-aplicar plantilla).
export function assignAssets(template, assets, usage = {}, preferred = []) {
  const chosen = [];
  const pool = assets.filter((a) => !a.hidden);
  template.slots.forEach((role, i) => {
    const pre = preferred[i] && pool.find((a) => a.id === preferred[i]);
    if (pre) {
      chosen.push(pre);
      return;
    }
    const roles = ROLE_FALLBACK[role] || [role];
    let best = null;
    let bestScore = Infinity;
    for (const a of pool) {
      const ri = roles.indexOf(a.role);
      if (ri === -1) continue;
      const key = contentKey(a);
      const already = chosen.some((c) => contentKey(c) === key) ? 50 : 0;
      const used = usage[key] || 0;
      const isStart = key.endsWith('|inicio');
      // Capturas propias antes que importadas; la portada de cada página pesa más al repetirse.
      // Penaliza capturas con mucho espacio vacío (más de un 30 % de filas lisas).
      // Penaliza capturas con mucho vacío (no a componentes: una tarjeta tiene aire por diseño) y el footer.
      const empty = (a.role === 'component' ? 0 : Math.max(0, (a.blank || 0) - 0.3) * 40) + (a.meta && a.meta.atEnd ? 18 : 0);
      const score = ri * 10 + used * (isStart ? 60 : 14) + already + empty + (a.source === 'import' ? 2.5 : 0) + (a.order || 0) * 0.002;
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    chosen.push(best || null);
  });
  chosen.forEach((a) => a && (usage[contentKey(a)] = (usage[contentKey(a)] || 0) + 1));
  return chosen;
}

export function templateNeeds(template, assets) {
  const missing = [];
  const has = (r) => assets.some((a) => a.role === r);
  if (template.slots.includes('mobile') && !has('mobile') && !has('mobile-page')) missing.push('capturas mobile');
  if (template.slots.includes('component') && !has('component')) missing.push('componentes (volvé a capturar la URL)');
  if (template.slots.includes('page') && !has('page')) missing.push('página completa');
  return missing;
}

// Aplica una plantilla a un frame (devuelve un frame nuevo, no muta).
export function applyTemplate(frame, templateId, project, usage = {}, keepAssets = true) {
  const t = TEMPLATE_BY_ID[templateId];
  if (!t) return frame;
  const preferred = keepAssets ? frame.layers.filter((l) => l.type === 'screen' || l.type === 'video').map((l) => l.asset) : [];
  const assets = assignAssets(t, project.assets, usage, preferred);
  const out = t.build({ w: frame.w, h: frame.h, assets, brand: project.brand || {}, project });
  return {
    ...frame,
    template: templateId,
    name: frame.name && frame.name !== 'Imagen' && frame.template === templateId ? frame.name : t.name,
    layers: out.layers,
    stage: out.stage || { rotate: 0, tiltX: 0, tiltY: 0, scale: 1, x: 0, y: 0 },
  };
}

// Secuencia sugerida para generar sets con variedad, según el formato del frame.
export function suggestTemplates(formatKey, count, assets, opts = {}) {
  const hasMobile = assets.some((a) => (a.role === 'mobile' || a.role === 'mobile-page') && !a.hidden);
  const many = assets.filter((a) => ['section', 'hero', 'screen'].includes(a.role) && !a.hidden).length;
  if (opts.full !== false) {
    const has = (r) => assets.some((a) => a.role === r && !a.hidden);
    // Solo pantallas completas: secuencia pensada por formato. Sin dispositivos, se priorizan tramos y pantallas planas.
    const byFmt = opts.devices === false
      ? {
          'wf-1': ['tramos-trio', 'screens-duo', 'tramos-mobile', 'screen-trio', 'hero-float', 'mobile-trio', 'screens-grid', 'tramos-duo'],
          'wf-2': ['tramo', 'mobile-duo', 'screens-duo', 'tramos-duo', 'hero-float', 'tramos-mobile', 'screen-trio', 'phone-single'],
          'wf-3': ['hero-float', 'tramo', 'mobile-duo', 'screens-duo'],
        }
      : {
          'wf-1': ['hero-float', 'desktop-mobile', 'screen-trio', 'mobile-trio', 'screens-duo', 'laptop', 'cascade', 'screens-grid', 'mobile-flat'],
          'wf-2': ['browser-window', 'mobile-duo', 'screens-duo', 'phone-single', 'screen-trio', 'hero-float', 'laptop'],
          'wf-3': ['hero-float', 'phone-single', 'browser-window', 'mobile-duo', 'laptop'],
        };
    const vertical = ['tramo', 'mobile-duo', 'screen-trio', 'tramos-mobile', 'screens-duo', 'mobile-trio', 'tramo', 'screens-grid', 'phone-single', 'tramos-duo'];
    let seqFull = byFmt[formatKey] || (opts.devices === false ? vertical : ['hero-float', 'mobile-trio', 'screens-duo', 'desktop-mobile', 'phone-single', 'screen-trio', 'browser-window', 'mobile-duo', 'laptop', 'screens-grid', 'cascade', 'mobile-flat']);
    if (opts.devices === false) seqFull = seqFull.filter((id) => !['laptop', 'browser-window', 'cascade', 'desktop-mobile'].includes(id));
    // Componentes sueltos: uno destacado; varios juntos solo si hay al menos 3 tipos distintos.
    const compKinds = new Set(assets.filter((a) => a.role === 'component' && !a.hidden).map((a) => (a.meta && a.meta.sig) || a.id)).size;
    // Componentes sueltos solo si se piden: en la práctica funcionan en pocos casos.
    if (opts.components === true && compKinds >= 1) {
      const at = Math.min(3, seqFull.length);
      seqFull = [...seqFull.slice(0, at), 'detail-zoom', ...seqFull.slice(at)];
      if (compKinds >= 3 && formatKey !== 'wf-3') seqFull.push('bento');
    }
    if (!has('tramo')) seqFull = seqFull.filter((id) => !id.startsWith('tramos-') && id !== 'tramo');
    if (!has('tramo-mobile')) seqFull = seqFull.filter((id) => id !== 'tramos-mobile');
    return seqFull.filter((id) => hasMobile || !TEMPLATE_BY_ID[id].slots.includes('mobile'));
  }
  let seq = byFormat[formatKey] || generic;
  seq = seq.filter((id) => {
    const t = TEMPLATE_BY_ID[id];
    if (!hasMobile && t.slots.includes('mobile')) return false;
    if (many < 5 && (id === 'mosaic' || id === 'mosaic-iso')) return false;
    const has = (r) => assets.some((a) => a.role === r && !a.hidden);
    if (!has('component') && (id === 'detail-zoom' || id === 'bento' || id === 'hero-overlap')) return false;
    if (!has('page') && (id === 'hero-bleed' || id === 'duo' || id === 'trio-stagger' || id === 'pages-iso' || id === 'full-bleed')) return false;
    return true;
  });
  return seq;
}
