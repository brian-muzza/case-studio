// Persistencia por caso: <casos>/<slug>/visual/studio.json + assets + exports.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import './env.mjs';
import { newProject, classifyAsset, uid } from '../shared/model.js';

const run = promisify(execFile);

// Carpeta de casos: config.local.json (casosDir) o la variable CASOS_DIR; por defecto ./casos.
export const CASOS_DIR = process.env.CASOS_DIR;

const IMG_EXT = /\.(png|jpe?g|webp|avif|gif)$/i;
const VID_EXT = /\.(mp4|mov|webm|m4v)$/i;

export const caseDir = (slug) => {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) throw new Error('slug inválido');
  return path.join(CASOS_DIR, slug);
};
export const visualDir = (slug) => path.join(caseDir(slug), 'visual');
const projectFile = (slug) => path.join(visualDir(slug), 'studio.json');

// Hash del último contenido escrito por el servidor, para distinguir cambios externos (chat).
export const lastWritten = new Map();
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');

// Resuelve una ruta relativa al caso sin permitir salir de la carpeta.
export function resolveInCase(slug, rel) {
  const base = caseDir(slug);
  const p = path.resolve(base, rel);
  if (!p.startsWith(base + path.sep)) throw new Error('ruta fuera del caso');
  return p;
}

function readFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*"?([^"#\n]*)"?/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

