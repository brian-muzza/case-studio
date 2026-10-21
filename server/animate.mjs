// Grabación de animaciones puntuales: la pantalla de carga y secciones con algo que se mueve
// (Lottie, canvas/WebGL, Spline, mapas, videos de fondo, marquesinas).
//
// Para que salgan fluidas se graban cuadro por cuadro con el reloj de la página controlado:
// el reloj de JS (timers, requestAnimationFrame, GSAP, Lottie) avanza exacto con page.clock, y
// las animaciones CSS y los <video> se adelantan a mano en cada cuadro. Así no hay tirones aunque
// el navegador tarde en sacar cada captura. Lo que no se mueve lo suficiente se descarta.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { launchBrowser } from './browser.mjs';
import { visualDir, makeAsset } from './store.mjs';

const run = promisify(execFile);
const W = 1440;
const H = 900;
const MOTION_MIN = 1.2; // diferencia media entre cuadros (0-255, a 160 px) para considerar que hay animación

const HIDE = () => {
  const re = /cookie|consent|gdpr|onetrust|cky-|cmplz|intercom|crisp|hubspot-messages|tawk|whatsapp|chat-widget|drift|tidio|zendesk|launcher/i;
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if ((s.position === 'fixed' || s.position === 'sticky') && re.test(`${el.id} ${el.className}`)) el.style.setProperty('display', 'none', 'important');
  }
};

// Avanza un cuadro: reloj de JS + animaciones CSS + videos.
export async function stepFrame(page, dt) {
  await page.clock.runFor(dt);
  await page.evaluate(async (dt) => {
    const st = (window.__csAnim ||= { t: 0, seen: new Map() });
    st.t += dt;
    for (const a of document.getAnimations()) {
      if (!st.seen.has(a)) {
        st.seen.set(a, { base: Number(a.currentTime) || 0, t0: st.t - dt });
        a.pause();
      }
      const s = st.seen.get(a);
      try {
        a.currentTime = s.base + (st.t - s.t0);
      } catch {}
    }
    const vids = [...document.querySelectorAll('video')].filter((v) => v.readyState >= 2);
    await Promise.all(
      vids.map(
        (v) =>
          new Promise((resolve) => {
            if (!v.__cs) {
              v.__cs = true;
              v.pause();
            }
            const d = v.duration || 0;
            let nt = v.currentTime + dt / 1000;
            if (d && nt >= d) nt = v.loop ? nt % d : d;
            const done = () => {
              v.removeEventListener('seeked', done);
              resolve();
            };
            v.addEventListener('seeked', done);
            v.currentTime = nt;
            setTimeout(resolve, 400);
          }),
      ),
    );
  }, dt);
}

async function framesToMp4(dir, fps, outAbs) {
  await run('ffmpeg', ['-y', '-v', 'error', '-framerate', String(fps), '-i', path.join(dir, '%05d.jpg'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', outAbs]);
}

// Graba hasta `seconds` segundos cuadro por cuadro. Mide el movimiento solo mientras hay animación,
// recorta el clip cuando se queda quieto (con una pausa corta al final) y devuelve ese puntaje.
async function stepRecord(page, outAbs, { seconds = 5, fps = 30, hideEvery = 30, hold = 0.8, force = false } = {}) {
  const tmp = outAbs + '.frames';
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  const dt = 1000 / fps;
  const total = Math.round(seconds * fps);
  let prev = null;
  const diffs = [];
  for (let i = 0; i < total; i++) {
    await stepFrame(page, dt);
    if (i % hideEvery === 0) await page.evaluate(HIDE).catch(() => {});
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    await fsp.writeFile(path.join(tmp, `${String(i).padStart(5, '0')}.jpg`), buf);
    const small = await sharp(buf).resize({ width: 160 }).greyscale().raw().toBuffer();
    if (prev) {
      let d = 0;
      for (let k = 0; k < small.length; k++) d += Math.abs(small[k] - prev[k]);
      diffs.push(d / small.length);
    }
    prev = small;
  }
  const MOVING = 0.35;
  let last = -1;
  diffs.forEach((d, i) => d > MOVING && (last = i + 1));
  const active = diffs.slice(0, Math.max(1, last));
  const movingFrames = active.filter((d) => d > MOVING).length;
  const score = movingFrames ? active.filter((d) => d > MOVING).reduce((a, b) => a + b, 0) / movingFrames : 0;
  // force: un clip pedido a mano (p. ej. Lotties sutiles) se guarda entero aunque se mueva poco.
  const keep = force || (score >= MOTION_MIN && movingFrames >= fps * 0.5);
  if (keep) {
    // Recorta: hasta que termina la animación + una pausa, salvo que siga moviéndose hasta el final.
    const end = force ? total : Math.min(total, last + Math.round(hold * fps));
    for (let i = end; i < total; i++) await fsp.rm(path.join(tmp, `${String(i).padStart(5, '0')}.jpg`), { force: true });
    await framesToMp4(tmp, fps, outAbs);
  }
  await fsp.rm(tmp, { recursive: true, force: true });
  return keep ? Math.max(score, force ? MOTION_MIN : 0) : Math.min(score, MOTION_MIN - 0.01);
}

export async function newPage(browser, { mobile = false } = {}) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: W, height: H }, deviceScaleFactor: 1 },
  );
  const page = await ctx.newPage();
  await page.clock.install();
  return { ctx, page };
}

