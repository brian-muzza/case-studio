// Rehace los WebP animados que pasan los 3,8 MB (límite de imágenes del CMS de Webflow: 4 MB) sin reexportar todo el set.
// Uso: node scripts/fix-webp.mjs <caso> [caso…]
import fs from 'node:fs';
import path from 'node:path';
import { CASOS_DIR as C } from '../server/store.mjs';
import { animatedVersions } from '../server/export.mjs';
for (const slug of process.argv.slice(2)) {
  for (const d of fs.readdirSync(path.join(C, slug, 'visual/export')).filter((x) => x.startsWith('webflow'))) {
    const dir = path.join(C, slug, 'visual/export', d);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.webp') && x.includes('video'))) {
      const size = fs.statSync(path.join(dir, f)).size;
      if (size <= 3_800_000) continue;
      const mp4 = path.join(dir, f.replace(/\.webp$/, '.mp4'));
      if (!fs.existsSync(mp4)) continue;
      await animatedVersions(mp4);
      console.log(`${slug}/${d}/${f}: ${(size / 1e6).toFixed(1)} → ${(fs.statSync(path.join(dir, f)).size / 1e6).toFixed(1)} MB`);
    }
  }
}
