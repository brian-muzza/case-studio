// Exporta el último set de Webflow (webp) y de Instagram (jpg) de cada caso indicado.
import http from 'node:http';
import * as F from './fixlib.mjs';
const post = (url, body) =>
  new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(`${process.env.CS_URL || 'http://localhost:4510'}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      const c = [];
      res.on('data', (x) => c.push(x));
      res.on('end', () => (res.statusCode >= 400 ? reject(new Error(Buffer.concat(c).toString())) : resolve(JSON.parse(Buffer.concat(c).toString()))));
    });
    req.setTimeout(0);
    req.on('error', reject);
    req.write(data);
    req.end();
  });
for (const slug of process.argv.slice(2)) {
  const t = Date.now();
  try {
    const p = await F.get(slug);
    const w = F.latest(p, 'webflow');
    const ig = F.latest(p, 'instagram');
    if (w) await post(`/api/project/${slug}/export`, { setId: w.id, format: 'webp' });
    if (ig) await post(`/api/project/${slug}/export`, { setId: ig.id, format: 'jpg' });
    console.log(`${slug}: exportado (${Math.round((Date.now() - t) / 60000)} min)`);
  } catch (e) {
    console.log(`${slug}: ERROR ${e.message.slice(0, 200)}`);
  }
}
