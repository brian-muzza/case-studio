// Modelo de datos de Case Studio. Lo comparten el editor (React), el servidor y el CLI.
// Todas las medidas de un frame están en píxeles de salida (el PNG exportado mide w × h).

export const FORMATS = {
  'wf-1': { label: 'Webflow · fila de 1', short: 'WF 1', w: 1694, h: 1292, group: 'Webflow' },
  'wf-2': { label: 'Webflow · fila de 2 (≈1:1)', short: 'WF 2', w: 838, h: 830, group: 'Webflow' },
  'wf-3': { label: 'Webflow · fila de 3', short: 'WF 3', w: 552, h: 478, group: 'Webflow' },
  'sq-1x1': { label: 'Cuadrado 1:1', short: '1:1', w: 1600, h: 1600, group: 'Webflow' },
  'ig-1x1': { label: 'Instagram 1:1', short: 'IG 1:1', w: 1080, h: 1080, group: 'Instagram' },
  'ig-4x5': { label: 'Instagram 4:5', short: 'IG 4:5', w: 1080, h: 1350, group: 'Instagram' },
  'ig-3x4': { label: 'Instagram 3:4', short: 'IG 3:4', w: 1080, h: 1440, group: 'Instagram' },
  'story-9x16': { label: 'Vertical 9:16', short: '9:16', w: 1080, h: 1920, group: 'Instagram' },
  'land-16x9': { label: 'Horizontal 16:9', short: '16:9', w: 1920, h: 1080, group: 'Horizontal' },
  'land-4x3': { label: 'Horizontal 4:3', short: '4:3', w: 1600, h: 1200, group: 'Horizontal' },
  'land-3x2': { label: 'Horizontal 3:2', short: '3:2', w: 1800, h: 1200, group: 'Horizontal' },
  cover: { label: 'Pantalla del CMS (1440 × 857)', short: 'Cover', w: 2880, h: 1714, group: 'Horizontal' },
};

// Columnas de la galería del template de caso en Webflow → formato que conviene exportar.
export const GRID_COLUMN_FORMAT = { 1: 'wf-1', 2: 'wf-2', 3: 'wf-3' };

// Ancho de cada celda en la plantilla de Webflow (px CSS), para la vista de grilla.
export const WEBFLOW_GALLERY = { width: 847, gap: 9, cells: { 1: [847, 646], 2: [419, 415], 3: [276, 239] } };

export const SHADOWS = {
  none: { label: 'Sin sombra', css: 'none' },
  soft: { label: 'Suave', css: '0 18px 50px -12px rgba(10,12,20,.22), 0 4px 14px -6px rgba(10,12,20,.12)' },
  subtle: { label: 'Sutil (filete)', css: '0 0 0 1px rgba(10,12,20,.08), 0 1px 2px rgba(10,12,20,.06)' },
  medium: { label: 'Media', css: '0 30px 80px -20px rgba(10,12,20,.35), 0 10px 24px -10px rgba(10,12,20,.2)' },
  strong: { label: 'Fuerte', css: '0 50px 120px -24px rgba(5,6,12,.55), 0 18px 40px -16px rgba(5,6,12,.35)' },
  long: { label: 'Larga', css: '0 80px 160px -40px rgba(5,6,12,.45)' },
  glow: { label: 'Brillo', css: '0 0 0 1px rgba(255,255,255,.08), 0 30px 90px -10px rgba(255,255,255,.18)' },
};

export const DEVICES = {
  none: { label: 'Sin marco' },
  browser: { label: 'Navegador' },
  phone: { label: 'Celular' },
  laptop: { label: 'Laptop' },
};

export const FONTS = {
  Inter: "'Inter', system-ui, sans-serif",
  'Instrument Serif': "'Instrument Serif', Georgia, serif",
  'Space Grotesk': "'Space Grotesk', system-ui, sans-serif",
  'DM Sans': "'DM Sans', system-ui, sans-serif",
  Fraunces: "'Fraunces', Georgia, serif",
  Sistema: 'system-ui, -apple-system, sans-serif',
};

// Roles de asset: ayudan a que las plantillas elijan la captura correcta.
export const ASSET_ROLES = {
  hero: 'Hero desktop (primera pantalla)',
  screen: 'Pantalla desktop (vista)',
  section: 'Sección desktop completa',
  component: 'Componente',
  tramo: 'Tramo vertical desktop (varias secciones)',
  'tramo-mobile': 'Tramo vertical mobile',
  page: 'Página completa desktop',
  mobile: 'Pantalla mobile',
  'mobile-page': 'Página completa mobile',
  photo: 'Foto / fondo',
  logo: 'Logo',
  video: 'Video (grabación)',
  other: 'Otro',
};

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export function defaultBackground(brand = {}) {
  return {
    type: 'color', // color | gradient | image
    color: brand.bg || '#EEEDE8',
    color2: brand.color || '#1E1E24',
    angle: 160,
    image: null, // id de asset
    blur: 60, // px
    imageScale: 1.15,
    brightness: 1,
    saturation: 1,
    distort: 0, // ondulado tipo ripple (0 a 100)
    grain: 0, // 0 a 100
    overlay: { color: '#000000', opacity: 0 },
  };
}

export function defaultStage() {
  return { rotate: 0, tiltX: 0, tiltY: 0, scale: 1, x: 0, y: 0 };
}

export function newFrame(format = 'wf-2', brand = {}) {
  const f = FORMATS[format] || FORMATS['wf-2'];
  return {
    id: uid('f'),
    name: 'Imagen',
    format,
    w: f.w,
    h: f.h,
    template: null,
    alt: '',
    background: defaultBackground(brand),
    stage: defaultStage(),
    layers: [],
  };
}

export function newProject(slug, name, brand = {}) {
  return {
    version: 1,
    slug,
    name: name || slug,
    brand: { color: brand.color || '#1E1E24', bg: brand.bg || '#EEEDE8', accent: brand.accent || '#FFFFFF', font: 'Inter' },
    assets: [],
    sets: [
      { id: uid('s'), name: 'Webflow', kind: 'webflow', grilla: '2,1,2,3', format: 'wf-2', frames: [] },
      { id: uid('s'), name: 'Instagram', kind: 'instagram', grilla: '', format: 'ig-4x5', frames: [] },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function parseGrilla(str) {
  const nums = String(str || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => n >= 1 && n <= 3);
  return nums.length ? nums : [2, 1, 2, 3, 1, 2];
}

// Reparte una lista de frames en filas según el patrón de grilla de Webflow (se repite).
export function gridRows(frames, grilla) {
  const pattern = parseGrilla(grilla);
  const rows = [];
  let i = 0;
  let p = 0;
  while (i < frames.length) {
    const cols = pattern[p % pattern.length];
    rows.push({ cols, frames: frames.slice(i, i + cols) });
    i += cols;
    p++;
  }
  return rows;
}

// Formato que le corresponde a cada posición de la grilla.
export function gridFormats(count, grilla) {
  const pattern = parseGrilla(grilla);
  const out = [];
  let p = 0;
  while (out.length < count) {
    const cols = pattern[p % pattern.length];
    for (let c = 0; c < cols && out.length < count; c++) out.push(GRID_COLUMN_FORMAT[cols]);
    p++;
  }
  return out;
}

export function classifyAsset(w, h, kind = 'image') {
  if (kind === 'video') return 'video';
  const ratio = h / w;
  if (w <= 1300 && ratio > 1.5) return ratio > 3 ? 'mobile-page' : 'mobile';
  if (ratio > 1.6) return 'page';
  return 'section';
}
