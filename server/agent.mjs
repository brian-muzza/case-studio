// Herramientas para el agente (CLI: video, analyze, featured). No necesitan el servidor.
// analyze y featured corren dentro del daemon (agent-daemon.mjs), que mantiene la página abierta.
//
//   analyze   abre la página y guarda la captura completa (page.png), el árbol de
//             accesibilidad con refs y cajas (page.yml) y las cajas de cada ref (page.json).
//   featured  saca un screenshot de cada sección destacada, elegida por su ref del YAML, sobre la
//             misma página que dejó abierta analyze.
//   video     graba la pantalla en tiempo real (page.screencast) mientras la página baja sola.
//             Corre en su propio proceso, en paralelo con analyze/featured.
//
// Salida: capturas/<sitio>/<web|mobile>/{page.png,page.yml,page.json,featured/}
//         capturas/<sitio>/screen-record/<web|mobile>.mp4
import './env.mjs';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { ROOT } from './env.mjs';
import { launchBrowser } from './browser.mjs';
import { open } from './capture.mjs';

const run = promisify(execFile);
const TILE_PX = 8000; // alto máximo de cada captura parcial en píxeles reales (Chromium falla cerca de 16 384)
const WEBP_MAX = 16383;

export const VIEWPORTS = {
  web: { width: 1440, height: 900, dpr: 2, speed: 420 },
  mobile: {
    width: 390, height: 844, dpr: 3, speed: 340, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
};

export function normalizeUrl(url) {
  if (!url) throw new Error('Falta la URL');
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

// capturas/<host-y-ruta>: la misma URL siempre cae en la misma carpeta.
export function siteDir(url, base = path.join(ROOT, 'capturas')) {
  const u = new URL(normalizeUrl(url));
  const name = (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '')).replace(/[^a-z0-9.]+/gi, '-').toLowerCase();
  return path.join(base, name);
}

function viewportOf(kind, opts = {}) {
  const v = VIEWPORTS[kind];
  if (!v) throw new Error(`Viewport desconocido: ${kind} (web o mobile)`);
  return { ...v, width: opts.width || v.width, height: opts.height || v.height, dpr: opts.dpr || v.dpr };
}

function newContext(browser, v, dpr) {
  return browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: dpr,
    ...(v.isMobile ? { isMobile: true, hasTouch: true, userAgent: v.userAgent } : {}),
  });
}

// El YAML en modo "ai" parte los textos animados letra por letra (un nodo aria-hidden por carácter):
// eso no le sirve al agente y triplica el archivo. Las refs siguen en page.json.
function compactYaml(yaml) {
  return yaml
    .split('\n')
    .filter((l) => !/^\s*- generic \[aria-hidden\] \[ref=e\d+\][^:]*: ("?.{1,2}"?)$/.test(l))
    .join('\n');
}

// Por ref: caja (px CSS de la página) y firma = la línea del YAML sin ref, caja ni cursor
// (rol, nombre y texto). La firma sirve para reubicar la ref en otra carga de la página.
function parseRefs(yaml, scrollY = 0) {
  const refs = {};
  for (const line of yaml.split('\n')) {
    const r = line.match(/\[ref=(e\d+)\]/);
    const b = line.match(/\[box=(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+)\]/);
    if (!r || !b) continue;
    const sig = line.trim().replace(/^- /, '').replace(/\s*\[(ref|box|cursor)=[^\]]*\]|\s*\[active\]/g, '').replace(/:$/, '').trim();
    refs[r[1]] = { box: [+b[1], +b[2] + scrollY, +b[3], +b[4]], sig };
  }
  return refs;
}

// Una sesión es una página abierta por URL y viewport. La guarda el daemon (agent-daemon.mjs)
// entre analyze y featured: featured usa la misma página y el mismo snapshot que vio el agente.
export const sessionKey = (url, kind) => `${normalizeUrl(url)}|${kind}`;

export async function closeSession(sessions, key) {
  const s = sessions.get(key);
  sessions.delete(key);
  await s?.ctx.close().catch(() => {});
}

/**
 * Captura completa + YAML con refs y cajas. La captura se hace en tramos (cada uno entra en el
 * límite de Chromium) y se une con sharp, así siempre queda a la resolución pedida.
 * La página queda abierta en `sessions` para featured.
 */
