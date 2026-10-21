// Página de render para la exportación (Playwright abre /?render=1&slug=…&set=…&frame=…&mode=…).
import { useEffect, useState } from 'react';
import { api } from './api';
import { FrameView, deviceGeometry, imagePlacement, type RenderMode } from './FrameView';
import type { Project, ScreenLayer } from './types';

declare global {
  interface Window {
    __ready?: boolean;
    __renderInfo?: Record<string, unknown>;
  }
}

export function Render() {
  const q = new URLSearchParams(location.search);
  const slug = q.get('slug')!;
  const setId = q.get('set')!;
  const frameId = q.get('frame')!;
  const mode = (q.get('mode') || 'full') as RenderMode;
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.margin = '0';
    document.body.style.background = 'transparent';
    api.project(slug).then(setProject);
  }, [slug]);

  const frame = project?.sets.find((s) => s.id === setId)?.frames.find((f) => f.id === frameId);

  useEffect(() => {
    if (!frame || !project) return;
    let cancelled = false;
    (async () => {
      await document.fonts.ready;
      const imgs = [...document.querySelectorAll<HTMLImageElement>('img[data-wait]')];
      await Promise.all(imgs.map((i) => (i.complete ? i.decode().catch(() => {}) : new Promise((r) => { i.onload = i.onerror = r; }).then(() => i.decode().catch(() => {})))));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled) return;
      const info: Record<string, unknown> = {};
      if (mode.startsWith('below:')) {
        const l = frame.layers.find((x) => x.id === mode.slice(6)) as ScreenLayer | undefined;
        if (l) {
          const g = deviceGeometry(l);
          const asset = project.assets.find((a) => a.id === l.asset);
          const p = imagePlacement(asset, g.content.w, g.content.h, l);
          info.videoSlot = { x: l.x + g.content.x, y: l.y + g.content.y, w: g.content.w, h: g.content.h, radii: g.radii, ...p };
        }
      }
      window.__renderInfo = info;
      window.__ready = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [frame, project, mode]);

  if (!project) return null;
  if (!frame) return <div style={{ font: '14px sans-serif', padding: 20 }}>Frame no encontrado</div>;
  return <FrameView frame={frame} project={project} mode={mode} displayScale={0} />;
}