export async function settle(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {}
  await page.waitForLoadState('load', { timeout: 25000 }).catch(() => {});
}

// Pantalla de carga: reloj congelado desde antes de navegar, así se ve desde el primer cuadro.
async function recordLoad(browser, url, outAbs) {
  const { ctx, page } = await newPage(browser);
  try {
    await page.clock.pauseAt(Date.now() + 200);
    await settle(page, url);
    await page.evaluate(HIDE).catch(() => {});
    return await stepRecord(page, outAbs, { seconds: 5.5, fps: 30 });
  } finally {
    await ctx.close();
  }
}

// Secciones con animación propia en una página (con puntaje para elegir las mejores).
export async function scanAnimated(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const sectionOf = (el) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const r = e.getBoundingClientRect();
        if (r.width >= vw * 0.9 && r.height >= 300) return e;
      }
      return el;
    };
    const found = [];
    const add = (el, kind, score) => {
      const r = el.getBoundingClientRect();
      if (r.width < 160 || r.height < 120) return;
      const sec = sectionOf(el);
      const sr = sec.getBoundingClientRect();
      found.push({ kind, score: score * Math.min(1.5, (r.width * r.height) / (vw * 400)), top: Math.round(sr.top + window.scrollY), elTop: Math.round(r.top + window.scrollY), elH: Math.round(r.height) });
    };
    document.querySelectorAll('[data-animation-type="lottie"], lottie-player, dotlottie-player, .lottie').forEach((el) => add(el, 'lottie', 3));
    document.querySelectorAll('canvas').forEach((el) => add(el, 'canvas', 3));
    document.querySelectorAll('spline-viewer').forEach((el) => add(el, '3d', 3.5));
    document.querySelectorAll('.mapboxgl-map, .leaflet-container, .gm-style, iframe[src*="google.com/maps"], [class*="mapa"], [class*="map-"], [id*="map"]').forEach((el) => add(el, 'mapa', 3));
    document.querySelectorAll('video').forEach((el) => {
      if (el.autoplay || el.loop || el.muted) add(el, 'video', 2);
    });
    for (const a of document.getAnimations()) {
      const t = a.effect && a.effect.target;
      const it = a.effect && a.effect.getTiming ? a.effect.getTiming().iterations : 1;
      if (t && it === Infinity) add(t, 'loop', 1.2);
    }
    // Una por sección, la de mayor puntaje.
    const bySec = new Map();
    for (const f of found) if (!bySec.has(f.top) || bySec.get(f.top).score < f.score) bySec.set(f.top, f);
    return [...bySec.values()].sort((a, b) => b.score - a.score).slice(0, 4);
  });
}

