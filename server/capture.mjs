// Captura de un sitio con Playwright. Regla: cada captura es una unidad completa
// (una vista de pantalla, una sección entera o un componente entero) para que las
// plantillas nunca tengan que recortar contenido por la mitad.
//   hero        primera pantalla desktop
//   screen      vista desktop (W×H) parada al inicio de cada sección
//   section     sección completa (hasta 2200 px CSS de alto)
//   component   tarjetas, formularios y bloques con fondo/borde/sombra propios
//   page        página completa desktop
//   mobile      vista mobile 390×844 al inicio de cada sección
//   mobile-page página completa mobile
//   video       grabación del scroll (opcional)
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { launchBrowser } from './browser.mjs';
import { visualDir, makeAsset } from './store.mjs';
import { stepFrame } from './animate.mjs';

const run = promisify(execFile);
const MAX_SECTION = 2200;

const HIDE_SCRIPT = (extra) => {
  const re = /cookie|consent|gdpr|onetrust|cky-|cmplz|intercom|crisp|hubspot-messages|tawk|whatsapp|chat-widget|drift|tidio|zendesk|launcher/i;
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if ((s.position === 'fixed' || s.position === 'sticky') && re.test(`${el.id} ${el.className} ${el.getAttribute('aria-label') || ''}`)) {
      el.style.setProperty('display', 'none', 'important');
    }
  }
  for (const f of document.querySelectorAll('iframe')) {
    if (re.test(f.src + ' ' + f.id + ' ' + f.title)) f.style.setProperty('display', 'none', 'important');
  }
  if (extra) for (const el of document.querySelectorAll(extra)) el.style.setProperty('display', 'none', 'important');
};

async function dismissBanners(page) {
  const labels = /^(aceptar|aceptar todo|aceptar todas|accept|accept all|allow all|agree|entendido|got it|ok|de acuerdo|continuar)$/i;
  for (const b of await page.locator('button, a[role="button"], [role="button"]').all().catch(() => [])) {
    try {
      const t = ((await b.innerText({ timeout: 300 })) || '').trim();
      if (labels.test(t) && (await b.isVisible())) {
        await b.click({ timeout: 800 });
        await page.waitForTimeout(300);
        break;
      }
    } catch {}
  }
}

async function autoScroll(page) {
  let last = -1;
  for (let i = 0; i < 80; i++) {
    await page.mouse.wheel(0, 650);
    await page.waitForTimeout(140);
    const y = await page.evaluate(() => (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4 ? -2 : window.scrollY));
    if (y === -2 || y === last) break;
    last = y;
  }
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.wheel(0, -100000);
  await page.waitForTimeout(700);
}

async function open(context, url, opts, { scroll = true, clock = false } = {}) {
  const page = await context.newPage();
  if (clock) await page.clock.install(); // corre normal hasta que se congele para grabar
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  } catch {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  }
  await page.waitForTimeout(opts.wait ?? 1200);
  await dismissBanners(page);
  await page.evaluate(HIDE_SCRIPT, opts.hide || '');
  if (scroll) await autoScroll(page);
  await page.evaluate(HIDE_SCRIPT, opts.hide || '');
  await page.evaluate(() => document.fonts && document.fonts.ready);
  return page;
}

// Secciones de primer nivel (alto real, sin recortar).
async function findSections(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const cands = [...document.querySelectorAll('section, header, footer, main > div, [class*="section"], [class*="Section"]')];
    const rects = [];
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      if (r.height < 240 || r.width < vw * 0.9) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      rects.push({ top: Math.round(r.top + window.scrollY), height: Math.round(r.height) });
    }
    rects.sort((a, b) => a.top - b.top);
    const out = [];
    for (const r of rects) {
      const prev = out[out.length - 1];
      if (prev && r.top < prev.top + prev.height - 40) continue;
      out.push(r);
    }
    return out.slice(0, 16);
  });
}

