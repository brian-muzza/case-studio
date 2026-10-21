// Plan de subida a Webflow: imágenes del último set de Webflow de cada caso (en orden, con alt y md5),
// más la captura de página completa para la card. Sirve para registrar los assets (create_asset) y
// cargarlos en el CMS. Uso: node scripts/upload-plan.mjs <caso> [caso…]  (requiere el servidor andando)
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { CASOS_DIR as C } from '../server/store.mjs';
import * as F from './fixlib.mjs';

const OUT = process.env.UPLOAD_PLAN || path.join(os.tmpdir(), 'upload-plan.json');
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const plan = {};
for (const slug of process.argv.slice(2)) {
  const p = await F.get(slug);
  const w = F.latest(p, 'webflow');
  const dir = path.join(C, slug, 'visual/export', slugify(w.name));
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const items = man.files.map((f) => {
    const file = f.animated || f.file;
    const abs = path.join(dir, file);
    const buf = fs.readFileSync(abs);
    const frame = w.frames.find((x) => x.id === f.frameId);
    return { order: f.order, abs, name: `${slug}-${file}`.slice(0, 95), md5: crypto.createHash('md5').update(buf).digest('hex'), mb: +(buf.length / 1e6).toFixed(2), alt: (frame && frame.alt) || '' };
  });
  if (items.length !== w.frames.length) console.log(`OJO ${slug}: manifest ${items.length} vs set ${w.frames.length}`);
  const card = path.join(C, slug, 'visual/export/card/pagina-completa.jpg');
  const cardItem = fs.existsSync(card) ? { abs: card, name: `${slug}-pagina-completa.jpg`, md5: crypto.createHash('md5').update(fs.readFileSync(card)).digest('hex') } : null;
  plan[slug] = { set: w.name, grilla: w.grilla, items, card: cardItem };
  console.log(`${slug.padEnd(18)} ${w.name} · grilla ${w.grilla} · ${items.length} imágenes · ${items.reduce((n, i) => n + i.mb, 0).toFixed(1)} MB · máx ${Math.max(...items.map((i) => i.mb))} MB`);
}
fs.writeFileSync(OUT, JSON.stringify(plan, null, 1));
console.log(`plan: ${OUT}`);