// Sección animada: la página carga normal (con el reloj corriendo), se recorre para que aparezca
// todo, se para en la sección y recién ahí se congela el reloj y se graba cuadro por cuadro.
export async function recordSection(browser, url, target, outAbs, opts = {}) {
  const { ctx, page } = await newPage(browser);
  try {
    await settle(page, url);
    await page.waitForTimeout(1200);
    for (let y = 0; y < target.top; y += 700) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(120);
    }
    // Encuadre: la sección arriba, o el elemento centrado si la sección es más alta que la pantalla.
    const y = target.elH < H && target.elTop - target.top > H * 0.5 ? Math.max(0, target.elTop - (H - target.elH) / 2) : target.top;
    await page.evaluate((yy) => {
      try {
        window.lenis?.stop?.();
      } catch {}
      window.scrollTo(0, yy);
    }, y);
    await page.waitForTimeout(1500);
    await page.evaluate(HIDE).catch(() => {});
    await page.clock.pauseAt(Date.now() + 100);
    return await stepRecord(page, outAbs, { seconds: opts.seconds || 5, fps: 30, force: !!opts.force });
  } finally {
    await ctx.close();
  }
}


// Mide cuánto se anima cada sección al entrar (GSAP/ScrollTrigger, IX2, SplitText…): con el reloj
// congelado se salta a la sección y se avanza 1,6 s comparando la primera y la última captura.
async function probeSections(browser, url) {
  const { ctx, page } = await newPage(browser);
  const out = [];
  try {
    await settle(page, url);
    await page.waitForTimeout(1500);
    await page.evaluate(HIDE).catch(() => {});
    const secs = await page.evaluate(() => {
      const vw = window.innerWidth;
      const rects = [];
      for (const el of document.querySelectorAll('section, header, footer, main > div, [class*="section"]')) {
        const r = el.getBoundingClientRect();
        if (r.height < 300 || r.width < vw * 0.9) continue;
        rects.push({ top: Math.round(r.top + window.scrollY), height: Math.round(r.height) });
      }
      rects.sort((a, b) => a.top - b.top);
      const o = [];
      for (const r of rects) if (!o.length || r.top >= o[o.length - 1].top + o[o.length - 1].height - 40) o.push(r);
      return o.filter((r) => r.top > 200).slice(0, 10);
    });
    await page.clock.pauseAt(Date.now() + 100);
    for (const sec of secs) {
      await page.evaluate((y) => {
        try {
          window.lenis?.stop?.();
        } catch {}
        window.scrollTo(0, y);
        window.dispatchEvent(new Event('scroll'));
      }, sec.top);
      const a = await page.screenshot({ type: 'jpeg', quality: 70 });
      let motion = 0;
      let prev = await sharp(a).resize({ width: 160 }).greyscale().raw().toBuffer();
      for (let k = 0; k < 8; k++) {
        await stepFrame(page, 200);
        const cur = await sharp(await page.screenshot({ type: 'jpeg', quality: 70 })).resize({ width: 160 }).greyscale().raw().toBuffer();
        let d = 0;
        for (let i = 0; i < cur.length; i++) d += Math.abs(cur[i] - prev[i]);
        motion += d / cur.length;
        prev = cur;
      }
      out.push({ url, top: sec.top, height: sec.height, kind: 'entrada', score: motion / 8 });
    }
  } catch {
  } finally {
    await ctx.close();
  }
  return out;
}

// Graba la animación de entrada de una sección: se llega con el reloj corriendo hasta justo antes,
// se congela, se salta a la sección y se graba cuadro por cuadro.
async function recordEntry(browser, target, outAbs) {
  const { ctx, page } = await newPage(browser);
  try {
    await settle(page, target.url);
    await page.waitForTimeout(1200);
    for (let y = 0; y < Math.max(0, target.top - H); y += 600) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(150);
    }
    await page.evaluate((yy) => window.scrollTo(0, yy), Math.max(0, target.top - H));
    await page.waitForTimeout(1200);
    await page.evaluate(HIDE).catch(() => {});
    // Alto del menú fijo, para que la sección no quede tapada.
    const navH = await page.evaluate(() => {
      let h = 0;
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.position !== 'fixed' && s.position !== 'sticky') continue;
        const r = el.getBoundingClientRect();
        if (r.top <= 2 && r.height < 160 && r.width > window.innerWidth * 0.6) h = Math.max(h, r.bottom);
      }
      return Math.round(h);
    });
    await page.clock.pauseAt(Date.now() + 100);
    await page.evaluate((y) => {
      try {
        window.lenis?.stop?.();
      } catch {}
      window.scrollTo(0, y);
      window.dispatchEvent(new Event('scroll'));
    }, Math.max(0, target.top - navH - (navH ? 16 : 0)));
    return await stepRecord(page, outAbs, { seconds: 3.5, fps: 30, hold: 1.3 });
  } finally {
    await ctx.close();
  }
}

