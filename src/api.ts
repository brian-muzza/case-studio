import type { Asset, CaseInfo, Project, StudioBrand } from './types';

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  config: () => fetch('/api/config').then((r) => j<{ marca?: StudioBrand }>(r)),
  cases: () => fetch('/api/cases').then((r) => j<{ casosDir: string; cases: CaseInfo[] }>(r)),
  project: (slug: string) => fetch(`/api/project/${slug}`).then((r) => j<Project>(r)),
  save: (slug: string, p: Project) =>
    fetch(`/api/project/${slug}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then((r) =>
      j<{ ok: boolean; updatedAt: string }>(r),
    ),
  upload: (slug: string, file: File) =>
    fetch(`/api/project/${slug}/upload?attach=0&name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file }).then((r) =>
      j<{ asset: Asset }>(r),
    ),
  capture: (slug: string, body: Record<string, unknown>) =>
    fetch(`/api/project/${slug}/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, attach: false }) }).then((r) =>
      j<{ assets: Asset[] }>(r),
    ),
  export: (slug: string, body: Record<string, unknown>) =>
    fetch(`/api/project/${slug}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) =>
      j<{ dir: string; files: { file: string; order: number; video: boolean }[] }>(r),
    ),
  reveal: (slug: string, path: string) =>
    fetch(`/api/project/${slug}/reveal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }),
};

// URL de un archivo del caso. `w` pide una miniatura (solo imágenes).
export function fileUrl(slug: string, rel: string, w?: number) {
  const p = rel.split('/').map(encodeURIComponent).join('/');
  return `/files/${slug}/${p}${w ? `?w=${w}` : ''}`;
}
