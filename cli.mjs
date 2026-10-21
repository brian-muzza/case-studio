#!/usr/bin/env node
// CLI de Case Studio para manejarlo desde el chat. Requiere el servidor corriendo (npm run dev).
//   node cli.mjs help
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATES, TEMPLATE_BY_ID, applyTemplate, contentKey } from './shared/templates.js';
import { FORMATS, newFrame, gridFormats } from './shared/model.js';
import { changeFormat } from './shared/generate.js';

const BASE = process.env.CS_URL || 'http://localhost:4510';
const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const k = rest[i].slice(2);
    const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    flags[k] = v;
  } else args.push(rest[i]);
}

// http.request sin límite de tiempo: capturas y grabaciones largas pueden tardar varios minutos
// (fetch corta a los 5 minutos esperando la respuesta).
import http from 'node:http';
function api(method, url, body, raw) {
  const payload = raw || (body ? Buffer.from(JSON.stringify(body)) : null);
  return new Promise((resolve, reject) => {
    const req = http.request(BASE + url, { method, headers: { 'Content-Type': raw ? 'application/octet-stream' : 'application/json', ...(payload ? { 'Content-Length': payload.length } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let j = {};
        try {
          j = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        } catch {}
        if (res.statusCode >= 400) reject(new Error(j.error || `HTTP ${res.statusCode}`));
        else resolve(j);
      });
    });
    req.setTimeout(0);
    req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? `No hay servidor en ${BASE}. Levantalo con: npm run dev` : e.message)));
    if (payload) req.write(payload);
    req.end();
  });
}
const get = (slug) => api('GET', `/api/project/${slug}`);
const put = (slug, p) => api('POST', `/api/project/${slug}/replace`, p);

// Referencia a un set: nombre, id o índice (1..n). Por defecto el primero con imágenes.
function findSet(p, ref) {
  if (!ref) return p.sets.find((s) => s.frames.length) || p.sets[0];
  return p.sets.find((s) => s.id === ref || s.name.toLowerCase() === String(ref).toLowerCase()) || p.sets[parseInt(ref, 10) - 1];
}
// Referencia a un frame: "set:n" (n desde 1), o id de frame.
function findFrame(p, ref) {
  for (const s of p.sets) {
    const f = s.frames.find((x) => x.id === ref);
    if (f) return { set: s, frame: f };
  }
  const [sr, n] = String(ref).includes(':') ? String(ref).split(':') : [null, ref];
  const set = findSet(p, sr);
  const frame = set?.frames[parseInt(n, 10) - 1];
  if (!frame) throw new Error(`No encontré el frame ${ref}`);
  return { set, frame };
}
function findLayer(frame, ref) {
  const l = frame.layers.find((x) => x.id === ref) || frame.layers[parseInt(ref, 10) - 1] || frame.layers.find((x) => x.name.toLowerCase().includes(String(ref).toLowerCase()));
  if (!l) throw new Error(`No encontré la capa ${ref}`);
  return l;
}
// key=valor · key+=10 / key-=10 (relativo) · objetos con punto (overlay.opacity=0.3)
function applyPairs(obj, pairs) {
  for (const pr of pairs) {
    const m = pr.match(/^([\w.]+)([+-]?)=(.*)$/);
    if (!m) throw new Error(`Par inválido: ${pr}`);
    const keys = m[1].split('.');
    let o = obj;
    for (const k of keys.slice(0, -1)) o = o[k] ||= {};
    const k = keys.at(-1);
    let v = m[3];
    if (/^-?\d+(\.\d+)?$/.test(v)) v = parseFloat(v);
    else if (v === 'true' || v === 'false') v = v === 'true';
    else if (v === 'null') v = null;
    if (m[2]) v = (o[k] || 0) + (m[2] === '+' ? v : -v);
    o[k] = v;
  }
}