// Componentes con borde visual propio: fondo distinto al del padre, borde, sombra o radio con fondo.
// Solo los que se ven enteros (sin recortes de carruseles u overflow) y uno por "tipo":
// tarjetas hermanas con la misma clase y tamaño parecido cuentan como el mismo componente.
async function findComponents(page, max = 12) {
  return page.evaluate((max) => {
    const vw = window.innerWidth;
    const transparent = (c) => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
    const effBg = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const c = getComputedStyle(e).backgroundColor;
        if (!transparent(c)) return c;
      }
      return 'rgb(255, 255, 255)';
    };
    // ¿Algún ancestro con overflow recorta al elemento? (carruseles, máscaras)
    const clipped = (el, r) => {
      for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (/(hidden|clip|auto|scroll)/.test(s.overflow + s.overflowX + s.overflowY)) {
          const pr = e.getBoundingClientRect();
          if (r.left < pr.left - 1 || r.right > pr.right + 1 || r.top < pr.top - 1 || r.bottom > pr.bottom + 1) return true;
        }
      }
      return false;
    };
    const visible = (el) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.visibility === 'hidden' || +s.opacity < 0.95 || s.display === 'none') return false;
        if (s.transform && s.transform !== 'none' && /matrix\((?!1, 0, 0, 1)/.test(s.transform)) return false; // a mitad de animación
      }
      return true;
    };
    const signature = (el, r) => {
      const cls = [...el.classList].filter((c) => !/^(is-|w--|active|current)/.test(c)).sort().join('.');
      return `${el.tagName}.${cls}|${Math.round(r.width / 40)}x${Math.round(r.height / 40)}`;
    };
    const found = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 220 || r.height < 120 || r.width > vw * 0.72 || r.height > 900) continue;
      if (r.left < 0 || r.right > vw) continue; // se sale de la pantalla
      const s = getComputedStyle(el);
      if (s.display === 'inline') continue;
      if (/^(NAV|HEADER|FOOTER|svg|IFRAME)$/i.test(el.tagName) || el.closest('nav, footer, header')) continue;
      const bg = s.backgroundColor;
      const parentBg = el.parentElement ? effBg(el.parentElement) : '';
      const hasBg = !transparent(bg) && bg !== parentBg;
      const hasBorder = parseFloat(s.borderTopWidth) > 0 && !transparent(s.borderTopColor) && s.borderTopStyle !== 'none';
      const hasShadow = s.boxShadow && s.boxShadow !== 'none';
      const hasImgBg = s.backgroundImage && s.backgroundImage !== 'none' && parseFloat(s.borderTopLeftRadius) >= 6;
      if (!(hasBg || hasBorder || hasShadow || hasImgBg)) continue;
      const text = (el.innerText || '').trim();
      if (text.length < 12 && !el.querySelector('img, svg, video, canvas')) continue;
      if (!visible(el) || clipped(el, r)) continue;
      found.push({
        x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height),
        radius: parseFloat(s.borderTopLeftRadius) || 0, area: r.width * r.height, sig: signature(el, r),
      });
    }
    found.sort((a, b) => b.area - a.area);
    const out = [];
    const sigs = new Set();
    const overlap = (a, b) => {
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      return (ix * iy) / Math.min(a.area, b.area);
    };
    for (const c of found) {
      if (sigs.has(c.sig)) continue; // misma tarjeta con otro texto
      if (out.some((o) => overlap(o, c) > 0.25)) continue;
      sigs.add(c.sig);
      out.push(c);
      if (out.length >= max) break;
    }
    return out.sort((a, b) => a.y - b.y);
  }, max);
}