export async function analyze(browser, sessions, url, kind = 'web', opts = {}, log = () => {}) {
  url = normalizeUrl(url);
  const v = viewportOf(kind, opts);
  const dir = path.join(siteDir(url, opts.out), kind);
  await fsp.mkdir(dir, { recursive: true });
  const key = sessionKey(url, kind);
  await closeSession(sessions, key); // analizar de nuevo es empezar de cero
  const ctx = await newContext(browser, v, v.dpr);
  try {
    log(`Abriendo ${url} (${kind} ${v.width}×${v.height} @${v.dpr}x)`);
    const page = await open(ctx, url, opts);
    await page.evaluate(() => window.scrollTo(0, 0));
    const docH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0));
    const W = v.width;
    const step = Math.floor(TILE_PX / v.dpr);
    const tiles = [];
    for (let y = 0; y < docH; y += step) {
      const h = Math.min(step, docH - y);
      tiles.push({ input: await page.screenshot({ clip: { x: 0, y, width: W, height: h }, fullPage: true }), top: Math.round(y * v.dpr), left: 0 });
    }
    // Inmediatamente después de la captura: las cajas tienen que coincidir con la imagen.
    const scrollY = await page.evaluate(() => window.scrollY);
    const yaml = await page.ariaSnapshot({ mode: 'ai', boxes: true, timeout: 60000 });
    const title = await page.title();
    const refs = parseRefs(yaml, scrollY);
    // aligned: el último snapshot de la página es el de page.yml, así que las refs valen tal cual.
    sessions.set(key, { ctx, page, refs, aligned: true });

    log(`Uniendo ${tiles.length} tramo(s)`);
    const pngW = Math.round(W * v.dpr);
    const pngH = Math.round(docH * v.dpr);
    const png = path.join(dir, 'page.png');
    await sharp({ create: { width: pngW, height: pngH, channels: 3, background: '#ffffff' }, limitInputPixels: false })
      .composite(tiles)
      .png({ compressionLevel: 3 })
      .toFile(png);
    await fsp.writeFile(path.join(dir, 'page.yml'), compactYaml(yaml));
    const meta = { url, kind, title, capturedAt: new Date().toISOString(), viewport: { width: v.width, height: v.height }, dpr: v.dpr, page: { width: W, height: docH }, image: { width: pngW, height: pngH }, refs };
    await fsp.writeFile(path.join(dir, 'page.json'), JSON.stringify(meta));
    return { dir, png, yml: path.join(dir, 'page.yml'), json: path.join(dir, 'page.json'), page: meta.page, refs: Object.keys(refs).length };
  } catch (e) {
    await closeSession(sessions, key);
    await ctx.close().catch(() => {});
    throw e;
  }
}

const isBox = (pos) => /^-?[\d.]+,-?[\d.]+,[\d.]+,[\d.]+$/.test(pos);

