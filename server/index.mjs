// Servidor de Case Studio: API + Vite (dev) en un solo puerto.
import './env.mjs'; // primero: carpeta de casos y temporales (config.local.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import http from 'node:http';
import express from 'express';
import {
  CASOS_DIR, listCases, readConfig, writeConfig, loadProject, saveProject, readProjectRaw, projectPath, lastWritten,
  resolveInCase, storeUpload, makeAsset, thumbnail,
} from './store.mjs';
import { captureSite, recordSite, discoverPages } from './capture.mjs';
import { recordAnimations } from './animate.mjs';
import { exportSet } from './export.mjs';
import { generateSet, buildFrames } from '../shared/generate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4510);
const BASE = `http://localhost:${PORT}`;
const prod = process.env.NODE_ENV === 'production';

const app = express();
const httpServer = http.createServer(app);
app.use(express.json({ limit: '50mb' }));

// ---------- eventos (SSE) ----------
const clients = new Map(); // slug -> Set(res)
function emit(slug, type, data = {}) {
  for (const res of clients.get(slug) || []) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
const watchers = new Map();
function watchProject(slug) {
  if (watchers.has(slug)) return;
  const file = projectPath(slug);
  let timer;
  const w = fs.watchFile(file, { interval: 400 }, async () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const { hash } = await readProjectRaw(slug);
        if (hash !== lastWritten.get(slug)) {
          lastWritten.set(slug, hash);
          emit(slug, 'changed', { by: 'external' });
        }
      } catch {}
    }, 150);
  });
  watchers.set(slug, w);
}

app.get('/api/events/:slug', (req, res) => {
  const { slug } = req.params;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('event: hello\ndata: {}\n\n');
  if (!clients.has(slug)) clients.set(slug, new Set());
  clients.get(slug).add(res);
  watchProject(slug);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.get(slug)?.delete(res);
  });
});

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message });
  });

// Mutación del lado del servidor: lee lo último del disco, aplica y guarda.
const locks = new Map();
async function mutate(slug, fn) {
  const prev = locks.get(slug) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  locks.set(slug, prev.then(() => next));
  await prev;
  try {
    const p = await loadProject(slug);
    const out = (await fn(p)) || p;
    await saveProject(slug, out);
    emit(slug, 'changed', { by: 'server' });
    return out;
  } finally {
    release();
  }
}

// ---------- API ----------
app.get('/api/cases', wrap(async (req, res) => res.json({ casosDir: CASOS_DIR, cases: await listCases() })));

app.get('/api/config', wrap(async (req, res) => res.json(await readConfig())));
app.put('/api/config', wrap(async (req, res) => res.json(await writeConfig(req.body || {}))));
app.post('/api/discover', wrap(async (req, res) => res.json({ pages: await discoverPages(req.body.url, req.body.max || 5) })));

app.get('/api/project/:slug', wrap(async (req, res) => {
  const p = await loadProject(req.params.slug);
  if (!lastWritten.has(req.params.slug)) lastWritten.set(req.params.slug, (await readProjectRaw(req.params.slug)).hash);
  res.json(p);
}));

app.put('/api/project/:slug', wrap(async (req, res) => {
  const saved = await saveProject(req.params.slug, req.body);
  res.json({ ok: true, updatedAt: saved.updatedAt });
}));

// Reemplazo completo desde el CLI/chat: guarda y avisa al editor para que recargue.
app.post('/api/project/:slug/replace', wrap(async (req, res) => {
  const p = await mutate(req.params.slug, () => req.body);
  res.json({ ok: true, updatedAt: p.updatedAt });
}));

app.post('/api/project/:slug/upload', express.raw({ type: '*/*', limit: '1gb' }), wrap(async (req, res) => {
  const { slug } = req.params;
  const name = String(req.query.name || 'archivo');
  emit(slug, 'log', { msg: `Subiendo ${name}` });
  const rel = await storeUpload(slug, name, req.body);
  const asset = await makeAsset(slug, rel, { source: 'upload', label: name.replace(/\.[^.]+$/, ''), role: req.query.role || undefined });
  // attach=0: el editor agrega el asset a su estado (evita pisar cambios sin guardar).
  const p = req.query.attach === '0' ? null : await mutate(slug, (p) => {
    asset.order = p.assets.length;
    p.assets.push(asset);
  });
  emit(slug, 'log', { msg: `Listo: ${name}`, done: true });
  res.json({ project: p, asset });
}));

