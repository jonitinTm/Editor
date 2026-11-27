# Photocap Creative Studio: especificación por módulos

Photocap es un estudio creativo 2D: fotografía (el núcleo), ilustración, animación 2D, pixel art y recursos para videojuegos. Cada área es un **espacio de trabajo**: la barra enseña solo sus herramientas y tiene sus formas de empezar. Los menús siempre lo tienen todo, así que ninguna función se pierde al cambiar de espacio.

**Modelo de negocio (decidido):** todas las funciones son gratis. La compra única de 3,99 € solo quita los anuncios discretos. No se bloquean herramientas profesionales. Las funciones de IA funcionan en el propio dispositivo, sin servidores ni créditos. Si algún día hubiera IA en la nube, iría aparte y con límites claros; nunca se prometería ilimitada por 3,99 €.

Estados: ✅ hecho y con prueba automática · 🟡 hecho en parte · ⬜ pendiente.

## 0. Pantalla de inicio y espacios de trabajo — ✅

| Requisito | Prueba de aceptación |
|---|---|
| Al abrir sin documento se ve «¿Qué quieres crear hoy?» con 5 tarjetas | t247: hay 5 tarjetas en este orden: fotografía, ilustración, animación, pixel art y juegos |
| Cada tarjeta abre sus formas de empezar y deja elegido ese espacio | t247: pixel art ofrece 6 formas; «Personaje 32 × 32» crea un 32×32 de pixel art con la herramienta de píxeles |
| La barra enseña solo las herramientas del espacio | t247: en pixel art se ven menos botones; «Todas las herramientas» los vuelve a enseñar |
| Al cambiar de espacio, si la herramienta actual no está, se pasa a una que sí esté | t247: de píxeles a ilustración pasa al pincel |
| El espacio se recuerda entre sesiones y se cambia con el botón de arriba | t247 |
| Cabe en el móvil | captura en un Pixel 7 simulado |

## 1. Fotografía — ✅ (núcleo)
Capas, máscaras, capas de ajuste, objetos inteligentes, curvas y niveles, revelado RAW de 16 bits, separación de frecuencias, quitar objetos, relleno y ampliación según el contenido, IA en el dispositivo (fondo, cielo, sujeto, ampliar), procesamiento por lotes, acciones y macros, y exportación a PSD, TIFF, WebP, PNG y JPG. Para redes: pegatinas, tamaños para todas las redes, carrusel, antes y después y foto en movimiento (t246).

## 2. Ilustración — ✅
Pinceles con presión (activable), estabilizador, simetría, asistente de perspectiva, formas rápidas, pinceles propios e importación de .abr, capas vectoriales y trazados, calco de fotos (la foto se aclara y se bloquea y encima queda una capa para dibujar).
- 🟡 Modelos 3D de referencia: solo sombras y extrusión, no maniquíes.

## 3. Animación 2D

| Requisito | Estado / prueba |
|---|---|
| Lienzo y FPS configurables, línea de tiempo, fotograma a fotograma | ✅ t233, t237 |
| Papel cebolla (anterior, 2 anteriores, anterior y siguiente, en color) | ✅ t233 |
| Duplicar, mover, borrar y alargar fotogramas (×2, ×3…) | ✅ t237 |
| Interpolación con suavizado, estirar y aplastar, y punto de giro | ✅ t242 |
| 12 animaciones rápidas (rebotar, flotar, latido…) | ✅ t242 |
| Nombres de animación (etiquetas) | ✅ t242 |
| Reproducir en bucle, ida y vuelta, al revés, una vez o solo esta animación | ✅ t247 |
| Probador a tamaño real sobre distintos fondos | ✅ t247 |
| Exportar GIF, vídeo, PNG y hoja de sprites + JSON de Aseprite | ✅ t242 |
| Importar audio para sincronizar | ⬜ fase siguiente: pista de audio que suena al reproducir y se mezcla en el vídeo |
| Cámara 2D (zoom y desplazamiento animados) | ⬜ |
| Huesos, mallas, cinemática inversa, sincronía labial, partículas | ⬜ fase avanzada: es un motor aparte (como Spine) y se hará sobre capas recortadas con un esqueleto propio |

## 4. Pixel art — ✅
Píxel perfecto, cuadrícula, paletas (importar y exportar .gpl, .pal y .hex), tramas, sombreado con la paleta, rampas de color, ajustar a la paleta, contorno de 1 píxel, cambiar colores, Scale2x, rotación sin píxeles sueltos (RotSprite), degradado tramado, mosaico repetible y exportación nítida (t229–t246).

## 5. Videojuegos

| Requisito | Estado / prueba |
|---|---|
| Texturas generadas y propias con detalles, repetibles | ✅ t236, t241 |
| Mapas normal, relieve, rugosidad y oclusión | ✅ t236 |
| Editor de mapas de tiles (Tiled .tmj, CSV, PNG) | ✅ t244 |
| Cortar hojas de sprites, atlas + JSON, potencia de 2 | ✅ t238 |
| Pivote y cajas de colisión por fotograma, en el JSON | ✅ t247 |
| Interfaz del juego: botones (4 estados), barras de vida, paneles, corazones | ✅ t247 |
| Iconos para todas las tiendas | ✅ t243 |
| Autotiles o terrenos (bordes automáticos) | ⬜ |
| Exportación directa de escenas para Godot o Unity (.tscn, prefab) | ⬜ por ahora: JSON, .tmj y PNG, que los dos importan |

## 6. Comunes

| Requisito | Estado |
|---|---|
| Historial de versiones | ✅ historial de pasos, instantáneas y «Mis proyectos» |
| Sincronización en la nube y colaboración | ⬜ necesita servidor; queda fuera de la primera versión de Google Play |
| Plugins | ⬜ |

## Orden de trabajo restante
1. Audio en la animación.
2. Cámara 2D.
3. Autotiles.
4. Esqueleto 2D: huesos sobre capas, cinemática inversa sencilla y exportación de los fotogramas resultantes.
5. Nube y colaboración, solo si el producto lo pide.

Antes de cada fase: no romper lo que ya funciona (la batería completa de pruebas, más las pruebas al azar con ratón y con dedo) y medir en un móvil Android real con lienzos grandes.
