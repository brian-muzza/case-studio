# Case Studio

Herramienta para armar las imágenes y videos de los casos de estudio de un estudio web, a partir del sitio de cada proyecto.

Para cada caso:

- captura el sitio con Playwright (pantallas, secciones, componentes, páginas completas, mobile y fotos);
- graba el scroll y las animaciones, cuadro por cuadro;
- arma sets de imágenes con plantillas, en dos destinos: la galería del caso en Webflow (con su grilla) y el carrusel de Instagram;
- exporta en WebP, JPG, PNG o MP4.

Incluye un editor tipo «mini Figma» para ajustar cada imagen y un tablero para revisar todos los casos y dejar comentarios. También tiene una CLI para manejar todo desde la terminal o desde un asistente de IA: el editor recarga en vivo los cambios hechos por fuera.

## Requisitos

- Node.js 20 o superior.
- ffmpeg en el `PATH`, con libx264 y libwebp.
- Chromium de Playwright: `npx playwright install chromium`.

## Puesta en marcha

```bash
npm install
npx playwright install chromium
cp config.example.json config.local.json   # opcional: dónde están los casos y la caché
cp -R examples/casos ./casos               # caso de ejemplo para probar
npm run dev                                # http://localhost:4510
```

### `config.local.json`

No se versiona. Todas las claves son opcionales.

| Clave | Qué es |
|---|---|
| `casosDir` | Carpeta con los casos. Por defecto, `./casos`. |
| `cacheDir` | Carpeta para temporales pesados: Chrome, ffmpeg y los navegadores de Playwright. Sirve para usar un disco externo. |

Las variables de entorno `CASOS_DIR` y `CASE_STUDIO_CACHE` tienen prioridad sobre el archivo.

## Datos

Cada caso es una carpeta dentro de `casosDir`:

| Ruta | Qué es |
|---|---|
| `caso.md` | Texto del caso. De acá se leen el cliente (`cliente:` en el frontmatter), la URL del sitio (`Sitio: https://…`) y el color de marca (`Color: #RRGGBB`). |
| `visual/studio.json` | Proyecto: capturas, sets, imágenes y capas. Es la fuente de verdad. |
| `visual/assets/cap-<sitio>-<fecha>/` | Capturas automáticas. |
| `visual/assets/rec-*`, `anim-*` | Grabaciones del scroll y de animaciones. |
| `visual/assets/up-*` | Subidas: capturas propias y grabaciones. Los `.mov` se pasan a MP4 H.264. |
| `visual/export/<set>/` | Exportaciones, con `manifest.json` (orden, alt y grilla). |

Al abrir un caso por primera vez se importan las imágenes de `caso-imagenes/`, `sitio/`, `antes/` y `figma/`, si existen.

`casosDir/_case-studio.json` guarda la configuración general:

| Clave | Qué es |
|---|---|
| `excluded` | Casos que no se muestran. |
| `urls` | URLs por caso, si no salen de `caso.md`. Se pueden pasar varias. |
| `marca` | `{ "nombre": "Mi estudio", "usuario": "mi.estudio" }`: nombre en el encabezado y usuario en la vista previa de Instagram. |
| `batch` | Progreso del armado masivo. Lo escribe la herramienta. |

## Conceptos

- **Captura (asset):** cada captura tiene un rol: `hero`, `screen`, `section`, `component`, `tramo`, `page`, `mobile`, `tramo-mobile`, `mobile-page`, `photo`, `logo` o `video`. Las plantillas eligen capturas por rol. El rol se puede cambiar desde la biblioteca.
- **Regla de las plantillas:** cada tarjeta muestra una unidad completa (una pantalla, una sección o un componente) con su proporción real. Solo se corta lo que sale por el borde de la imagen. No se repite el mismo contenido dentro de un set.
- **Set:** una serie de imágenes para un destino.
  - `webflow` usa una **grilla** (columnas por fila, por ejemplo `2,1,2,3`) y cada posición toma su formato: `wf-1` 1694×1292, `wf-2` 838×830, `wf-3` 552×478.
  - `instagram` usa un formato único: `ig-4x5`, `ig-3x4`, `ig-1x1` o `story-9x16`.