function summary(p) {
  const lines = [`${p.name} (${p.slug}) · ${p.assets.length} assets · marca ${p.brand.color}`];
  const roles = {};
  p.assets.filter((a) => !a.hidden).forEach((a) => (roles[a.role] = (roles[a.role] || 0) + 1));
  lines.push(`  assets visibles: ${Object.entries(roles).map(([r, n]) => `${r} ${n}`).join(', ')}`);
  p.sets.forEach((s, si) => {
    lines.push(`\n[${si + 1}] ${s.name} · ${s.kind}${s.grilla ? ` · grilla ${s.grilla}` : ` · ${s.format}`} · id ${s.id}`);
    s.frames.forEach((f, i) => {
      const bg = f.background.type === 'image' ? `imagen blur ${f.background.blur}` : f.background.type === 'gradient' ? `degradé ${f.background.color}→${f.background.color2}` : f.background.color;
      lines.push(`  ${String(i + 1).padStart(2)}. ${f.name} · ${f.format} ${f.w}×${f.h} · ${f.template || 'libre'} · fondo ${bg} · ${f.id}`);
      f.layers.forEach((l, li) => {
        const a = l.asset ? p.assets.find((x) => x.id === l.asset) : null;
        lines.push(`        ${li + 1}) ${l.type} «${l.name}» x${l.x} y${l.y} ${l.w}×${l.h}${l.rotate ? ` rot${l.rotate}` : ''}${l.device && l.device !== 'none' ? ` ${l.device}` : ''}${l.shadow ? ` sombra:${l.shadow}` : ''}${a ? ` ← ${a.label}` : ''}`);
      });
    });
  });
  return lines.join('\n');
}


// Grilla y cantidad por caso: variadas pero estables (mismo caso, mismo resultado).
const GRID_POOL = [
  ['2,1,2,3', 11], ['1,2,2,1', 10], ['2,2,1,3', 12], ['1,3,2,1', 10], ['2,1,3,2', 11],
  ['3,1,2,2', 11], ['1,2,1,2', 9], ['2,2,1', 10], ['1,2,3', 12], ['2,1,2', 10],
];
function gridFor(slug) {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [grilla, target] = GRID_POOL[h % GRID_POOL.length];
  return [grilla, completeRows(grilla, target)];
}
// Cantidad más cercana al objetivo que deja la última fila completa (nada de huecos a la derecha).
function completeRows(grilla, target) {
  const pat = grilla.split(',').map(Number);
  const sums = [];
  let n = 0;
  for (let i = 0; n < target + 6; i++) sums.push((n += pat[i % pat.length]));
  return sums.reduce((best, x) => (Math.abs(x - target) < Math.abs(best - target) || (Math.abs(x - target) === Math.abs(best - target) && x > best) ? x : best), sums[0]);
}

const HELP = `Case Studio CLI (servidor en ${BASE})

  list                                   casos disponibles
  status <caso>                          sets, frames y capas (con índices)
  templates                              plantillas disponibles
  capture <caso> [url] [--video] [--no-mobile] [--no-sections] [--no-components] [--no-full] [--width 1440] [--hide ".popup"]
  record <caso> [url] [--mobile] [--solo-mobile] [--speed 420] [--hide ".selector"]   graba solo el scroll (fluido, 60 fps)
  upload <caso> <archivo...> [--role mobile]
  generate <caso> --kind webflow|instagram [--count 6] [--grilla 2,1,2,3] [--format ig-4x5]
                  [--name Nombre] [--set <set>] [--todas] [--sin-dispositivos] [--sombra none|subtle|soft] [--video] [--templates a,b,c] [--bg variado|claro|marca|oscuro|foto|trama]
  template <caso> <set:n> <plantilla> [--fresh]     cambia la plantilla de una imagen
  format <caso> <set:n> <formato> [--scale]          cambia el formato (re-arma o escala)
  layer <caso> <set:n> <capa> k=v ...                edita una capa (x+=40 relativo, shadow=strong, device=phone)
  bg <caso> <set:n|set> k=v ...                      edita el fondo (type=image blur=120 grain=30 overlay.opacity=.2)
  add <caso> <set> <plantilla> [--pos n] [--format f] [--asset id,id] [--name N]   agrega una imagen
  batch [caso,caso] [--skip a,b] [--pages 4]        arma todo: captura, graba, genera y exporta
  finalize <caso,caso> [--sin-animaciones]          animaciones + grilla propia + regenerar y exportar
  regrid <caso,caso>                                 grilla y cantidad propias para el último Webflow
  comentarios [caso] [--todos]                       comentarios abiertos por imagen
  resolver <caso> <set:n> [id]                       marca comentarios como resueltos
  move <caso> <set:n> <posición>                     reordena una imagen
  delete <caso> <set:n>                              borra una imagen del set
  export <caso> [set] [--format webp|jpg|png] [--scale 2] [--only n,n] [--gif]

  Referencias: set por nombre, id o número (1..); imagen como "webflow:3"; capa por número, id o nombre.`;