function unionBox(boxes) {
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

// Margen, ancho completo y recorte a los bordes de la página.
function fitBox([x, y, w, h], size, { pad = 0, fullWidth = false } = {}, pos = '') {
  if (fullWidth) [x, w] = [0, size.width];
  x = Math.max(0, x - pad);
  y = Math.max(0, y - pad);
  w = Math.min(size.width - x, w + pad * 2);
  h = Math.min(size.height - y, h + pad * 2);
  if (w < 1 || h < 1) throw new Error(`La posición ${pos} queda fuera de la página o no tiene tamaño`);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/**
 * Screenshots de las secciones destacadas, con Playwright sobre la página que dejó abierta analyze.
 * Posiciones:
 *   e45          el elemento con ref e45 del YAML
 *   e45+e60      la caja que cubre a todos (por ejemplo, título + grilla de una sección)
 *   x,y,w,h      caja explícita en px CSS de la página
 * opts: { pad, fullWidth, format: 'webp'|'png'|'jpg', append, hide }
 *
 * Con la sesión de analyze abierta, las refs son exactamente las de page.yml. Si no hay sesión
 * (el daemon se cerró) o una ref dejó de responder, se toma otro snapshot y cada ref se busca por
 * su firma (rol, nombre, texto) y su caja en page.json: las refs cambian entre una carga y otra.
 */
export async function featured(browser, sessions, url, kind = 'web', positions = [], opts = {}, log = () => {}) {
  url = normalizeUrl(url);
  const dir = path.join(siteDir(url, opts.out), kind);
  const jsonFile = path.join(dir, 'page.json');
  if (!fs.existsSync(jsonFile)) throw new Error(`No hay análisis para ${url} (${kind}). Corré primero: analyze ${url} ${kind}`);
  const meta = JSON.parse(await fsp.readFile(jsonFile, 'utf8'));
  if (!positions.length) throw new Error('Faltan posiciones (refs del YAML, e45+e60 o x,y,w,h)');
  // Se validan todas antes de sacar capturas: un ref mal escrito no deja una tanda a medias.
  const parsed = positions.map((pos) => (isBox(pos) ? { pos, box: pos.split(',').map(Number) } : { pos, refs: pos.split('+').map((r) => r.trim()) }));
  for (const p of parsed) for (const r of p.refs || []) if (!meta.refs[r]) throw new Error(`No existe el ref ${r} en page.yml (¿corriste analyze con la misma URL y viewport?)`);

  const key = sessionKey(url, kind);
  let s = sessions.get(key);
  if (!s || s.page.isClosed()) {
    // Mismo viewport y densidad que el análisis: las refs y las cajas tienen que corresponder.
    log('No hay sesión abierta de analyze: abro la página de nuevo y reubico las refs');
    const v = { ...viewportOf(kind), width: meta.viewport.width, height: meta.viewport.height };
    const ctx = await newContext(browser, v, meta.dpr);
    s = { ctx, page: await open(ctx, url, opts), refs: null, aligned: false };
    sessions.set(key, s);
  }
  const { page } = s;
  const realign = async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const scrollY = await page.evaluate(() => window.scrollY);
    s.refs = parseRefs(await page.ariaSnapshot({ mode: 'ai', boxes: true, timeout: 60000 }), scrollY);
    s.aligned = false;
  };
  if (!s.aligned && !s.refs) await realign();
  // Muchas firmas son solo "generic": decide la caja más parecida; la misma ref desempata.
  const locate = (ref) => {
    if (s.aligned) return ref;
    const old = meta.refs[ref];
    const d = ([id, n]) => n.box.reduce((acc, x, i) => acc + Math.abs(x - old.box[i]), 0) - (id === ref ? 40 : 0);
    const best = Object.entries(s.refs).filter(([, n]) => n.sig === old.sig).sort((a, b) => d(a) - d(b))[0];
    if (!best) throw new Error(`El ref ${ref} («${old.sig}») ya no está en la página. Corré analyze de nuevo.`);
    return best[0];
  };
  // Caja en vivo del elemento, en coordenadas de la página.
  const rectOf = (ref) =>
    page.getByRef(ref).evaluate((el) => {
      const b = el.getBoundingClientRect();
      return [b.x + window.scrollX, b.y + window.scrollY, b.width, b.height];
    }, null, { timeout: 5000 });

  const size = await page.evaluate(() => ({ width: window.innerWidth, height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) }));
  const jobs = [];
  for (const p of parsed) {
    let box = p.box;
    const used = [];
    if (p.refs) {
      const rects = [];
      for (const r of p.refs) {
        let nr = locate(r);
        let rect;
        try {
          rect = await rectOf(nr);
        } catch (e) {
          if (!s.aligned) throw e;
          // La página cambió (navegó o rehízo el DOM): de acá en más se reubica por firma.
          log(`La ref ${r} ya no responde: tomo otro snapshot y reubico`);
          await realign();
          nr = locate(r);
          rect = await rectOf(nr);
        }
        used.push(nr === r ? r : `${r}→${nr}`);
        rects.push(rect);
      }
      box = unionBox(rects);
    }
    jobs.push({ pos: p.pos, used, ...fitBox(box, size, opts, p.pos) });
  }

  const outDir = path.join(dir, 'featured');
  // Cada llamada es la tanda completa de destacadas; con append se suman a las anteriores.
  if (!opts.append) await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.mkdir(outDir, { recursive: true });
  const first = (await fsp.readdir(outDir)).filter((f) => /^\d+-/.test(f)).length;
  const out = [];
  for (const [i, j] of jobs.entries()) {
    // Clip sobre la página completa (como en capture.mjs): los encabezados fijos no tapan la sección.
    // Las muy altas van a 1x para no pasar el límite de Chromium.
    const tall = j.h * meta.dpr > 15000;
    const buf = await page.screenshot({ fullPage: true, clip: { x: j.x, y: j.y, width: j.w, height: j.h }, scale: tall ? 'css' : 'device' });
    const { width, height } = await sharp(buf).metadata();
    let format = opts.format || 'webp';
    if (format === 'webp' && Math.max(width, height) > WEBP_MAX) format = 'jpg'; // límite de WebP
    const file = path.join(outDir, `${String(first + i + 1).padStart(2, '0')}-${j.pos.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.${format}`);
    const img = sharp(buf, { limitInputPixels: false });
    if (format === 'png') await img.png().toFile(file);
    else if (format === 'jpg') await img.jpeg({ quality: 92, mozjpeg: true }).toFile(file);
    else await img.webp({ quality: 92 }).toFile(file);
    out.push({ file, pos: j.pos, refs: j.used, box: [j.x, j.y, j.w, j.h], w: width, h: height });
  }
  return { files: out, session: s.aligned ? 'analyze' : 'reubicada' };
}

