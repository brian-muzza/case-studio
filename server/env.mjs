// Se importa primero: resuelve dónde están los casos y dónde van los temporales pesados.
// La configuración de cada instalación vive en config.local.json (no se versiona; ver config.example.json).
// Variables de entorno, si están, tienen prioridad: CASOS_DIR y CASE_STUDIO_CACHE.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_FILE = path.join(ROOT, 'config.local.json');

function readLocalConfig() {
  if (!fs.existsSync(LOCAL_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`config.local.json no es un JSON válido: ${error.message}`);
  }
}

export const LOCAL_CONFIG = readLocalConfig();
const fromRoot = (p) => (p ? path.resolve(ROOT, p) : null);

process.env.CASOS_DIR ||= fromRoot(LOCAL_CONFIG.casosDir) || path.join(ROOT, 'casos');

// Caché opcional (por ejemplo, un disco externo): temporales de Chrome/ffmpeg y navegadores de Playwright.
const cache = process.env.CASE_STUDIO_CACHE || fromRoot(LOCAL_CONFIG.cacheDir);
if (cache && fs.existsSync(cache)) {
  process.env.CASE_STUDIO_CACHE = cache;
  const tmp = path.join(cache, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  process.env.TMPDIR = process.env.TMPDIR_CASE_STUDIO || tmp;
  const browsers = path.join(cache, 'ms-playwright');
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
}
