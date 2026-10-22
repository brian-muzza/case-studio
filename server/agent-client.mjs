// Cliente del daemon del agente (agent-daemon.mjs). La CLI lo usa para analyze y featured:
// si el daemon no está corriendo, o corre con código viejo, lo levanta solo.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { ROOT } from './env.mjs';

export const DAEMON_DIR = path.join(ROOT, 'capturas');
export const STATE_FILE = path.join(DAEMON_DIR, '.agent-daemon.json');
export const LOG_FILE = path.join(DAEMON_DIR, '.agent-daemon.log');
const SOURCES = ['agent.mjs', 'agent-daemon.mjs', 'capture.mjs', 'browser.mjs'].map((f) => path.join(ROOT, 'server', f));

// Si cambia el código, el daemon que está corriendo queda viejo y se reinicia.
export const codeVersion = () => SOURCES.map((f) => fs.statSync(f).mtimeMs).join('-');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function request(port, method, url, body) {
  const payload = body ? Buffer.from(JSON.stringify(body)) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let j = {};
        try {
          j = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        } catch {}
        if (res.statusCode >= 400) reject(Object.assign(new Error(j.error || `HTTP ${res.statusCode}`), { logs: j.logs }));
        else resolve(j);
      });
    });
    req.setTimeout(0); // un analyze largo puede tardar minutos
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function ping(st) {
  if (!st) return null;
  return request(st.port, 'GET', '/ping').then((j) => j.result, () => null);
}

export async function ensureDaemon() {
  const st = readState();
  const alive = await ping(st);
  if (alive && alive.version === codeVersion()) return st.port;
  if (alive) await request(st.port, 'POST', '/shutdown').catch(() => {});
  fs.mkdirSync(DAEMON_DIR, { recursive: true });
  const fd = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'agent-daemon.mjs')], { detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const s = readState();
    if (s && s.pid === child.pid && (await ping(s))) return s.port;
  }
  throw new Error(`No arrancó el daemon del agente. Ver ${LOG_FILE}`);
}

export async function daemonCall(url, body) {
  const port = await ensureDaemon();
  return request(port, 'POST', url, body);
}

// Sin levantarlo si no está: para close.
export async function daemonIfRunning(url, body) {
  const st = readState();
  if (!(await ping(st))) return null;
  return request(st.port, 'POST', url, body);
}