/**
 * Grabación real de la pantalla: page.screencast graba mientras la página baja sola con
 * requestAnimationFrame (arranque y frenada suaves). Empieza recién con la página cargada,
 * así el video no tiene la carga. El WebM de Playwright se pasa a MP4 H.264.
 */
export async function video(url, kind = 'web', opts = {}, log = () => {}) {
  url = normalizeUrl(url);
  const v = viewportOf(kind, opts);
  const dir = path.join(siteDir(url, opts.out), 'screen-record');
  await fsp.mkdir(dir, { recursive: true });
  const webm = path.join(dir, `${kind}.webm`);
  const mp4 = path.join(dir, `${kind}.mp4`);
  const fps = opts.fps || 30;
  const { holdStart = 0.9, holdEnd = 1.2, maxSeconds = 40 } = opts;
  const browser = await launchBrowser();
  let seconds;
  try {
    // Video a 1x: el screencast entrega cuadros del tamaño del viewport.
    const ctx = await newContext(browser, v, 1);
    log(`Abriendo ${url} (${kind} ${v.width}×${v.height})`);
    const page = await open(ctx, url, opts);
    // Sin scroll suave del sitio: la página la movemos nosotros.
    await page.addStyleTag({ content: 'html, body { scroll-behavior: auto !important; }' });
    await page.evaluate(() => {
      try {
        window.lenis?.stop?.();
        window.lenis?.destroy?.();
      } catch {}
      document.documentElement.classList.remove('lenis-smooth');
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(400);
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    const distance = Math.max(0, docH - v.height);
    const speed = opts.speed || v.speed;
    const moveMs = Math.round(1000 * Math.min(maxSeconds - holdStart - holdEnd, Math.max(2, distance / speed)));
    seconds = holdStart + moveMs / 1000 + holdEnd;
    log(`Grabando ${seconds.toFixed(1)} s (${distance} px)`);
    await page.screencast.start({ path: webm, size: { width: v.width, height: v.height }, fps, quality: 90 });
    await page.waitForTimeout(holdStart * 1000);
    await page.evaluate(
      ({ distance, moveMs }) =>
        new Promise((resolve) => {
          const ease = (t) => 0.5 - Math.cos(Math.PI * t) / 2;
          const t0 = performance.now();
          const tick = (now) => {
            const t = Math.min(1, (now - t0) / moveMs);
            window.scrollTo(0, Math.round(ease(t) * distance));
            if (t < 1) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        }),
      { distance, moveMs },
    );
    await page.waitForTimeout(holdEnd * 1000);
    await page.screencast.stop();
    await ctx.close();
  } finally {
    await browser.close();
  }
  log('Pasando a MP4');
  // Se escribe aparte y se renombra: quien espera el .mp4 nunca lo ve a medias.
  const tmp = mp4.replace(/\.mp4$/, '.tmp.mp4');
  await run('ffmpeg', ['-y', '-v', 'error', '-i', webm, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', tmp]);
  await fsp.rename(tmp, mp4);
  if (!opts.keepWebm) await fsp.rm(webm, { force: true });
  return { file: mp4, seconds, width: v.width, height: v.height, fps };
}