- **Imagen (frame):** formato, plantilla, fondo, escenario (rotación y perspectiva) y capas.
- **Capas:** `screen` y `video` (captura con recorte, radio y sombra), `text` y `rect`.
- **Fondo:** color, degradé o imagen con desenfoque, más trama, brillo, saturación y capa de color.

## Editor

- **Vistas:**
  - **Grilla:** simula la galería del caso en Webflow.
  - **Carrusel:** simula el post de Instagram.
  - **Frame:** edita una imagen en grande.
  - **Tablero** (`/?vista=tablero`): todos los casos, con el último set de cada tipo, un estado por caso y comentarios por imagen.
- **Edición:**
  - Clic para seleccionar y arrastrar para mover. El imán ajusta al centro y a los bordes.
  - Los handles redimensionan y el handle redondo rota.
  - Doble clic en una pantalla entra al modo recorte.
  - Arrastrar una captura de la biblioteca sobre una pantalla la reemplaza.
  - Atajos: ⌘Z / ⇧⌘Z, ⌘D para duplicar, ⌫ para borrar, flechas para mover de a 1 px. Guarda solo.
- **Generar:** arma un set completo con vista previa.
- **Exportar:** WebP para Webflow, JPG para Instagram o PNG. Las imágenes con video salen como MP4 con póster y, para Webflow, como WebP animado que entra en el límite de 4 MB.

## CLI

Con el servidor andando:

```bash
node cli.mjs list
node cli.mjs capture mi-caso --video                 # captura el sitio y graba el scroll
node cli.mjs generate mi-caso --kind webflow --bg variado --sin-dispositivos --video
node cli.mjs generate mi-caso --kind instagram --format ig-4x5
node cli.mjs status mi-caso                          # sets, imágenes y capas con índices
node cli.mjs template mi-caso webflow:3 screens-duo
node cli.mjs layer mi-caso webflow:2 1 x+=40 shadow=subtle
node cli.mjs export mi-caso webflow --format webp
node cli.mjs batch                                   # todos los casos: captura, graba, genera y exporta
node cli.mjs comentarios                             # comentarios abiertos del tablero
node cli.mjs                                         # ayuda completa
```

Referencias: los sets se indican por nombre, id o número; las imágenes como `webflow:3`; las capas por número, id o nombre. `k+=n` y `k-=n` son relativos.

### CLI para el agente

Comandos que no necesitan el servidor. Trabajan con una URL y un viewport (`web` 1440×900 o `mobile` 390×844; por defecto `web`) y guardan todo en `capturas/<sitio>/`:

```bash
node cli.mjs video useunbuild.com web --detach       # graba en segundo plano → screen-record/web.mp4
node cli.mjs analyze useunbuild.com web              # web/page.png + web/page.yml
node cli.mjs featured useunbuild.com web e126 e337 e904+e941 --ancho   # → web/featured/
node cli.mjs close                                   # al terminar: cierra el navegador
```

`analyze` y `featured` corren en un daemon local que mantiene un Chromium abierto, con una página por URL y viewport. `analyze` deja la página abierta con su snapshot y `featured` saca los screenshots sobre esa misma página, así que las refs de `page.yml` valen tal cual. La CLI levanta el daemon la primera vez (o lo reinicia si cambió el código) y el daemon se apaga solo tras 30 minutos sin uso (`CS_AGENT_IDLE_MIN`). Escucha solo en `127.0.0.1`; su estado y su log quedan en `capturas/.agent-daemon.*`.

| Comando | Qué hace |
|---|---|
| `analyze <url> [web\|mobile]` | Abre la página una vez y guarda la captura completa (`page.png`, a 2x en web y 3x en mobile), el árbol de accesibilidad con refs y cajas (`page.yml`) y las cajas de cada ref (`page.json`). |
| `featured <url> [web\|mobile] <posiciones…>` | Saca un screenshot de cada sección con Playwright, sobre la página que dejó abierta `analyze`. Cada llamada reemplaza la tanda anterior; con `--append` se suman. |
| `close [url] [web\|mobile]` | Cierra la página de esa URL (o las dos, web y mobile). Sin URL, apaga el daemon y el navegador. |
| `video <url> [web\|mobile]` | Graba la pantalla en tiempo real con `page.screencast` mientras la página baja sola, y lo pasa a MP4 H.264. Con `--detach` corre aparte y deja un log que termina en `LISTO` o `Error`. |

