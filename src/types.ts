export type Role = 'hero' | 'screen' | 'component' | 'tramo' | 'tramo-mobile' | 'section' | 'page' | 'mobile' | 'mobile-page' | 'photo' | 'logo' | 'video' | 'other';

export interface Asset {
  id: string;
  file: string; // relativo a la carpeta del caso
  kind: 'image' | 'video';
  w: number;
  h: number;
  duration?: number;
  poster?: string;
  role: Role;
  label: string;
  source: 'capture' | 'upload' | 'import';
  meta?: Record<string, unknown>;
  hidden?: boolean;
  order?: number;
}

export interface Background {
  type: 'color' | 'gradient' | 'image';
  color: string;
  color2: string;
  angle: number;
  image: string | null;
  blur: number;
  imageScale: number;
  brightness: number;
  saturation: number;
  distort: number;
  grain: number;
  overlay: { color: string; opacity: number };
}

export interface Stage {
  rotate: number;
  tiltX: number;
  tiltY: number;
  scale: number;
  x: number;
  y: number;
}

interface LayerBase {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  opacity: number;
  hidden?: boolean;
  locked?: boolean;
}

export interface ScreenLayer extends LayerBase {
  type: 'screen' | 'video';
  asset: string | null;
  radius: number;
  shadow: string;
  device: 'none' | 'browser' | 'phone' | 'laptop';
  deviceTone: 'light' | 'dark';
  cropX: number;
  cropY: number;
  zoom: number;
  border: boolean;
  start?: number;
  duration?: number;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
}

export interface RectLayer extends LayerBase {
  type: 'rect';
  fill: string;
  radius: number;
  shadow: string;
}

export type Layer = ScreenLayer | TextLayer | RectLayer;

export interface FrameComment {
  id: string;
  text: string;
  at: string;
  done?: boolean;
}

export interface Frame {
  id: string;
  comments?: FrameComment[];
  name: string;
  format: string;
  w: number;
  h: number;
  template: string | null;
  alt: string;
  background: Background;
  stage: Stage;
  layers: Layer[];
}

export interface FrameSet {
  id: string;
  name: string;
  kind: 'webflow' | 'instagram' | 'libre';
  grilla: string;
  format: string;
  frames: Frame[];
}

export interface Brand {
  color: string;
  bg: string;
  accent: string;
  font?: string;
  ink?: string;
  palette?: string[];
}

export interface Project {
  version: number;
  slug: string;
  name: string;
  url?: string;
  status?: string;
  brand: Brand;
  assets: Asset[];
  sets: FrameSet[];
  updatedAt?: string;
}

export interface CaseInfo {
  slug: string;
  name: string;
  url: string;
  estado: string;
  partner: string;
  frames: number;
  assets: number;
  hasStudio: boolean;
  status?: string;
  latest?: Record<string, { id: string; name: string; frames: number }>;
}

// Marca del estudio que usa la herramienta (en <casos>/_case-studio.json, clave "marca").
export interface StudioBrand {
  nombre?: string;
  usuario?: string;
}
