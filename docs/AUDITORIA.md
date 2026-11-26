# Auditoría y estado del editor

Informe vivo: qué hay, cómo está hecho, qué se ha probado de verdad y qué falta. Se actualiza en cada fase.
Última revisión: 26-11-2026. Copia de seguridad antes de esta fase: etiqueta git `respaldo-antes-de-auditoria-2026-11-26`
(además, cada cambio es un commit: cualquier versión anterior se puede recuperar).

## 1. Cómo está construido

| Parte | Qué es |
|---|---|
| Lenguaje | TypeScript sin frameworks (≈150 módulos en `src/`). Solo 3 dependencias de desarrollo: TypeScript, Vite y vite-plugin-singlefile (licencia MIT). |
| Compilación | `npm run build` genera dos versiones: `app/Editor.html` (un solo archivo, funciona sin servidor) y la web en partes (`index.html` + `assets/`), que es la que se publica y la que usaría la app de Android. |
| Núcleo (`src/core`) | Documento, capas (píxeles, texto, forma, ajuste, objeto inteligente, grupo), compositor con modos de fusión, historial por parches, selección, perfiles de color, polyfills de Safari. |
| Herramientas (`src/tools`) | ≈80 herramientas (pinceles, selección, retoque, pluma, texto, formas, recorte, deformación…). |
| Filtros (`src/filters`) | 144 filtros y ajustes; los pesados se calculan en un hilo aparte (Web Worker) y las capas de ajuste usan tablas de color y la tarjeta gráfica (WebGL2) cuando la hay. |
| Archivos (`src/io`) | PNG, JPG, WebP, GIF, TIFF, BMP, TGA, ICO, SVG, PDF, PSD (lectura y escritura con capas), RAW (DNG, CR2, NEF, ARW), proyecto propio `.edp`, biblioteca «Mis proyectos». |
| IA (`src/ai`) | Modelos que se ejecutan **en el propio dispositivo** (ONNX/transformers.js): quitar fondo, seleccionar sujeto, borrar objetos, profundidad, ampliar. Se descargan la primera vez; las fotos no salen del dispositivo. |
| Interfaz (`src/ui`) | Diseño de escritorio, tableta y móvil; 9 idiomas (es, en, fr, pt-BR, it, de, ru, zh, ja) con un diccionario por idioma (`src/i18n/data`). |

## 2. Estado por áreas (comprobado con pruebas, no solo visualmente)

Leyenda: ✅ hecho y con prueba automática · 🟡 hecho con limitaciones · ❌ falta.

### Edición fotográfica
- ✅ Revelado (tipo Camera Raw): temperatura, matiz, exposición, contraste, luces, sombras, blancos, negros, claridad, **textura**, neblina, intensidad, saturación, viñeta, **desvanecimiento**, **grano**, enfoque, reducción de ruido.
- ✅ Curvas (RGB y por canal, puntos editables, histograma), niveles, tono/saturación por gamas de color, equilibrio de color, gradación de color (sombras/medios/luces), mezclador de canales, corrección selectiva, mapa de degradado, LUT `.cube`.
- ✅ Cada control con valor por defecto tiene **↺ para restablecerlo** (también doble toque).
- ✅ **33 looks en 11 categorías** (Retrato, Paisaje, Cine, B/N, Vintage, Analógico, Nocturna, Moda, Arquitectura, Naturaleza, Comercial) con **intensidad**; se pueden combinar y guardar como «Mis looks». Son capas de ajuste reales.
- ✅ 144 filtros revisados uno a uno sobre una foto real (hoja de contactos). Corregidos este ciclo: Resplandor de neón, Semitono de color.

### Capas
- ✅ Crear, borrar, duplicar, ocultar, bloquear (transparencia, píxeles, posición, todo), renombrar, reordenar arrastrando, grupos, opacidad y relleno, transformar, alinear, distribuir, combinar, exportar capas.
- ✅ 27 modos de fusión, verificados numéricamente contra las fórmulas.
- ✅ Capas de ajuste, máscaras de capa y vectoriales, máscaras de recorte, máscaras de luminosidad y de degradado, capa de referencia.
- ✅ Objetos inteligentes reales (el contenido original se conserva; filtros inteligentes editables; reemplazar contenido).