Posiciones de `featured`, en px CSS de la página:

- `e45`: la caja del elemento con `[ref=e45]` en `page.yml`.
- `e45+e60`: la caja que cubre a todos, por ejemplo el título y la grilla de una sección.
- `x,y,w,h`: una caja explícita.
- También acepta un array JSON: `'["e45","e60+e61"]'`.

Las refs cambian entre una carga y otra de la página (un texto animado de más corre la numeración). Si la página de `analyze` ya no está (se cerró el daemon o se usó `close`), `featured` la abre de nuevo, toma otro snapshot y busca cada ref por su firma (rol, nombre y texto) y por su caja en `page.json`. Si la encuentra con otro número, lo avisa: `(reubicado: e338→e337)`. Si ya no existe, pide correr `analyze` de nuevo.

Opciones: `--pad 24` agrega margen, `--ancho` estira el recorte a todo el ancho de la página y `--format webp|png|jpg` (por defecto `webp`; pasa a `jpg` si supera el límite de 16 383 px de WebP).

Flujo para el agente: lanzar `video … --detach`, correr `analyze`, leer `page.yml` y `page.png`, elegir las refs, pedir `featured` y terminar con `close`. El video se graba mientras tanto, en su propio proceso.

### Scripts

| Script | Para qué |
|---|---|
| `scripts/export-latest.mjs <caso…>` | Exporta el último set de Webflow (WebP) y el de Instagram (JPG). |
| `scripts/fix-webp.mjs <caso…>` | Rehace los WebP animados que pasan 3,8 MB. |
| `scripts/upload-plan.mjs <caso…>` | Arma el plan de subida a Webflow: archivos en orden, md5 y texto alternativo. |
| `scripts/alts.mjs` | Textos alternativos descriptivos por imagen. |
| `scripts/fixlib.mjs` | Funciones para corregir sets desde scripts: cambiar plantilla, reemplazar captura, agregar imagen. |

### Webflow

La subida al CMS la hace un asistente con el MCP de Webflow, a partir de `scripts/upload-plan.mjs`:

1. Registra cada archivo con `create_asset` y lo sube a S3.
2. Carga en el ítem del caso los campos `galeria` (imagen múltiple, con alt), `grilla` (texto) y, si existe, `pagina-completa`.

No publica nada: los cambios quedan sin publicar hasta que alguien los revise.

## Arquitectura

| Carpeta | Qué tiene |
|---|---|
| `server/` | Express y Vite en un solo puerto. Ver detalle abajo. |
| `shared/` | Modelo, plantillas y generación. Lo usan el editor, el servidor y la CLI. |
| `src/` | Editor en React. `FrameView.tsx` es el único renderizador: el editor y la exportación usan el mismo. |

Archivos de `server/`:

- `agent.mjs`: comandos `analyze`, `featured` y `video` de la CLI para el agente.
- `agent-daemon.mjs` y `agent-client.mjs`: el daemon que mantiene la página abierta entre `analyze` y `featured`, y el cliente que usa la CLI.
- `capture.mjs`: capturas y grabación del scroll.
- `animate.mjs`: animaciones de carga y de secciones.
- `export.mjs`: Playwright renderiza `/?render=1&…` y ffmpeg compone los videos.
- `store.mjs`: archivos y miniaturas con sharp.
- `browser.mjs`: Chromium sin marcas de automatización, para sitios con protección o videos de Vimeo.
- `env.mjs`: carpeta de casos y caché.

## Límites conocidos

- Hay una sola capa de video por imagen, sin rotación ni escenario 3D: el MP4 se compone en plano.
- La captura detecta secciones por `section`, `header` y `footer`. En sitios sin esa estructura corta la página por altura de pantalla.
- Las páginas muy largas se capturan a 1× para no superar el límite de Chromium. `analyze` no tiene ese límite: captura en tramos y los une.
- `video` graba a la resolución del viewport en px CSS: `page.screencast` no graba a 2x. En mobile el video sale de 390×844.
- `video` graba en tiempo real: si la máquina está cargada pueden aparecer algunos cuadros repetidos.
