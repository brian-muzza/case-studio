// Exportación: renderiza cada frame con el mismo componente del editor (Playwright) y,
// si el frame tiene un video, lo compone con ffmpeg (fondo + video recortado + capas de arriba).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { visualDir, resolveInCase } from './store.mjs';

const run = promisify(execFile);

export const slugify = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'set';

async function renderFrame(page, base, { slug, setId, frame, mode = 'full', scale = 1 }) {
  await page.setViewportSize({ width: frame.w, height: frame.h });
  const q = new URLSearchParams({ render: '1', slug, set: setId, frame: frame.id, mode });
  await page.goto(`${base}/?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const info = await page.evaluate(() => window.__renderInfo || {});
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: frame.w, height: frame.h }, omitBackground: mode.startsWith('above'), scale: 'device' });
  return { buf, info };
}

function roundedMaskSvg(w, h, [tl, tr, br, bl]) {
  const p = `M${tl},0 H${w - tr} Q${w},0 ${w},${tr} V${h - br} Q${w},${h} ${w - br},${h} H${bl} Q0,${h} 0,${h - bl} V${tl} Q0,0 ${tl},0 Z`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="black"/><path d="${p}" fill="white"/></svg>`);
}

async function exportVideoFrame(page, base, ctx, frame, videoLayer, project, outAbs, scale, log) {
  const { slug, setId } = ctx;
  const tmp = outAbs + '.tmp';
  await fsp.mkdir(tmp, { recursive: true });
  const below = await renderFrame(page, base, { slug, setId, frame, mode: `below:${videoLayer.id}`, scale });
  const slot = below.info.videoSlot;
  if (!slot) throw new Error('No se encontró el área del video');
  const above = await renderFrame(page, base, { slug, setId, frame, mode: `above:${videoLayer.id}`, scale });
  const bgPng = path.join(tmp, 'bg.png');
  const topPng = path.join(tmp, 'top.png');
  const maskPng = path.join(tmp, 'mask.png');
  await fsp.writeFile(bgPng, below.buf);
  await fsp.writeFile(topPng, above.buf);
  const s = scale;
  const R = (v) => Math.round(v * s);
  const cw = R(slot.w);
  const ch = R(slot.h);
  await sharp(roundedMaskSvg(cw, ch, slot.radii.map(R))).png().toFile(maskPng);
  const asset = project.assets.find((a) => a.id === videoLayer.asset);
  const src = resolveInCase(slug, asset.file);
  const iw = R(slot.iw) + (R(slot.iw) % 2);
  const ih = R(slot.ih) + (R(slot.ih) % 2);
  const cx = Math.max(0, R(-slot.ix));
  const cy = Math.max(0, R(-slot.iy));
  const start = videoLayer.start || 0;
  const dur = Math.min(videoLayer.duration || asset.duration || 10, 60);
  const { stdout: rate } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', src]);
  const [rn, rd] = rate.trim().split('/').map(Number);
  const fps = Math.min(60, Math.max(24, Math.round(rn / (rd || 1)) || 30));
  const W = R(frame.w) + (R(frame.w) % 2);
  const H = R(frame.h) + (R(frame.h) % 2);
  const filter = [
    `[0:v]scale=${W}:${H}[bg]`,
    `[1:v]scale=${iw}:${ih},crop=${cw}:${ch}:${cx}:${cy},format=rgba[vs]`,
    `[2:v]format=gray,scale=${cw}:${ch}[m]`,
    `[vs][m]alphamerge[va]`,
    `[bg][va]overlay=${R(slot.x)}:${R(slot.y)}[b1]`,
    `[3:v]scale=${W}:${H}[top]`,
    `[b1][top]overlay=0:0,format=yuv420p[out]`,
  ].join(';');
  log(`Componiendo video ${path.basename(outAbs)}`);
  await run('ffmpeg', [
    '-y', '-v', 'error',
    '-loop', '1', '-framerate', String(fps), '-i', bgPng,
    '-ss', String(start), '-t', String(dur), '-i', src,
    '-loop', '1', '-framerate', String(fps), '-i', maskPng,
    '-loop', '1', '-framerate', String(fps), '-i', topPng,
    '-filter_complex', filter, '-map', '[out]',
    '-t', String(dur), '-r', String(fps), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', '-an',
    outAbs,
  ], { maxBuffer: 1 << 24 });
  // Póster (primer cuadro) para Webflow o vista previa.
  const fromEnd = /\/anim-/.test(asset.file); // clips: póster con la animación terminada
  await run('ffmpeg', ['-y', '-v', 'error', ...(fromEnd ? ['-sseof', '-0.1'] : []), '-i', outAbs, '-frames:v', '1', '-q:v', '2', outAbs.replace(/\.mp4$/, '.poster.jpg')]);
  await fsp.rm(tmp, { recursive: true, force: true });
}


