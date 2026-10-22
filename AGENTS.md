# AGENTS.md

## Proyecto

Case Studio arma las imágenes y videos de los casos de estudio de un estudio web a partir del sitio de cada proyecto: captura con Playwright, compone sets con plantillas (galería de Webflow y carrusel de Instagram) y exporta en WebP, JPG, PNG o MP4. El README tiene el detalle para personas; acá va lo que necesita un agente.

- Node.js (ESM), Express y Vite en un solo puerto (`4510`), editor en React 19 + TypeScript.
- Playwright (Chromium) para capturar, grabar y renderizar; `sharp` para imágenes; `ffmpeg` (en el `PATH`) para video.
- Todo el texto del producto, los comentarios, los mensajes de error y la documentación están en español rioplatense (vos, «corré», «levantalo»).

## Puesta en marcha

```bash
npm install
npx playwright install chromium
cp config.example.json config.local.json   # opcional: casosDir y cacheDir
cp -R examples/casos ./casos               # caso de ejemplo
npm run dev                                # http://localhost:4510 (API + Vite con HMR)
```

- `config.local.json`, `casos/` y `capturas/` no se versionan.
- `CASOS_DIR` y `CASE_STUDIO_CACHE` tienen prioridad sobre `config.local.json` (ver `server/env.mjs`, que se importa primero en todo el servidor).

## Mapa del código

| Ruta | Qué hay |
|---|---|
| `cli.mjs` | CLI única. La mayoría de los comandos hablan con el servidor (`CS_URL`, por defecto `http://localhost:4510`). |
| `server/index.mjs` | API Express, eventos SSE para que el editor recargue y Vite en modo middleware. |
| `server/agent.mjs` | `analyze`, `featured` y `video` (CLI para el agente). |
| `server/agent-daemon.mjs`, `server/agent-client.mjs` | Daemon que mantiene un Chromium abierto entre `analyze` y `featured`, y el cliente que lo levanta. |
| `server/capture.mjs` | Captura completa de un caso, detección de secciones y componentes, grabación del scroll del editor. Exporta helpers (`open`, `autoScroll`, `HIDE_SCRIPT`, `dismissBanners`). |
| `server/animate.mjs` | Animaciones de carga y de secciones, cuadro por cuadro con reloj controlado. |
| `server/export.mjs` | Renderiza `/?render=1&…` con Playwright y compone los videos con ffmpeg. |
| `server/store.mjs` | Lectura y escritura de `visual/studio.json`, assets y miniaturas. |
| `server/browser.mjs` | `launchBrowser()`: Chromium sin marcas de automatización. Usalo siempre en vez de `chromium.launch()` para abrir sitios de terceros. |
| `shared/` | Modelo, plantillas y generación. Lo usan el editor, el servidor y la CLI: no importes nada de Node ni del DOM acá. |
| `src/` | Editor en React. `FrameView.tsx` es el único renderizador: el editor y la exportación usan el mismo. |
| `scripts/` | Scripts sueltos para exportar, rehacer WebP y armar la subida a Webflow. |

Fuente de verdad de cada caso: `<casosDir>/<slug>/visual/studio.json`. Para modificarlo con el servidor andando, usá la CLI o `POST /api/project/:slug/replace`: así el editor abierto recarga y no pisa el archivo.

## CLI para el agente: capturas, destacadas y video

No necesita el servidor. Todo se guarda en `capturas/<sitio>/`. Viewports: `web` (1440×900, captura a 2x) o `mobile` (390×844, captura a 3x); por defecto `web`.

```bash
node cli.mjs video <url> web --detach      # 1. graba en segundo plano → screen-record/web.mp4 (+ web.log)
node cli.mjs analyze <url> web             # 2. web/page.png + web/page.yml + web/page.json
#                                            3. leer page.yml (y page.png) y elegir refs
node cli.mjs featured <url> web e126 e337 e904+e941 --ancho   # 4. → web/featured/NN-<pos>.webp
node cli.mjs close                         # 5. apaga el daemon y el navegador
```