const BG = {
  claro: { type: 'color', color: '#EEEDE8' },
  oscuro: { type: 'color', color: '#111114' },
  marca: (p) => ({ type: 'color', color: p.brand.color }),
  foto: (p) => ({ type: 'image', image: p.assets.find((a) => a.role === 'photo')?.id || null, blur: 70, imageScale: 1.2, overlay: { color: '#000000', opacity: 0.25 } }),
  trama: (p) => ({ type: 'image', image: p.assets.find((a) => a.role === 'photo')?.id || p.assets[0]?.id, blur: 160, imageScale: 1.4, saturation: 1.3, grain: 35, overlay: { color: '#000000', opacity: 0.1 } }),
};

try {
  const slug = args[0];
  switch (cmd) {
    case 'list': {
      const { cases } = await api('GET', '/api/cases');
      cases.forEach((c) => console.log(`${c.slug.padEnd(20)} ${c.name.padEnd(36)} ${c.hasStudio ? `${c.assets} assets · ${c.frames} imágenes` : '—'}  ${c.url}`));
      break;
    }
    case 'status':
      console.log(summary(await get(slug)));
      break;
    case 'templates':
      TEMPLATES.forEach((t) => console.log(`${t.id.padEnd(16)} ${t.name.padEnd(30)} ${t.category.padEnd(18)} slots: ${t.slots.join(', ') || '—'}`));
      console.log(`\nFormatos: ${Object.entries(FORMATS).map(([k, v]) => `${k} (${v.w}×${v.h})`).join(', ')}`);
      break;
    case 'capture': {
      const p = await get(slug);
      const url = args[1] || p.url;
      console.log(`Capturando ${url}…`);
      const r = await api('POST', `/api/project/${slug}/capture`, { url, mobile: !flags['no-mobile'], sections: !flags['no-sections'], components: !flags['no-components'], video: !!flags.video, fullPage: !flags['no-full'], width: +(flags.width || 1440), height: flags.width == 1920 ? 1080 : 900, hide: flags.hide || '' });
      console.log(`${r.assets.length} capturas: ${r.assets.map((a) => `${a.role}:${a.label}`).join(', ')}`);
      break;
    }
    case 'record': {
      // record <caso> [url] [--mobile] [--solo-mobile] [--speed 420] [--hide ".selector"]
      const p = await get(slug);
      const url = args[1] || p.url;
      console.log(`Grabando el scroll de ${url}…`);
      const r = await api('POST', `/api/project/${slug}/record`, { url, desktop: !flags['solo-mobile'], mobile: !!flags.mobile || !!flags['solo-mobile'], speed: flags.speed ? +flags.speed : undefined, hide: flags.hide || '' });
      r.assets.forEach((a) => console.log(`${a.label} · ${a.w}×${a.h} · ${a.duration.toFixed(1)} s · ${a.id}`));
      break;
    }
    case 'upload':
      for (const f of args.slice(1)) {
        const r = await api('POST', `/api/project/${slug}/upload?name=${encodeURIComponent(path.basename(f))}${flags.role ? `&role=${flags.role}` : ''}`, null, fs.readFileSync(f));
        console.log(`Subido ${r.asset.label} (${r.asset.role}, ${r.asset.w}×${r.asset.h}) ${r.asset.id}`);
      }
      break;
    case 'generate': {
      const p = await get(slug);
      const set = flags.set ? findSet(p, flags.set) : null;
      const bg = flags.bg && flags.bg !== 'variado' ? (typeof BG[flags.bg] === 'function' ? BG[flags.bg](p) : BG[flags.bg]) : undefined;
      const r = await api('POST', `/api/project/${slug}/generate`, {
        setId: set?.id, kind: flags.kind || set?.kind || 'webflow', count: +(flags.count || 6), grilla: flags.grilla, format: flags.format,
        name: flags.name, full: !flags.todas, devices: !flags['sin-dispositivos'], shadow: flags.sombra, bgMode: flags.bg === 'variado' ? 'variado' : undefined, video: !!flags.video, templates: flags.templates ? String(flags.templates).split(',') : undefined, background: bg,
      });
      console.log(summary(r.project));
      break;
    }
    case 'template': {
      const p = await get(slug);
      const { set, frame } = findFrame(p, args[1]);
      if (!TEMPLATE_BY_ID[args[2]]) throw new Error(`Plantilla desconocida: ${args[2]}`);
      // Uso del resto del set, para no repetir contenido que ya aparece en otras imágenes.
      const usage = {};
      for (const f of set.frames) if (f !== frame) for (const l of f.layers) {
        const a = l.asset && p.assets.find((x) => x.id === l.asset);
        if (a) usage[contentKey(a)] = (usage[contentKey(a)] || 0) + 1;
      }
      set.frames[set.frames.indexOf(frame)] = applyTemplate(frame, args[2], p, usage, !flags.fresh);
      await put(slug, p);
      console.log(`Imagen ${args[1]} → ${TEMPLATE_BY_ID[args[2]].name}`);
      break;
    }
    case 'format': {
      const p = await get(slug);
      const { set, frame } = findFrame(p, args[1]);
      set.frames[set.frames.indexOf(frame)] = changeFormat(frame, args[2], p, flags.scale ? 'scale' : 'template');
      await put(slug, p);
      console.log(`Imagen ${args[1]} → ${args[2]}`);
      break;
    }
    case 'layer': {
      const p = await get(slug);
      const { frame } = findFrame(p, args[1]);
      const l = findLayer(frame, args[2]);
      applyPairs(l, args.slice(3));
      await put(slug, p);
      console.log(`Capa «${l.name}»: x${l.x} y${l.y} ${l.w}×${l.h}`);
      break;
    }
    case 'bg': {
      const p = await get(slug);
      let frames;
      try {
        frames = [findFrame(p, args[1]).frame];
      } catch {
        frames = findSet(p, args[1]).frames;
      }
      frames.forEach((f) => applyPairs(f.background, args.slice(2)));
      await put(slug, p);
      console.log(`Fondo actualizado en ${frames.length} imagen(es)`);
      break;
    }
    case 'add': {
      // add <caso> <set> <plantilla> [--pos n] [--format wf-1] [--asset id,id] [--name "…"]
      const p = await get(slug);
      const set = findSet(p, args[1]);
      const tid = args[2];
      if (!TEMPLATE_BY_ID[tid]) throw new Error(`Plantilla desconocida: ${tid}`);
      const pos = flags.pos ? parseInt(flags.pos, 10) - 1 : set.frames.length;
      const fmt = flags.format || (set.kind === 'webflow' ? gridFormats(set.frames.length + 1, set.grilla)[pos] : set.format);
      let frame = newFrame(fmt, p.brand);
      const ids = flags.asset ? String(flags.asset).split(',') : [];
      frame.layers = ids.map((id) => ({ id: 'tmp', type: 'screen', asset: id }));
      frame = applyTemplate(frame, tid, p, {}, true);
      frame.name = flags.name || TEMPLATE_BY_ID[tid].name;
      set.frames.splice(pos, 0, frame);
      await put(slug, p);
      console.log(`Agregada «${frame.name}» (${fmt}) en la posición ${pos + 1} de ${set.name} · ${frame.id}`);
      break;
    }
    case 'batch': {
      // batch [caso,caso] [--skip a,b] [--pages 4] — arma todo de corrido: captura, graba, genera y exporta.
      const cfg = await api('GET', '/api/config');
      const { cases } = await api('GET', '/api/cases');
      const only = args[0] ? String(args[0]).split(',') : null;
      const skip = flags.skip ? String(flags.skip).split(',') : [];
      const list = cases.filter((c) => (!only || only.includes(c.slug)) && !skip.includes(c.slug));
      const mark = async (slug, state, extra = {}) => {
        const cur = await api('GET', '/api/config');
        await api('PUT', '/api/config', { batch: { ...(cur.batch || {}), [slug]: { state, at: new Date().toISOString(), ...extra } } });
      };
      console.log(`Armado masivo: ${list.map((c) => c.slug).join(', ')}`);
      for (const c of list) {
        const t0 = new Date().toISOString();
        const started = Date.now();
        try {
          const urls = (cfg.urls && cfg.urls[c.slug]) || [c.url];
          if (!urls[0]) throw new Error('sin URL');
          await mark(c.slug, 'capturando');
          const found = urls.length > 1 ? [] : (await api('POST', '/api/discover', { url: urls[0], max: +(flags.pages || 4) })).pages;
          const pages = [...new Set([...urls, ...found])];
          console.log(`\n== ${c.slug}: ${pages.length} páginas → ${pages.join(' ')}`);
          for (const u of pages) {
            try {
              const r = await api('POST', `/api/project/${c.slug}/capture`, { url: u, mobile: true, sections: true, components: true, fullPage: true, width: 1440, height: 900 });
              console.log(`   ${u}: ${r.assets.length} capturas`);
            } catch (e) {
              console.log(`   ${u}: error ${e.message}`);
            }
          }
          await mark(c.slug, 'grabando');
          try {
            await api('POST', `/api/project/${c.slug}/record`, { url: urls[0], desktop: true, mobile: true });
            console.log('   scroll grabado (desktop y mobile)');
          } catch (e) {
            console.log(`   grabación: error ${e.message}`);
          }
          // Solo quedan visibles las capturas de este armado; lo anterior se oculta (no se borra).
          let p = await get(c.slug);
          let hid = 0;
          for (const a of p.assets) if (!a.hidden && String(a.addedAt || '') < t0) (a.hidden = true), hid++;
          const ver = (kind) => 1 + Math.max(0, ...p.sets.filter((x) => x.kind === kind && x.frames.length).map((x) => +(x.name.match(/v(\d+)\s*$/i) || [0, 1])[1]));
          const vw = ver('webflow');
          const vi = ver('instagram');
          p.sets = p.sets.filter((x) => x.frames.length); // sets vacíos por defecto
          await put(c.slug, p);
          await mark(c.slug, 'generando');
          const common = { bgMode: 'variado', devices: false, shadow: 'subtle', full: true, video: true };
          const [grilla, count] = gridFor(c.slug);
          await api('POST', `/api/project/${c.slug}/generate`, { ...common, kind: 'webflow', count, grilla, name: `Webflow v${vw}` });
          await api('POST', `/api/project/${c.slug}/generate`, { ...common, kind: 'instagram', count: 9, format: 'ig-4x5', name: `Instagram v${vi}` });
          p = await get(c.slug);
          const sw = p.sets.find((x) => x.name === `Webflow v${vw}`);
          const si = p.sets.find((x) => x.name === `Instagram v${vi}`);
          await mark(c.slug, 'exportando');
          await api('POST', `/api/project/${c.slug}/export`, { setId: sw.id, format: 'webp' });
          await api('POST', `/api/project/${c.slug}/export`, { setId: si.id, format: 'jpg' });
          if (!p.status || p.status === 'pendiente') {
            p = await get(c.slug);
            p.status = 'en-revision';
            await put(c.slug, p);
          }
          await mark(c.slug, 'listo', { sets: [sw.name, si.name], ocultas: hid, minutos: Math.round((Date.now() - started) / 60000) });
          console.log(`   listo: ${sw.name} + ${si.name} (${Math.round((Date.now() - started) / 60000)} min)`);
        } catch (e) {
          console.log(`   ${c.slug}: ERROR ${e.message}`);
          await mark(c.slug, 'error', { msg: e.message });
        }
      }
      break;
    }
    case 'finalize': {
      // finalize <caso,caso> — graba animaciones (carga + secciones), regenera el último Webflow (grilla
      // propia + videos) y el último Instagram, y exporta. No vuelve a capturar pantallas.
      const slugs = String(args[0] || '').split(',').filter(Boolean);
      const ver = (x) => +(x.name.match(/v(\d+)\s*$/i) || [0, 1])[1];
      for (const s2 of slugs) {
        const started = Date.now();
        try {
          let p = await get(s2);
          const pages = [...new Set(p.assets.filter((a) => !a.hidden && a.meta && a.meta.url && a.source === 'capture').map((a) => a.meta.url))];
          const home = p.url && pages.find((u) => u.replace(/\/+$/, '') === p.url.replace(/\/+$/, '')) ? p.url : pages[0] || p.url;
          if (!flags['sin-animaciones'] && home) {
            const r = await api('POST', `/api/project/${s2}/record-anim`, { home, pages: pages.filter((u) => u !== home).slice(0, 5), maxClips: 2 });
            console.log(`${s2}: ${r.assets.length} animaciones (${r.assets.map((a) => a.meta.clip === 'carga' ? 'carga' : a.meta.kind).join(', ') || 'ninguna con movimiento'})`);
          }
          p = await get(s2);
          const common = { bgMode: 'variado', devices: false, shadow: 'subtle', full: true, video: true };
          const wf = p.sets.filter((x) => x.kind === 'webflow' && x.frames.length).sort((a, b) => ver(b) - ver(a))[0];
          const ig = p.sets.filter((x) => x.kind === 'instagram' && x.frames.length).sort((a, b) => ver(b) - ver(a))[0];
          if (wf && !flags['solo-instagram']) {
            const [grilla, count] = gridFor(s2);
            await api('POST', `/api/project/${s2}/generate`, { ...common, setId: wf.id, kind: 'webflow', count, grilla });
            await api('POST', `/api/project/${s2}/export`, { setId: wf.id, format: 'webp' });
          }
          if (ig) {
            await api('POST', `/api/project/${s2}/generate`, { ...common, setId: ig.id, kind: 'instagram', count: 9, format: 'ig-4x5' });
            await api('POST', `/api/project/${s2}/export`, { setId: ig.id, format: 'jpg' });
          }
          const cur = await api('GET', '/api/config');
          await api('PUT', '/api/config', { batch: { ...(cur.batch || {}), [s2]: { state: 'listo', at: new Date().toISOString(), fase: 'final' } } });
          console.log(`${s2}: listo (${Math.round((Date.now() - started) / 60000)} min)`);
        } catch (e) {
          console.log(`${s2}: ERROR ${e.message}`);
        }
      }
      break;
    }
    case 'regrid': {
      // regrid <caso,caso> — regenera el último set de Webflow con su grilla y cantidad propias (no recaptura).
      const slugs = String(args[0] || '').split(',').filter(Boolean);
      for (const slug of slugs) {
        const p = await get(slug);
        const ver = (x) => +(x.name.match(/v(\d+)\s*$/i) || [0, 1])[1];
        const set = p.sets.filter((x) => x.kind === 'webflow' && x.frames.length).sort((a, b) => ver(b) - ver(a))[0];
        if (!set) {
          console.log(`${slug}: sin set de Webflow`);
          continue;
        }
        const [grilla, count] = gridFor(slug);
        await api('POST', `/api/project/${slug}/generate`, { setId: set.id, kind: 'webflow', count, grilla, bgMode: 'variado', devices: false, shadow: 'subtle', full: true, video: true });
        await api('POST', `/api/project/${slug}/export`, { setId: set.id, format: 'webp' });
        console.log(`${slug}: ${set.name} → grilla ${grilla}, ${count} imágenes`);
      }
      break;
    }
    case 'comentarios': {
      // comentarios [caso] [--todos] — lista los comentarios abiertos (o todos) con la referencia de cada imagen.
      const { cases } = await api('GET', '/api/cases');
      const slugs = slug ? [slug] : cases.filter((c) => c.hasStudio).map((c) => c.slug);
      let total = 0;
      for (const s2 of slugs) {
        const p = await get(s2);
        for (const set of p.sets) {
          set.frames.forEach((f, i) => {
            const list = (f.comments || []).filter((c) => flags.todos || !c.done);
            if (!list.length) return;
            console.log(`${p.name} · ${set.name}:${i + 1} «${f.name.replace(/^\d+\s*·\s*/, '')}» (${s2} "${set.name}:${i + 1}")`);
            list.forEach((c) => console.log(`   ${c.done ? '✓' : '•'} ${c.text}  [${c.at.slice(0, 16).replace('T', ' ')}] ${c.id}`));
            total += list.length;
          });
        }
      }
      console.log(total ? `\n${total} comentario(s)` : 'Sin comentarios abiertos');
      break;
    }
    case 'resolver': {
      // resolver <caso> <set:n> [id] — marca como resueltos los comentarios de una imagen (o uno puntual).
      const p = await get(slug);
      const { frame } = findFrame(p, args[1]);
      let n = 0;
      (frame.comments || []).forEach((c) => {
        if (!args[2] || c.id === args[2]) {
          if (!c.done) n++;
          c.done = true;
        }
      });
      await put(slug, p);
      console.log(`${n} comentario(s) resuelto(s) en «${frame.name}»`);
      break;
    }
    case 'move': {
      const p = await get(slug);
      const { set, frame } = findFrame(p, args[1]);
      set.frames.splice(set.frames.indexOf(frame), 1);
      set.frames.splice(Math.max(0, parseInt(args[2], 10) - 1), 0, frame);
      await put(slug, p);
      console.log(`«${frame.name}» ahora en la posición ${args[2]}`);
      break;
    }
    case 'delete': {
      const p = await get(slug);
      const { set, frame } = findFrame(p, args[1]);
      set.frames = set.frames.filter((f) => f !== frame);
      await put(slug, p);
      console.log(`Borrada «${frame.name}» del set ${set.name}`);
      break;
    }
    case 'export': {
      const p = await get(slug);
      const set = findSet(p, args[1]);
      const only = flags.only ? String(flags.only).split(',').map((n) => set.frames[parseInt(n, 10) - 1]?.id).filter(Boolean) : undefined;
      const r = await api('POST', `/api/project/${slug}/export`, { setId: set.id, format: flags.format, scale: +(flags.scale || 1), frameIds: only, gif: !!flags.gif });
      console.log(`${r.files.length} archivos en ${r.abs}`);
      r.files.forEach((f) => console.log(`  ${f.file}  ${f.w}×${f.h}`));
      break;
    }
    default:
      console.log(HELP);
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