// Versión animada del video para campos de imagen (galería de Webflow): WebP animado (liviano)
// y, si se pide, GIF. 15 fps; el WebP mantiene el tamaño del frame.
export async function animatedVersions(mp4, { gif = false, fps = 30, width = 1000, gifWidth = 1000 } = {}) {
  const webp = mp4.replace(/\.mp4$/, '.webp');
  // Webflow acepta imágenes de hasta 4 MB: se prueba bajando ancho, calidad y, en scrolls largos,
  // cuadros por segundo (24 y 20) hasta que entre.
  const MAX_BYTES = 3_800_000; // margen bajo el límite de 4 MB de Webflow
  const plans = [];
  for (const f of [fps, 24, 20]) for (const [w, q] of [[width, 70], [860, 64], [760, 58], [680, 52], [600, 48]]) plans.push([f, w, q, 0]);
  // Último recurso en scrolls muy largos: la versión animada muestra solo los primeros segundos
  // (el MP4 completo no se toca), así no hace falta bajar la fluidez.
  for (const sec of [18, 14, 11]) plans.push([24, 760, 58, sec]);
  plans.push([24, 640, 52, 9], [20, 600, 48, 8], [20, 520, 44, 7]); // sitios con mucha foto
  let framesFps = null;
  let files = [];
  const framesDir = mp4 + '.frames';
  try {
    // El primer intento mide; los siguientes se eligen estimando el peso (fps × ancho² × segundos × calidad)
    // y se saltean los que no van a entrar. Si nada entra, queda el más liviano.
    const dur = await (async () => {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]);
      return parseFloat(stdout) || 10;
    })();
    const qf = (q) => Math.exp(0.035 * (q - 70));
    let base = null;
    let best = null;
    for (const [f, w, q, sec] of plans) {
      const secs = sec ? Math.min(sec, dur) : dur;
      if (base) {
        const est = base.size * (f / base.f) * (w / base.w) ** 2 * (secs / base.secs) * (qf(q) / qf(base.q));
        if (est > MAX_BYTES * 1.08) continue;
      }
      if (`${f}|${sec}` !== framesFps) {
        await fsp.rm(framesDir, { recursive: true, force: true });
        await fsp.mkdir(framesDir, { recursive: true });
        await run('ffmpeg', ['-y', '-v', 'error', ...(sec ? ['-t', String(sec)] : []), '-i', mp4, '-vf', `fps=${f}`, path.join(framesDir, '%05d.png')]);
        files = (await fsp.readdir(framesDir)).sort().map((x) => path.join(framesDir, x));
        framesFps = `${f}|${sec}`;
      }
      const bufs = await Promise.all(files.map((x) => sharp(x).resize({ width: w, withoutEnlargement: true }).png().toBuffer()));
      const out = await sharp(bufs, { join: { animated: true } })
        .webp({ quality: q, effort: 4, loop: 0, delay: Array(bufs.length).fill(Math.round(1000 / f)) })
        .toBuffer();
      if (!base) base = { size: out.length, f, w: Math.min(w, (await sharp(files[0]).metadata()).width), q, secs };
      if (!best || out.length < best.length) best = out;
      if (out.length <= MAX_BYTES) break;
    }
    await fsp.writeFile(webp, best);
  } finally {
    await fsp.rm(framesDir, { recursive: true, force: true });
  }
  if (gif) {
    const filter = `fps=${Math.min(fps, 25)},scale=${gifWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
    await run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-vf', filter, '-loop', '0', mp4.replace(/\.mp4$/, '.gif')]);
  }
  return webp;
}

/**
 * opts: { setId, frameIds?, format: 'png'|'jpg'|'webp', scale: 1|2, base, gif?: boolean }
 */
export async function exportSet(slug, project, opts, log = () => {}) {
  const set = project.sets.find((s) => s.id === opts.setId);
  if (!set) throw new Error('Set no encontrado');
  const format = opts.format || (set.kind === 'instagram' ? 'jpg' : 'webp');
  const scale = opts.scale || 1;
  const outDirRel = `visual/export/${slugify(set.name)}`;
  const outDir = path.join(visualDir(slug), '..', outDirRel);
  await fsp.mkdir(outDir, { recursive: true });
  const frames = set.frames.filter((f) => !opts.frameIds || opts.frameIds.includes(f.id));
  const browser = await chromium.launch();
  const manifest = [];
  try {
    const context = await browser.newContext({ deviceScaleFactor: scale });
    const page = await context.newPage();
    for (const frame of frames) {
      const idx = set.frames.indexOf(frame) + 1;
      const baseName = `${String(idx).padStart(2, '0')}-${slugify(frame.name.replace(/^\d+\s*·\s*/, ''))}`;
      const videoLayer = frame.layers.find((l) => l.type === 'video' && !l.hidden);
      let file;
      if (videoLayer) {
        file = `${baseName}.mp4`;
        await exportVideoFrame(page, opts.base, { slug, setId: set.id }, frame, videoLayer, project, path.join(outDir, file), scale, log);
        // Instagram usa el MP4; la versión animada es para campos de imagen (galería de Webflow).
        if (set.kind !== 'instagram') {
          log(`Versión animada de ${file}`);
          await animatedVersions(path.join(outDir, file), { gif: !!opts.gif });
        }
      } else {
        const { buf } = await renderFrame(page, opts.base, { slug, setId: set.id, frame, scale });
        file = `${baseName}.${format}`;
        const img = sharp(buf);
        if (format === 'jpg') await img.jpeg({ quality: 92, mozjpeg: true }).toFile(path.join(outDir, file));
        else if (format === 'webp') await img.webp({ quality: 92 }).toFile(path.join(outDir, file));
        else await img.png({ compressionLevel: 9 }).toFile(path.join(outDir, file));
        log(`Exportada ${file}`);
      }
      const extra = videoLayer ? { animated: set.kind !== 'instagram' ? file.replace(/\.mp4$/, '.webp') : undefined, poster: file.replace(/\.mp4$/, '.poster.jpg'), ...(opts.gif ? { gif: file.replace(/\.mp4$/, '.gif') } : {}) } : {};
      manifest.push({ ...extra, order: idx, file, frameId: frame.id, name: frame.name, alt: frame.alt || '', format: frame.format, w: Math.round(frame.w * scale), h: Math.round(frame.h * scale), video: !!videoLayer });
    }
    await context.close();
  } finally {
    await browser.close();
  }
  // Limpia archivos de exportaciones anteriores del mismo set que ya no corresponden.
  if (!opts.frameIds) {
    const keep = new Set(manifest.flatMap((m) => [m.file, m.poster, m.animated, m.gif].filter(Boolean)).concat('manifest.json'));
    for (const f of await fsp.readdir(outDir)) if (!keep.has(f)) await fsp.rm(path.join(outDir, f), { force: true });
  }
  const man = {
    caso: slug,
    set: set.name,
    kind: set.kind,
    grilla: set.grilla || '',
    exportedAt: new Date().toISOString(),
    files: manifest.sort((a, b) => a.order - b.order),
  };
  if (opts.frameIds && fs.existsSync(path.join(outDir, 'manifest.json'))) {
    const prev = JSON.parse(await fsp.readFile(path.join(outDir, 'manifest.json'), 'utf8'));
    const byId = new Map(prev.files.map((f) => [f.frameId, f]));
    manifest.forEach((m) => byId.set(m.frameId, m));
    man.files = [...byId.values()].sort((a, b) => a.order - b.order);
  }
  await fsp.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(man, null, 2));
  return { dir: outDirRel, abs: outDir, files: man.files };
}