- **Posiciones de `featured`:** `e45` (ref del YAML), `e45+e60` (caja que cubre a todas), `x,y,w,h` (px CSS de la página) o un array JSON (`'["e45","e60+e61"]'`). Opciones: `--pad N`, `--ancho`, `--append`, `--format webp|png|jpg`.
- **Las refs solo valen para el último `analyze` de esa URL y viewport.** Cambian entre cargas de la página. `analyze` y `featured` corren en el mismo daemon, sobre la misma página, así que coinciden. Si el daemon se reinició, `featured` reabre la página y reubica las refs por firma y caja, y lo avisa con `(reubicado: e338→e337)`. Si el elemento ya no existe, volvé a correr `analyze`.
- **Para elegir secciones en `page.yml`:** las secciones suelen ser los hijos directos de `main`, con `[box=x,y,w,h]` de ancho casi completo. Elegí bloques enteros: la regla de las plantillas es no cortar una unidad por la mitad.
- **El video graba en tiempo real** con `page.screencast` (no cuadro por cuadro). Con `--detach`, esperá a que `screen-record/<viewport>.log` termine en `LISTO` o `Error`. El `.mp4` aparece recién cuando está completo.
- **El daemon** escucha en `127.0.0.1`, guarda su estado en `capturas/.agent-daemon.json` y su log en `capturas/.agent-daemon.log`. Se apaga solo tras 30 minutos sin uso (`CS_AGENT_IDLE_MIN`). Si cambiás `server/agent*.mjs`, `capture.mjs` o `browser.mjs`, la CLI lo reinicia en la próxima llamada.

## CLI del editor (requiere `npm run dev`)

```bash
node cli.mjs                    # ayuda completa
node cli.mjs list
node cli.mjs status <caso>      # sets, imágenes y capas con índices
node cli.mjs generate <caso> --kind webflow --bg variado --sin-dispositivos --video
node cli.mjs export <caso> webflow --format webp
```

Referencias: sets por nombre, id o número; imágenes como `webflow:3`; capas por número, id o nombre. `k+=n` y `k-=n` son relativos.

## Verificación

No hay tests automatizados, linter ni CI. Antes de dar algo por terminado:

- `npm run typecheck`: TypeScript sobre `src/` y `shared/` (tiene que pasar sin errores).
- `node --check <archivo>.mjs` para cada archivo de `server/` o `cli.mjs` que toques (el typecheck no los cubre).
- Probá el cambio de punta a punta contra un sitio real. Para la CLI del agente: `analyze`, `featured` y `video` con una URL, y revisá las imágenes que salen (que el recorte coincida con la sección pedida). Para el editor: `npm run dev` y la vista afectada en `http://localhost:4510`.
- `npm run build` si tocaste el front o la configuración de Vite.

## Estilo de código

- ESM puro (`"type": "module"`); el servidor y la CLI en `.mjs`, `shared/` en `.js` y el editor en `.tsx` / `.ts`.
- Comillas simples, punto y coma, 2 espacios. Las líneas pueden ser largas: el código existente no corta llamadas a mano.
- Comentarios cortos en español que explican el porqué, no el qué. Los nombres de variables y funciones van en inglés; los de campos de datos, roles y flags, en español cuando ya lo están (`grilla`, `--sin-dispositivos`, `--ancho`).
- Mensajes al usuario en español, con la acción concreta para salir del error (por ejemplo, «Corré primero: analyze <url> web»).
- Escrituras de archivos que otro proceso puede estar esperando: escribí a un temporal y renombrá (ver `video` en `server/agent.mjs`).
- Imágenes grandes: `sharp(..., { limitInputPixels: false })`. WebP no pasa de 16 383 px por lado y Chromium falla cerca de 16 384 px por captura: capturá por tramos o a escala `css`.

## Commits y PRs

- Mensajes en español con prefijo convencional: `feat: …`, `fix: …`, `refactor: …`, `docs: …`.
- Antes de commitear: `npm run typecheck` y `node --check` en los `.mjs` modificados.
- No commitees `casos/`, `capturas/`, `config.local.json` ni exportaciones.
- Si cambiás comandos, flags o la salida de la CLI, actualizá la ayuda en `cli.mjs` (`HELP`), el README y este archivo.

## Problemas conocidos

- **Exportar es lento.** `recordScroll` (`server/capture.mjs`), que usan `record`, `capture --video` y `batch`, saca una captura por cuadro. `animatedVersions` (`server/export.mjs`) vuelca cada cuadro a PNG en disco y rearma el WebP en cada intento hasta que entra en 4 MB.
- **El video de `video` sale a la resolución del viewport en px CSS:** en mobile, 390×844. `page.screencast` no graba a 2x: con un `size` mayor solo agrega relleno.
- **Cuadros repetidos:** al grabar en tiempo real con la máquina cargada pueden aparecer algunos (≈5 % con `analyze` corriendo en paralelo).
- **Sitios con Lenis u otro scroll suave:** la grabación lo detiene (`window.lenis.destroy()`) y fuerza `scroll-behavior: auto`.
- **Banners de cookies y chats** se ocultan con `HIDE_SCRIPT` y `dismissBanners`. Si algo tapa la página, pasá `--hide ".selector"`.