// Fotos reales del sitio (img grandes y fondos CSS) para usar como fondo de las imágenes.
async function findPhotos(page, max = 6) {
  return page.evaluate((max) => {
    const out = [];
    const seen = new Set();
    const push = (src, area) => {
      if (!src || seen.has(src) || /\.svg(\?|$)|\.gif(\?|$)|data:/i.test(src)) return;
      seen.add(src);
      out.push({ src, area });
    };
    for (const img of document.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      if ((img.naturalWidth || 0) >= 900 && r.width * r.height > 120000) push(img.currentSrc || img.src, r.width * r.height);
    }
    for (const el of document.querySelectorAll('body *')) {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none' || !bg.includes('url(')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 600 || r.height < 300) continue;
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (m) push(new URL(m[1], location.href).href, r.width * r.height);
    }
    return out.sort((a, b) => b.area - a.area).slice(0, max).map((o) => o.src);
  }, max);
}

// ¿Es una foto (con color y textura) y no una interfaz o ilustración plana con mucho blanco?
async function looksLikePhoto(buf) {
  const { data, info } = await sharp(buf).resize({ width: 160 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let white = 0;
  let sat = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    if (r > 235 && g > 235 && b > 235) white++;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
  }
  return white / n < 0.2 && sat / n > 22;
}

// Agrupa secciones consecutivas en tramos verticales (cortados siempre en el borde de una sección).
function groupSlices(rects, W, minK, maxK, maxSlices) {
  const slices = [];
  let i = 0;
  while (i < rects.length && slices.length < maxSlices) {
    let top = rects[i].top;
    let bottom = rects[i].top + rects[i].height;
    let j = i + 1;
    while (j < rects.length && bottom - top < minK * W && rects[j].top + rects[j].height - top <= maxK * W) {
      bottom = rects[j].top + rects[j].height;
      j++;
    }
    const h = bottom - top;
    if (h >= minK * W * 0.8 && h <= maxK * W) slices.push({ top, height: h });
    i = j > i + 1 ? j : i + 1;
  }
  return slices;
}

async function saveImage(buf, absBase, tall) {
  if (tall) {
    const file = absBase + '.jpg';
    await sharp(buf, { limitInputPixels: false }).jpeg({ quality: 90, mozjpeg: true }).toFile(file);
    return file;
  }
  const file = absBase + '.webp';
  await sharp(buf, { limitInputPixels: false }).webp({ quality: 92 }).toFile(file);
  return file;
}

// Anclas para vistas de pantalla: inicio de cada sección, sin pasarse del final del documento.
function screenAnchors(sections, docH, H, max) {
  const tops = [];
  for (const s of sections) {
    // Si la sección empieza a menos de una pantalla del final, la vista quedaría corrida
    // (mitad de la sección anterior): la salteamos salvo que sea casi exacta.
    if (s.top > docH - H + 40) continue;
    const t = Math.max(0, s.top);
    if (t < H * 0.5) continue; // la primera ya es el hero
    if (tops.some((x) => Math.abs(x - t) < H * 0.45)) continue;
    tops.push(t);
  }
  if (tops.length < 3) for (let t = H; t <= docH - H && tops.length < max; t += H) if (!tops.some((x) => Math.abs(x - t) < H * 0.45)) tops.push(Math.min(t, docH - H));
  return tops.sort((a, b) => a - b).slice(0, max);
}

/**
 * Graba el scroll cuadro por cuadro: en cada cuadro la página baja una cantidad exacta
 * (curva con arranque y frenada suaves) y se saca una captura. El resultado es fluido y
 * constante aunque el navegador tarde, a diferencia de grabar en tiempo real.
 */
export async function recordScroll(page, outAbs, opts = {}) {
  const { pxPerSec = 420, fps = 60, maxSeconds = 26, holdStart = 0.9, holdEnd = 1.2 } = opts;
  const tmp = outAbs + '.frames';
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  // Sin scroll suave del sitio: posicionamos la página nosotros en cada cuadro.
  await page.addStyleTag({ content: 'html, body { scroll-behavior: auto !important; }' });
  await page.evaluate(() => {
    try {
      window.lenis?.stop?.();
      window.lenis?.destroy?.();
    } catch {}
    document.documentElement.classList.remove('lenis-smooth');
  });
  const vp = page.viewportSize();
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  const distance = Math.max(0, docH - vp.height);
  const moveSeconds = Math.min(maxSeconds - holdStart - holdEnd, Math.max(2, distance / pxPerSec));
  const moveFrames = Math.round(moveSeconds * fps);
  const ease = (t) => 0.5 - Math.cos(Math.PI * t) / 2; // seno: arranca y frena suave
  let n = 0;
  // Con reloj controlado, cada cuadro avanza exactamente 1/fps: marquesinas, videos de fondo y
  // animaciones por tiempo van a su velocidad real (antes salían aceleradas).
  const timed = opts.clock !== false;
  if (timed) await page.clock.pauseAt(Date.now() + 100);
  const shot = async (y) => {
    await page.evaluate((yy) => {
      window.scrollTo(0, yy);
      window.dispatchEvent(new Event('scroll'));
    }, Math.round(y));
    if (timed) await stepFrame(page, 1000 / fps);
    else await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = path.join(tmp, `${String(n++).padStart(5, '0')}.jpg`);
    await fsp.writeFile(file, await page.screenshot({ type: 'jpeg', quality: 92 }));
    return file;
  };
  const repeat = async (file, count, y) => {
    // Con reloj, la pausa también avanza el tiempo (una marquesina no se congela al principio o al final).
    if (timed) for (let i = 0; i < count; i++) await shot(y);
    else for (let i = 0; i < count; i++) await fsp.copyFile(file, path.join(tmp, `${String(n++).padStart(5, '0')}.jpg`));
  };
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await repeat(await shot(0), Math.round(holdStart * fps) - 1, 0);
  let last;
  for (let i = 1; i <= moveFrames; i++) last = await shot(ease(i / moveFrames) * distance);
  await page.waitForTimeout(300);
  await repeat(await shot(distance), Math.round(holdEnd * fps) - 1, distance);
  await run('ffmpeg', ['-y', '-v', 'error', '-framerate', String(fps), '-i', path.join(tmp, '%05d.jpg'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', outAbs]);
  await fsp.rm(tmp, { recursive: true, force: true });
  return outAbs;
}

// Páginas internas principales a partir del menú de la home (mismo dominio, sin legales, blog, login, etc.).
export async function discoverPages(url, max = 5) {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    } catch {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    }
    const links = await page.evaluate(() => {
      const pick = (sel) => [...document.querySelectorAll(sel)].map((a) => a.href);
      return { nav: pick('header a[href], nav a[href]'), all: pick('a[href]') };
    });
    const home = new URL(page.url());
    const homeLang = (home.pathname.match(/^\/(en|es|pt|pt-br|fr|de|it)(\/|$)/i) || [])[1] || '';
    const skip = /(privac|terms|t[eé]rminos|legal|cookie|login|log-in|signin|sign-in|sign-up|register|registro|cart|carrito|checkout|account|cuenta|blog|news|noticias|novedades|post|careers|jobs|empleo|contact|contacto|demo|support|soporte|faq|politica|wp-|feed|\.pdf|mailto:|tel:)/i;
    const seen = new Set([home.pathname.replace(/\/+$/, '') || '/']);
    const out = [];
    for (const href of [...links.nav, ...links.all]) {
      let u;
      try {
        u = new URL(href);
      } catch {
        continue;
      }
      if (u.hostname.replace(/^www\./, '') !== home.hostname.replace(/^www\./, '')) continue;
      const p = u.pathname.replace(/\/+$/, '') || '/';
      if (seen.has(p) || skip.test(p) || u.hash && p === '/') continue;
      const lang = (p.match(/^\/(en|es|pt|pt-br|fr|de|it)(\/|$)/i) || [])[1] || '';
      if (lang.toLowerCase() !== homeLang.toLowerCase()) continue; // mismo idioma que la home
      if (p.split('/').filter(Boolean).length > 3) continue;
      // Como mucho 2 páginas por sección (productos, ediciones…): suelen ser la misma plantilla.
      const sec = p.split('/').filter(Boolean).slice(0, -1).join('/');
      if (sec && out.filter((o) => new URL(o).pathname.split('/').filter(Boolean).slice(0, -1).join('/') === sec).length >= 2) continue;
      seen.add(p);
      out.push(u.origin + p);
      if (out.length >= max) break;
    }
    return out;
  } finally {
    await browser.close();
  }
}

// Solo la grabación del scroll (desktop y/o mobile), sin volver a capturar todo.
export async function recordSite(slug, opts, log = () => {}) {
  const url = /^https?:\/\//.test(opts.url) ? opts.url : `https://${opts.url}`;
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '') + (u.pathname.replace(/\/+$/, '') || '');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  const caseRoot = path.join(visualDir(slug), '..');
  const folderRel = `visual/assets/rec-${host.replace(/[^a-z0-9]+/gi, '-')}-${stamp}`.toLowerCase();
  const folderAbs = path.join(caseRoot, folderRel);
  await fsp.mkdir(folderAbs, { recursive: true });
  const browser = await launchBrowser();
  const results = [];
  const speed = opts.speed || 420;
  try {
    if (opts.desktop !== false) {
      log('Grabando el scroll desktop cuadro por cuadro…');
      const ctx = await browser.newContext({ viewport: { width: opts.width || 1440, height: opts.height || 900 }, deviceScaleFactor: opts.dpr || 1 });
      const page = await open(ctx, url, opts, { clock: true });
      const out = path.join(folderAbs, 'scroll-desktop.mp4');
      await recordScroll(page, out, { pxPerSec: speed, fps: opts.fps || 60 });
      results.push(await makeAsset(slug, path.relative(caseRoot, out), { role: 'video', label: `${host} · scroll desktop`, source: 'capture', meta: { url, viewport: 'desktop', scroll: true, capturedAt: new Date().toISOString() } }));
      await ctx.close();
    }
    if (opts.mobile) {
      log('Grabando el scroll mobile…');
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await open(ctx, url, opts, { clock: true });
      const out = path.join(folderAbs, 'scroll-mobile.mp4');
      await recordScroll(page, out, { pxPerSec: speed * 0.8, fps: opts.fps || 60 });
      results.push(await makeAsset(slug, path.relative(caseRoot, out), { role: 'video', label: `${host} · scroll mobile`, source: 'capture', meta: { url, viewport: 'mobile', scroll: true, capturedAt: new Date().toISOString() } }));
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

/**
 * opts: { url, desktop=true, mobile=true, sections=true, components=true, fullPage=true, video=false,
 *         width=1440, height=900, wait, hide }
 */
export async function captureSite(slug, opts, log = () => {}) {
  const url = /^https?:\/\//.test(opts.url) ? opts.url : `https://${opts.url}`;
  const host0 = new URL(url).hostname.replace(/^www\./, '');
  const host = host0 + (new URL(url).pathname.replace(/\/+$/, '') || '');
  const pathPart = new URL(url).pathname.replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-/, '');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  const folderRel = `visual/assets/cap-${host0}${pathPart ? '-' + pathPart : ''}-${stamp}`.toLowerCase();
  const caseRoot = path.join(visualDir(slug), '..');
  const folderAbs = path.join(caseRoot, folderRel);
  await fsp.mkdir(folderAbs, { recursive: true });
  const meta = { url, capturedAt: new Date().toISOString() };
  const results = [];
  const browser = await launchBrowser();
  const add = async (absFile, role, label, extra = {}) => {
    const rel = path.relative(caseRoot, absFile);
    results.push(await makeAsset(slug, rel, { role, label, source: 'capture', meta: { ...meta, ...extra } }));
  };
  const n2 = (i) => String(i).padStart(2, '0');
  try {
    if (opts.desktop !== false) {
      const W = opts.width || 1440;
      const H = opts.height || 900;
      log(`Desktop ${W}×${H}: abriendo ${url}`);
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
      const page = await open(ctx, url, opts);
      meta.title = await page.title();
      await add(await saveImage(await page.screenshot(), path.join(folderAbs, 'desktop-hero'), false), 'hero', `${host} · hero`, { viewport: 'desktop' });
      const docH = await page.evaluate(() => document.documentElement.scrollHeight);
      const secs = await findSections(page);
      log(`Hero listo · ${secs.length} secciones`);

      // Vistas de pantalla al inicio de cada sección (para mosaicos, laptops, navegadores).
      const anchors = screenAnchors(secs, docH, H, 8);
      for (const [i, top] of anchors.entries()) {
        const buf = await page.screenshot({ clip: { x: 0, y: top, width: W, height: H }, fullPage: true });
        await add(await saveImage(buf, path.join(folderAbs, `desktop-pantalla-${n2(i + 1)}`), false), 'screen', `${host} · pantalla ${i + 2}`, { viewport: 'desktop', top, atEnd: top + H >= docH - 20 });
      }
      log(`${anchors.length} pantallas`);

      if (opts.sections !== false) {
        let n = 0;
        for (const s of secs) {
          if (s.top < 10 && s.height <= H + 40) continue; // ya es el hero
          if (s.height > MAX_SECTION) continue; // muy alta: queda cubierta por las pantallas
          n++;
          const clip = { x: 0, y: s.top, width: W, height: Math.min(s.height, docH - s.top) };
          const buf = await page.screenshot({ clip, fullPage: true });
          await add(await saveImage(buf, path.join(folderAbs, `desktop-seccion-${n2(n)}`), false), 'section', `${host} · sección ${n}`, { viewport: 'desktop', top: s.top });
        }
        log(`${n} secciones completas`);
      }

      if (opts.components !== false) {
        const comps = await findComponents(page);
        for (const [i, c] of comps.entries()) {
          const buf = await page.screenshot({ clip: { x: c.x, y: c.y, width: c.w, height: c.h }, fullPage: true });
          await add(await saveImage(buf, path.join(folderAbs, `componente-${n2(i + 1)}`), false), 'component', `${host} · componente ${i + 1}`, { viewport: 'desktop', radius: c.radius, sig: c.sig, cssW: c.w });
        }
        log(`${comps.length} componentes`);
      }

      if (opts.fullPage !== false) {
        const tall = docH * 2 > 15000;
        const buf = await page.screenshot({ fullPage: true, scale: tall ? 'css' : 'device' });
        await add(await saveImage(buf, path.join(folderAbs, 'desktop-completa'), true), 'page', `${host} · página completa`, { viewport: 'desktop' });
        log('Página completa lista');
      }

      // Tramos verticales: 2 o 3 secciones seguidas, enteras (entre 1,25 y 2,4 veces el ancho).
      const slices = groupSlices(secs.filter((x) => x.top + x.height <= docH), W, 1.25, 2.4, 5);
      for (const [i, sl] of slices.entries()) {
        const buf = await page.screenshot({ clip: { x: 0, y: sl.top, width: W, height: sl.height }, fullPage: true, scale: sl.height * 2 > 15000 ? 'css' : 'device' });
        await add(await saveImage(buf, path.join(folderAbs, `desktop-tramo-${n2(i + 1)}`), true), 'tramo', `${host} · tramo ${i + 1}`, { viewport: 'desktop', top: sl.top, atEnd: sl.top + sl.height >= docH - 20 });
      }
      log(`${slices.length} tramos verticales`);

      if (opts.photos !== false) {
        let k = 0;
        for (const src of await findPhotos(page)) {
          try {
            const res = await ctx.request.get(src, { timeout: 20000 });
            if (!res.ok()) continue;
            const body = await res.body();
            const meta0 = await sharp(body).metadata();
            if ((meta0.width || 0) < 800) continue;
            if (!(await looksLikePhoto(body))) continue; // capturas de producto o ilustraciones planas no sirven de fondo
            k++;
            const file = path.join(folderAbs, `foto-${n2(k)}.webp`);
            await sharp(body).resize({ width: 2400, withoutEnlargement: true }).webp({ quality: 88 }).toFile(file);
            await add(file, 'photo', `${host} · foto ${k}`, { src });
          } catch {}
        }
        log(`${k} fotos del sitio`);
      }
      await ctx.close();

      if (opts.video) {
        log('Grabando el scroll desktop…');
        const vctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
        const vpage = await open(vctx, url, opts, { scroll: true, clock: true });
        const out = path.join(folderAbs, 'scroll-desktop.mp4');
        await recordScroll(vpage, out, {});
        await add(out, 'video', `${host} · scroll desktop`, { viewport: 'desktop', scroll: true });
        await vctx.close();
        log('Video desktop listo');
      }
    }
    if (opts.mobile !== false) {
      log('Mobile 390×844');
      const mobileCtx = (dpr) =>
        browser.newContext({
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: dpr,
          isMobile: true,
          hasTouch: true,
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        });
      const ctx = await mobileCtx(3);
      const page = await open(ctx, url, opts);
      const docH = await page.evaluate(() => document.documentElement.scrollHeight);
      const secs = await findSections(page);
      const tops = [0, ...screenAnchors(secs, docH, 844, 5)];
      for (const [i, top] of tops.entries()) {
        const buf = await page.screenshot({ clip: { x: 0, y: top, width: 390, height: 844 }, fullPage: true });
        await add(await saveImage(buf, path.join(folderAbs, `mobile-${n2(i + 1)}`), false), 'mobile', `${host} · mobile ${i + 1}`, { viewport: 'mobile', top, atEnd: top + 844 >= docH - 20 });
      }
      // Tramos mobile: de 2,5 a 5 pantallas de alto, cortados en el inicio de una sección.
      const mRects = secs.filter((x) => x.top + x.height <= docH);
      const mSlices = groupSlices(mRects, 390, 2.4, 5, 4);
      for (const [i, sl] of mSlices.entries()) {
        const buf = await page.screenshot({ clip: { x: 0, y: sl.top, width: 390, height: sl.height }, fullPage: true, scale: sl.height * 3 > 15000 ? 'css' : 'device' });
        await add(await saveImage(buf, path.join(folderAbs, `mobile-tramo-${n2(i + 1)}`), true), 'tramo-mobile', `${host} · tramo mobile ${i + 1}`, { viewport: 'mobile', top: sl.top, atEnd: sl.top + sl.height >= docH - 20 });
      }
      if (opts.fullPage !== false) {
        const tall = docH * 3 > 15000;
        const buf = await page.screenshot({ fullPage: true, scale: tall ? 'css' : 'device' });
        await add(await saveImage(buf, path.join(folderAbs, 'mobile-completa'), true), 'mobile-page', `${host} · mobile completa`, { viewport: 'mobile' });
      }
      await ctx.close();
      if (opts.video) {
        log('Grabando el scroll mobile…');
        const vctx = await mobileCtx(2);
        const vpage = await open(vctx, url, opts, { scroll: true, clock: true });
        const out = path.join(folderAbs, 'scroll-mobile.mp4');
        await recordScroll(vpage, out, { pxPerSec: 340 });
        await add(out, 'video', `${host} · scroll mobile`, { viewport: 'mobile', scroll: true });
        await vctx.close();
      }
      log('Mobile listo');
    }
  } finally {
    await browser.close();
  }
  if (!fs.existsSync(folderAbs)) await fsp.mkdir(folderAbs, { recursive: true });
  return results;
}