export function urlFromCaso(md) {
  const m = md.match(/Sitio[^\n]{0,40}?(https?:\/\/[^\s)\]»"`']+)/i) || md.match(/url[^\n]{0,10}?(https?:\/\/[^\s)\]»"`']+)/i);
  return m ? m[1].replace(/[.,;]+$/, '') : '';
}

function brandFromCaso(md) {
  const c = md.match(/[Cc]olor(?:-general)?[^#\n]{0,30}`?(#[0-9A-Fa-f]{6})/);
  return c ? { color: c[1].toUpperCase() } : {};
}

// Configuración del tablero (casos excluidos, URLs por caso, progreso del armado masivo).
const configFile = () => path.join(CASOS_DIR, '_case-studio.json');
export async function readConfig() {
  try {
    return JSON.parse(await fsp.readFile(configFile(), 'utf8'));
  } catch {
    return { excluded: [], urls: {}, batch: {} };
  }
}
export async function writeConfig(patch) {
  const cur = await readConfig();
  const next = { ...cur, ...patch };
  await fsp.writeFile(configFile(), JSON.stringify(next, null, 2));
  return next;
}

// Última versión de un tipo de set: el número más alto en el nombre (v3 > v2 > sin número).
export function latestSet(p, kind) {
  const sets = p.sets.filter((s) => s.kind === kind && s.frames.length);
  const ver = (s) => {
    const m = s.name.match(/v(\d+)\s*$/i);
    return m ? parseInt(m[1], 10) : 1;
  };
  return sets.sort((a, b) => ver(b) - ver(a) || p.sets.indexOf(b) - p.sets.indexOf(a))[0] || null;
}

export async function listCases() {
  const entries = await fsp.readdir(CASOS_DIR, { withFileTypes: true });
  const cfg = await readConfig();
  cfg.excluded ||= [];
  cfg.urls ||= {};
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
    const dir = path.join(CASOS_DIR, e.name);
    const mdPath = path.join(dir, 'caso.md');
    if (!fs.existsSync(mdPath)) continue;
    const md = await fsp.readFile(mdPath, 'utf8');
    const fm = readFrontmatter(md);
    let frames = 0;
    let assets = 0;
    let status = 'pendiente';
    let latest = {};
    if (fs.existsSync(path.join(dir, 'visual', 'studio.json'))) {
      try {
        const p = JSON.parse(await fsp.readFile(path.join(dir, 'visual', 'studio.json'), 'utf8'));
        frames = p.sets.reduce((n, s) => n + s.frames.length, 0);
        assets = p.assets.filter((a) => !a.hidden).length;
        status = p.status || 'pendiente';
        for (const k of ['webflow', 'instagram']) {
          const ls = latestSet(p, k);
          if (ls) latest[k] = { id: ls.id, name: ls.name, frames: ls.frames.length };
        }
      } catch {}
    }
    if (cfg.excluded.includes(e.name)) continue;
    out.push({ slug: e.name, name: fm.cliente || e.name, url: (cfg.urls[e.name] && cfg.urls[e.name][0]) || urlFromCaso(md), status, latest, estado: fm.estado || '', partner: fm.partner || '', frames, assets, hasStudio: frames + assets > 0 });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// Proporción de filas "vacías" (casi de un solo color). Sirve para evitar capturas con mucho blanco.
export async function measureBlank(absPath) {
  const { data, info } = await sharp(absPath, { limitInputPixels: false }).resize({ width: 120 }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let blank = 0;
  for (let y = 0; y < info.height; y++) {
    let min = 255;
    let max = 0;
    for (let x = 0; x < info.width; x++) {
      const v = data[y * info.width + x];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min < 12) blank++;
  }
  return Math.round((blank / info.height) * 100) / 100;
}

export async function probeAsset(absPath) {
  if (VID_EXT.test(absPath)) {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', absPath]);
    const j = JSON.parse(stdout);
    return { kind: 'video', w: j.streams[0].width, h: j.streams[0].height, duration: parseFloat(j.format.duration) || 0 };
  }
  const m = await sharp(absPath, { limitInputPixels: false }).metadata();
  return { kind: 'image', w: m.width, h: m.height };
}

function guessRole(name, info) {
  const n = name.toLowerCase();
  if (info.kind === 'video') return 'video';
  if (/logo/.test(n)) return 'logo';
  if (/background|fondo|foto/.test(n)) return 'photo';
  if (/pantalla|hero/.test(n) && !/raw/.test(n)) return 'hero';
  if (/mobile|movil|móvil|celu/.test(n)) return info.h / info.w > 3 ? 'mobile-page' : 'mobile';
  if (/full|completa|page/.test(n)) return 'page';
  return classifyAsset(info.w, info.h, info.kind);
}

export async function makeAsset(slug, rel, extra = {}) {
  const abs = resolveInCase(slug, rel);
  const info = await probeAsset(abs);
  const name = path.basename(rel);
  const asset = {
    id: uid('a'),
    file: rel,
    kind: info.kind,
    w: info.w,
    h: info.h,
    ...(info.duration ? { duration: info.duration } : {}),
    role: extra.role || guessRole(name, info),
    label: extra.label || name.replace(/\.[^.]+$/, ''),
    source: extra.source || 'import',
    meta: extra.meta || {},
    addedAt: new Date().toISOString(),
  };
  if (info.kind === 'video') asset.poster = await videoPoster(slug, rel);
  else asset.blank = await measureBlank(abs).catch(() => 0);
  return asset;
}

async function videoPoster(slug, rel) {
  const abs = resolveInCase(slug, rel);
  const posterRel = rel.replace(/\.[^.]+$/, '') + '.poster.jpg';
  const posterAbs = resolveInCase(slug, posterRel);
  // Clips de animación o de carga: el último cuadro (todo ya visible). Scrolls y grabaciones: el arranque.
  if (/\/anim-/.test(rel)) {
    await run('ffmpeg', ['-y', '-v', 'error', '-sseof', '-0.1', '-i', abs, '-frames:v', '1', '-q:v', '3', posterAbs]).catch(() => {});
    if (fs.existsSync(posterAbs)) return posterRel;
  }
  if (!fs.existsSync(posterAbs)) {
    await run('ffmpeg', ['-y', '-v', 'error', '-ss', '0.5', '-i', abs, '-frames:v', '1', '-q:v', '3', posterAbs]).catch(() =>
      run('ffmpeg', ['-y', '-v', 'error', '-i', abs, '-frames:v', '1', '-q:v', '3', posterAbs]),
    );
  }
  return posterRel;
}

// Importa lo que ya existe en la carpeta del caso (caso-imagenes, sitio, antes, figma).
async function importExisting(slug) {
  const dir = caseDir(slug);
  const assets = [];
  for (const sub of ['caso-imagenes', 'sitio', 'antes', 'figma']) {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) continue;
    const files = (await fsp.readdir(d)).filter((f) => (IMG_EXT.test(f) || VID_EXT.test(f)) && !f.includes('.poster.')).sort();
    for (const f of files) {
      try {
        const a = await makeAsset(slug, `${sub}/${f}`, { source: 'import' });
        if (/cover-preview|raw/.test(f)) a.hidden = true; // composiciones previas o capturas sin recortar
        assets.push(a);
      } catch (e) {
        console.warn('[import]', f, e.message);
      }
    }
  }
  return assets;
}

export async function loadProject(slug) {
  const file = projectFile(slug);
  if (fs.existsSync(file)) {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  }
  const md = await fsp.readFile(path.join(caseDir(slug), 'caso.md'), 'utf8').catch(() => '');
  const fm = readFrontmatter(md);
  const p = newProject(slug, fm.cliente || slug, brandFromCaso(md));
  p.url = urlFromCaso(md);
  p.assets = await importExisting(slug);
  await saveProject(slug, p);
  return p;
}

export async function saveProject(slug, data) {
  await fsp.mkdir(visualDir(slug), { recursive: true });
  data.updatedAt = new Date().toISOString();
  const json = JSON.stringify(data, null, 2);
  const file = projectFile(slug);
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, json);
  await fsp.rename(tmp, file);
  lastWritten.set(slug, hash(json));
  return data;
}

export async function readProjectRaw(slug) {
  const raw = await fsp.readFile(projectFile(slug), 'utf8');
  return { raw, hash: hash(raw) };
}

export const projectPath = projectFile;

// Guarda un archivo subido en visual/assets. Videos .mov/.webm se transcodifican a mp4 H.264.
export async function storeUpload(slug, filename, buffer) {
  const dir = path.join(visualDir(slug), 'assets');
  await fsp.mkdir(dir, { recursive: true });
  const safe = filename.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+/, '') || 'archivo';
  const stamp = Date.now().toString(36);
  let rel = `visual/assets/up-${stamp}-${safe}`;
  await fsp.writeFile(resolveInCase(slug, rel), buffer);
  if (VID_EXT.test(safe)) {
    const out = rel.replace(/\.[^.]+$/, '') + '.h264.mp4';
    await run('ffmpeg', [
      '-y', '-v', 'error', '-i', resolveInCase(slug, rel),
      '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-vf', "scale='min(2880,iw)':-2", '-movflags', '+faststart', resolveInCase(slug, out),
    ]);
    await fsp.unlink(resolveInCase(slug, rel));
    rel = out;
  }
  return rel;
}

// Miniaturas cacheadas para el editor (las exportaciones usan los originales).
export async function thumbnail(slug, rel, width) {
  const abs = resolveInCase(slug, rel);
  const stat = await fsp.stat(abs);
  const key = hash(`${rel}|${width}|${stat.mtimeMs}`);
  const cacheDir = path.join(visualDir(slug), '.cache');
  const out = path.join(cacheDir, `${key}.webp`);
  if (fs.existsSync(out)) return out;
  await fsp.mkdir(cacheDir, { recursive: true });
  await sharp(abs, { limitInputPixels: false })
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(out);
  return out;
}