### Retoque y selección
- ✅ Pincel corrector, puntual, tampón, parche, movimiento con detección de contenido, sobreexponer/subexponer/esponja, desenfocar/enfocar/dedo, pinceles personalizados, dureza, flujo, espaciado, estabilizador, presión e inclinación del lápiz.
- ✅ Separación de frecuencias (textura y color en capas separadas).
- ✅ Marcos, lazos, varita, selección rápida, gama de colores, luminosidad, cielo, sujeto; sumar/restar/intersecar, invertir, calar, expandir, contraer, borde, «Seleccionar y aplicar máscara».
- 🟡 Selección de cabello: «Seleccionar y aplicar máscara» con refinado de bordes y el modelo de quitar fondo; no es una segmentación profesional de cabello pelo a pelo.

### Texto y diseño
- ✅ Texto editable (fuentes del sistema y de la biblioteca, estilos mezclados en un mismo párrafo, interletraje, interlineado, alineación, texto en trazado, deformado), formas vectoriales, estilos de capa (sombra, sombra larga, resplandor, trazo, bisel, superposiciones), plantillas, marcas de agua, marcos, collage.

### RAW y color
- ✅ RAW: DNG (completo), Canon CR2, Nikon NEF, Sony ARW (con pruebas por fabricante). 🟡 No es soporte universal de RAW: otros modelos/variantes pueden abrir solo la vista previa (se avisa).
- ✅ Perfiles ICC: un PSD en Adobe RGB/Display P3 se convierte a sRGB (comparado con LittleCMS: diferencia máx. 1/255); al guardar, PSD/PNG/JPG declaran sRGB.
- ✅ EXIF: se lee al abrir y **se puede conservar al exportar en JPG** (orientación corregida; GPS fuera salvo que se pida). Comprobado con PIL.
- ✅ Histograma, avisos de luces quemadas y sombras empastadas, prueba de impresión CMYK.
- ❌ Edición a 16 bits por canal (el editor trabaja a 8 bits). Es el principal hueco técnico.

### Proyectos y guardado
- ✅ Formato propio `.edp` (capas, máscaras, ajustes, textos, formas, estilos, objetos inteligentes).
- ✅ Mis proyectos: carpetas, buscar, duplicar, renombrar, versiones anteriores, copia de seguridad en ZIP, miniaturas, fechas.
- ✅ Autoguardado y recuperación tras cierre inesperado; detección de «se cerró de golpe».
- ✅ Pasar proyectos del móvil a la tableta (dentro de un PNG, por Quick Share/Drive/correo) y recibirlos con «Compartir».
- 🟡 PSD: lectura y escritura con capas, máscaras, textos, estilos, guías, trazados y canales; no se promete compatibilidad total con todas las funciones de Photoshop.

### Exportación
- ✅ JPG, PNG, WebP, TIFF, BMP, TGA, ICO, GIF animado, WebM, PDF, SVG, PSD; calidad, escala, peso máximo, varios tamaños, por mesa de trabajo, capas a archivos, lotes, redes sociales.
- ✅ No se reduce la resolución sin avisar (salvo el límite de Safari en iPhone/iPad, ≈16,7 MP, que avisa).

### Interfaz móvil y tableta
- ✅ Diseños propios para móvil (≤700 px), tableta vertical/pantalla dividida (≤900 px) y escritorio/tableta horizontal; plegables; reencuadre al girar o plegar.
- ✅ Gestos (pellizcar, girar, 2/3 dedos deshacer/rehacer y mantenerlos, 4 dedos interfaz), rechazo de palma, lápiz con presión e inclinación, botón rápido (tecla en pantalla y menú circular), atajos configurables, reglas, guías, cuadrícula, ajuste magnético.
- ✅ Corregido este ciclo: en iPhone el lienzo no respondía al dedo (umbral de palma).

### Seguridad y privacidad
- ✅ Todo se procesa en el dispositivo; ninguna foto se sube. Sin claves ni credenciales en el código.
- ✅ Archivos dañados o maliciosos: se rechazan con un mensaje claro (pruebas con JPG corrupto, vacío, PSD cortado, proyecto dañado, PNG con proyecto roto).
- ✅ Informe de errores local (Ayuda › Informe de errores) sin datos de imágenes.