/**
 * Graba la carga de la home y hasta `maxClips` secciones animadas del sitio (mirando todas las páginas).
 * Devuelve los assets nuevos (solo los que tienen movimiento real).
 */
export async function recordAnimations(slug, { home, pages = [], maxClips = 2 }, log = () => {}) {
  const caseRoot = path.join(visualDir(slug), '..');
  const host = new URL(home).hostname.replace(/^www\./, '');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  const folderRel = `visual/assets/anim-${host}-${stamp}`.toLowerCase();
  const folderAbs = path.join(caseRoot, folderRel);
  await fsp.mkdir(folderAbs, { recursive: true });
  const results = [];
  const browser = await launchBrowser();
  const add = async (abs, label, meta) => results.push(await makeAsset(slug, path.relative(caseRoot, abs), { role: 'video', label, source: 'capture', meta: { viewport: 'desktop', capturedAt: new Date().toISOString(), ...meta } }));
  try {
    log('Grabando la carga de la home…');
    const loadOut = path.join(folderAbs, 'carga-home.mp4');
    const m = await recordLoad(browser, home, loadOut);
    if (m >= MOTION_MIN) {
      await add(loadOut, `${host} · carga`, { url: home, clip: 'carga', motion: Math.round(m * 10) / 10 });
      log(`Carga con animación (movimiento ${m.toFixed(1)})`);
    } else log(`La carga no tiene animación (movimiento ${m.toFixed(2)}): se descarta`);

    // Buscar secciones animadas en todas las páginas y quedarse con las mejores.
    const cands = [];
    for (const url of [home, ...pages]) {
      const { ctx, page } = await newPage(browser);
      try {
        await settle(page, url);
        await page.waitForTimeout(1500);
        for (let y = 0; y < 30000; y += 800) {
          const end = await page.evaluate((yy) => {
            window.scrollTo(0, yy);
            return yy + window.innerHeight >= document.documentElement.scrollHeight;
          }, y);
          await page.waitForTimeout(100);
          if (end) break;
        }
        for (const c of await scanAnimated(page)) cands.push({ ...c, url });
      } catch (e) {
        log(`Error revisando ${url}: ${e.message}`);
      } finally {
        await ctx.close();
      }
    }
    // Animaciones de entrada (las más comunes en Webflow con GSAP/IX2): se miden y se suman como candidatas.
    for (const url of [home, ...pages]) {
      const probed = await probeSections(browser, url);
      for (const p of probed) if (p.score >= MOTION_MIN * 1.5) cands.push({ ...p, score: Math.min(3.2, 1 + p.score / 6) });
    }
    cands.sort((a, b) => b.score - a.score);
    log(`${cands.length} secciones con animación candidatas`);
    let n = 0;
    for (const c of cands) {
      if (n >= maxClips) break;
      const out = path.join(folderAbs, `animacion-${String(n + 1).padStart(2, '0')}-${c.kind}.mp4`);
      const rec = c.kind === 'entrada' ? recordEntry(browser, c, out) : recordSection(browser, c.url, c, out);
      const motion = await rec.catch((e) => (log(`Error grabando ${c.kind}: ${e.message}`), 0));
      if (motion < MOTION_MIN) {
        log(`${c.kind} en ${new URL(c.url).pathname} sin movimiento suficiente (${motion.toFixed(2)})`);
        continue;
      }
      n++;
      const u = new URL(c.url);
      await add(out, `${host}${u.pathname.replace(/\/+$/, '')} · ${c.kind}`, { url: c.url, clip: 'animacion', kind: c.kind, motion: Math.round(motion * 10) / 10, top: c.top });
      log(`Animación ${c.kind} en ${u.pathname || '/'} (movimiento ${motion.toFixed(1)})`);
    }
  } finally {
    await browser.close();
  }
  return results;
}