app.post('/api/project/:slug/capture', wrap(async (req, res) => {
  const { slug } = req.params;
  const log = (msg) => emit(slug, 'log', { msg });
  const assets = await captureSite(slug, req.body, log);
  const p = req.body.attach === false ? null : await mutate(slug, (p) => {
    assets.forEach((a, i) => (a.order = p.assets.length + i));
    p.assets.push(...assets);
  });
  emit(slug, 'log', { msg: `Captura lista: ${assets.length} imágenes`, done: true });
  res.json({ project: p, assets });
}));

app.post('/api/project/:slug/record', wrap(async (req, res) => {
  const { slug } = req.params;
  const assets = await recordSite(slug, req.body, (msg) => emit(slug, 'log', { msg }));
  const p = await mutate(slug, (p) => {
    assets.forEach((a, i) => (a.order = p.assets.length + i));
    p.assets.push(...assets);
  });
  emit(slug, 'log', { msg: `Grabación lista`, done: true });
  res.json({ project: p, assets });
}));

app.post('/api/project/:slug/record-anim', wrap(async (req, res) => {
  const { slug } = req.params;
  const assets = await recordAnimations(slug, req.body, (msg) => emit(slug, 'log', { msg }));
  const p = await mutate(slug, (p) => {
    assets.forEach((a, i) => (a.order = p.assets.length + i));
    p.assets.push(...assets);
  });
  emit(slug, 'log', { msg: `Animaciones: ${assets.length}`, done: true });
  res.json({ project: p, assets });
}));

app.post('/api/project/:slug/generate', wrap(async (req, res) => {
  const { slug } = req.params;
  const opts = req.body || {};
  const p = await mutate(slug, (p) => {
    if (opts.setId) {
      const set = p.sets.find((s) => s.id === opts.setId);
      if (!set) throw new Error('Set no encontrado');
      const frames = buildFrames(p, { ...opts, kind: set.kind, grilla: opts.grilla ?? set.grilla, format: opts.format || set.format });
      set.frames = opts.append ? set.frames.concat(frames) : frames;
      if (opts.grilla) set.grilla = opts.grilla;
      if (opts.format) set.format = opts.format;
    } else {
      p.sets.push(generateSet(p, opts));
    }
  });
  res.json({ project: p });
}));

app.post('/api/project/:slug/export', wrap(async (req, res) => {
  const { slug } = req.params;
  const p = await loadProject(slug);
  const out = await exportSet(slug, p, { ...req.body, base: BASE }, (msg) => emit(slug, 'log', { msg }));
  emit(slug, 'log', { msg: `Exportación lista: ${out.files.length} archivos`, done: true });
  res.json(out);
}));

app.post('/api/project/:slug/reveal', wrap(async (req, res) => {
  const abs = resolveInCase(req.params.slug, req.body.path || 'visual');
  execFile('open', fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? [abs] : ['-R', abs]);
  res.json({ ok: true });
}));

// Archivos del caso. ?w=800 devuelve una miniatura webp cacheada.
app.get('/files/:slug/*', wrap(async (req, res) => {
  const rel = decodeURIComponent(req.params[0]);
  const abs = resolveInCase(req.params.slug, rel);
  if (!fs.existsSync(abs)) return res.status(404).end();
  const w = parseInt(req.query.w, 10);
  if (w && /\.(png|jpe?g|webp|avif)$/i.test(abs)) {
    const t = await thumbnail(req.params.slug, rel, Math.min(4000, w));
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(t);
  }
  res.set('Cache-Control', 'public, max-age=3600');
  res.sendFile(abs);
}));

// ---------- front ----------
if (prod) {
  app.use(express.static(path.join(ROOT, 'dist')));
  app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: { server: httpServer } }, appType: 'spa' });
  app.use(vite.middlewares);
}

httpServer.listen(PORT, () => console.log(`Case Studio en ${BASE}  ·  casos: ${CASOS_DIR}`));