### Idiomas
- ✅ 9 idiomas con todos los textos traducidos (rastreo automático de las 466 ventanas en inglés y alemán: ningún texto sin traducir).
- ✅ Portugués adaptado a Brasil (pt-BR: «arquivo», «tela», «salvar», «câmera», trato de «você»).
- ❌ Coreano, árabe (requiere diseño de derecha a izquierda), hindi.

## 3. Pruebas ejecutadas

- **Resultado de la última pasada completa (26-11-2026):** de 221 pruebas, 15 fallaron en la primera vuelta. Revisadas una a una:
  - 10 eran pruebas antiguas que esperaban comportamientos que cambiamos a propósito (Ctrl+S ahora guarda en «Mis proyectos»; el rectángulo redondeado pasó a ser una opción de esquinas; el umbral de palma de 48 px que rompía el iPhone; 33 looks en lugar de 8). Se actualizaron las pruebas, no la app.
  - 1 era una prueba que no esperaba a que terminase un filtro en segundo plano.
  - 1 era un guion de depuración que no debía estar en la lista.
  - 1 prueba con un error de programación propio (corregido).
  - **1 fallo real de la app:** en el panel Ajustes el deslizador de intensidad de los looks (con el botón ↺ nuevo) se salía del panel y provocaba desplazamiento lateral. Corregido: los deslizadores se encogen si no caben.
  - Tras las correcciones, todas las pruebas afectadas pasan.
- **Fallo del proceso de publicación corregido:** compilar dos veces seguidas borraba las partes de la versión publicada (lo que provocaba el «Algo ha fallado» en pestañas abiertas). Ahora siempre se conservan las de la versión del último commit.
- Batería automática: 228 pruebas (`t1`–`t228`) con navegador real (Chromium), incluidas emulaciones de iPhone, Pixel, iPad, Galaxy Tab y plegables.
- «Prueba del mono»: miles de acciones al azar (escritorio y táctil) comprobando que la vista coincide con la imagen, que no hay errores y que guardar/abrir (proyecto y PSD) conserva la imagen.
- Rastreo de traducciones de toda la interfaz.
- Fotos de 12, 24 y 48 megapíxeles (abrir, pintar, filtrar, ajustes, deshacer, guardar, exportar).
- Validación externa: PSD con un validador de la especificación, perfiles de color con LittleCMS, EXIF y PNG con PIL.

**No se ha podido probar aquí** (requiere dispositivo o cuentas reales): dispositivos Android/iPhone físicos (solo emulación), motor de Safari (solo se simulan sus carencias), recepción con «Compartir» de Android (requiere la app instalada en https), compras y anuncios.

## 4. Plan priorizado (siguientes fases)

1. **Android y publicación** (necesita decisiones y cuentas tuyas): ver §5.
2. **Idiomas**: coreano, hindi y árabe (con diseño de derecha a izquierda).
3. **16 bits por canal** para revelado y ajustes (cambio profundo: se haría por etapas, empezando por el revelado RAW).
4. **IA en la nube** (expansión generativa, restauración, colorización) solo como paquete opcional y con costes medidos; hoy toda la IA es local y gratuita.

## 5. Estrategia para Google Play (recomendación)

- **Recomendado: Capacitor** (envoltorio nativo de la web actual, licencia MIT). Reutiliza el 100 % del código, y da acceso nativo a lo que la web no puede: **AdMob** (anuncios en apps), **Google Play Billing** (compra única de 3,99 € con restauración ligada a la cuenta de Google) y archivos/compartir del sistema.
- Alternativa más simple (ya documentada en `docs/PUBLICAR.md`): **TWA** (la app abre la web a pantalla completa). Admite Play Billing (Digital Goods API) pero no AdMob, así que el modelo de anuncios + compra se complica.
- Lo que hace falta de ti: cuenta de Google Play Console (25 $ una vez), cuenta de AdMob, nombre de la app, correo de contacto y, si se usa TWA, un dominio propio.
- Coste de servicios hoy: **0 €** (sin servidores; la IA es local).
