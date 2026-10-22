// Daemon del agente: un Chromium abierto con una página por URL y viewport, para que analyze y
// featured trabajen sobre la misma página (y el mismo snapshot) aunque sean procesos distintos.
// Lo levanta la CLI (agent-client.mjs); escucha solo en 127.0.0.1 y se cierra tras un rato sin uso.
import './env.mjs';
import fs from 'node:fs';
import http from 'node:http';
import { launchBrowser } from './browser.mjs';
import { analyze, featured, sessionKey, closeSession } from './agent.mjs';
import { STATE_FILE, codeVersion } from './agent-client.mjs';

const IDLE_MS = +(process.env.CS_AGENT_IDLE_MIN || 30) * 60000;
const version = codeVersion();
const sessions = new Map();
let browser = null;

async function getBrowser() {
  if (browser?.isConnected()) return browser;
  sessions.clear(); // las páginas del navegador anterior ya no existen
  browser = await launchBrowser();
  return browser;
}

// Una operación por sesión a la vez (analyze y featured de la misma página no se pisan);
// sesiones distintas corren en paralelo.
const locks = new Map();
async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  locks.set(key, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

let idle;
let busy = 0;
const touch = () => {
  clearTimeout(idle);
  idle = setTimeout(() => !busy && shutdown(), IDLE_MS);
};

async function shutdown() {
  await browser?.close().catch(() => {});
  try {
    if (JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).pid === process.pid) fs.rmSync(STATE_FILE, { force: true });
  } catch {}
  process.exit(0);
}

const routes = {
  'GET /ping': async () => ({ ok: true, pid: process.pid, version, sessions: [...sessions.keys()] }),
  'POST /analyze': async ({ url, kind, opts }, log) => withLock(sessionKey(url, kind), async () => analyze(await getBrowser(), sessions, url, kind, opts, log)),
  'POST /featured': async ({ url, kind, positions, opts }, log) => withLock(sessionKey(url, kind), async () => featured(await getBrowser(), sessions, url, kind, positions, opts, log)),
  'POST /close': async ({ url, kind }) => {
    const keys = url ? (kind ? [sessionKey(url, kind)] : ['web', 'mobile'].map((k) => sessionKey(url, k))) : [...sessions.keys()];
    const closed = keys.filter((k) => sessions.has(k));
    for (const k of closed) await withLock(k, () => closeSession(sessions, k));
    return { closed };
  },
  'POST /shutdown': async () => {
    setTimeout(shutdown, 50);
    return { ok: true };
  },
};

const server = http.createServer(async (req, res) => {
  const route = routes[`${req.method} ${req.url}`];
  const logs = [];
  const log = (m) => {
    logs.push(m);
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
  };
  const send = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (!route) return send(404, { error: 'ruta desconocida' });
  busy++;
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    send(200, { result: await route(body, log), logs });
  } catch (e) {
    console.error(e);
    send(500, { error: e.message, logs });
  } finally {
    busy--;
    touch();
  }
});

server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ pid: process.pid, port: server.address().port, version, startedAt: new Date().toISOString() }));
  console.log(`Daemon del agente en 127.0.0.1:${server.address().port} (pid ${process.pid})`);
  touch();
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
