# Editor

Editor de imágenes por capas que funciona en el navegador, con la interfaz en español.
**Todo ocurre en tu equipo**: las imágenes no se suben a ningún servidor y funciona sin conexión a internet.

## Abrirlo en la web

**https://jonitintm.github.io/Editor/** — se abre directamente en el navegador, sin descargar nada.
Aunque esté en la web, todo sigue ocurriendo en tu equipo: las imágenes no se envían a ningún sitio.
Tras la primera visita funciona también sin conexión, y en Chrome o Edge se puede instalar como aplicación
(icono «Instalar» en la barra de direcciones).

> La página la publica GitHub Pages desde la raíz de la rama principal (`index.html`). Si no apareciera, revisa en
> GitHub *Settings › Pages* que la fuente sea «Deploy from a branch», rama `claude/nice-galileo-6pmws2`, carpeta `/ (root)`.

## Abrirlo desde un archivo en Windows

1. En GitHub, entra en el repositorio, elige la rama `claude/nice-galileo-6pmws2` y pulsa **Code › Download ZIP**.
2. Descomprime el ZIP (clic derecho › *Extraer todo…*).
3. Entra en la carpeta `app` y haz **doble clic en `Editor.html`**. Se abre en tu navegador.
   - Funciona mejor en **Google Chrome** o **Microsoft Edge** recientes.

Ese único archivo `Editor.html` contiene el programa entero: puedes copiarlo a donde quieras.

## Qué puede hacer (primera fase)

| Área | Funciones |
|---|---|
| Documento | Nuevo (tamaños predefinidos), abrir PNG/JPG/WebP/GIF/PSD desde archivo, arrastrando o pegando (Ctrl+V); varias pestañas; zoom, desplazamiento, reglas y guías |
| Capas | Crear, duplicar, borrar, renombrar (doble clic), reordenar arrastrando, grupos, opacidad, visibilidad, bloqueo, 17 modos de fusión, máscaras de capa, combinar, acoplar |
| Herramientas | Mover, marco rectangular/elíptico, lazo, varita mágica, recortar, pincel, lápiz, borrador, bote de pintura, degradado, cuentagotas, texto (editable), formas, tampón de clonar, mano, zoom y transformación libre (escalar, girar, voltear) |
| Ajustes y filtros | Brillo/contraste, niveles, curvas, tono/saturación, blanco y negro, desaturar, invertir, desenfoque gaussiano, máscara de enfoque, enfocar, añadir ruido (con vista previa) |
| Historial | Deshacer/rehacer y panel con todos los pasos |
| Guardar | Exportar a PNG, JPG, WebP y PSD; proyecto `.edp` que conserva todo (capas, máscaras, textos, formas, ajustes, estilos y guías) |

## Fase 2 (en marcha)

Ya disponible:

- **Capas de ajuste** (no destructivas): brillo/contraste, niveles, curvas, tono/saturación, blanco y negro, desaturar e
  invertir. Se crean desde *Capa › Nueva capa de ajuste* o con el botón ◐ del panel de capas, se editan en *Propiedades*
  y llevan máscara propia.
- **Estilos de capa**: sombra paralela, trazo exterior y resplandor exterior (botón *fx* del panel de capas).
- **PSD y PSB**: abrir y guardar archivos de Photoshop. Comprobado contra 126 archivos reales de Photoshop.
  - *Al abrir*: capas, grupos (también en modo «Pasar»), máscaras de píxeles y vectoriales, máscaras de recorte,
    opacidad y modos de fusión; documentos RGB, grises y CMYK (convertido a RGB) de 8, 16 y 32 bits; formas;
    **texto editable** (se ve como en Photoshop hasta que lo cambias); **objetos inteligentes** con su contenido;
    efectos (sombra paralela e interior, resplandor exterior e interior, trazo, superposición de color y de degradado)
    y ajustes (brillo/contraste, niveles, curvas, tono/saturación, exposición, intensidad, equilibrio de color,
    blanco y negro, mezclador de canales, posterizar, umbral, invertir).
  - *Al guardar*: todo lo anterior salvo que se guardan como píxeles el texto creado o editado en Editor, los objetos
    inteligentes y las formas con trazo. El texto de Photoshop que no hayas editado se devuelve intacto.
  - Sin soporte todavía: biselado, satinado y motivos; filtro de fotografía, mapa de degradado, corrección selectiva
    y consulta de colores; modos Lab e indexado.
- **Ajustes y estilos nuevos** en el propio editor: exposición, intensidad, equilibrio de color, mezclador de canales,
  posterizar, umbral y blanco y negro por familias de color; sombra y resplandor interiores y superposición de color
  y de degradado.
- **Pluma y trazados**: la pluma (`P`) dibuja curvas Bézier y crea una capa de forma vectorial; la selección directa
  (`A`) mueve sus puntos y tiradores; *Seleccionar › Trazado a selección* (`Ctrl+Intro`) la convierte en selección.
  Los trazados cerrados se guardan en PSD como formas vectoriales.
- **Filtros avanzados** (menú *Filtro*): desenfoque de movimiento y radial; molinete, encoger, esferizar y onda;
  hallar bordes y relieve; mosaico; mediana; paso alto, desplazamiento, máximo y mínimo.
- **Herramientas de retoque**: lazo poligonal, desenfocar, enfocar, dedo, sobreexponer y subexponer.
- **Animación**: *Ventana › Línea de tiempo*. Cada cuadro recuerda qué capas se ven; se reproduce en el editor y se
  exporta como **GIF animado**. Los GIF animados se abren con una capa y un cuadro por fotograma.
- **RAW de cámara**: DNG, Canon CR2, Sony ARW y Nikon NEF se revelan desde los datos del sensor (ver más abajo); de
  los demás (CR3, ORF, RW2, RAF…) se abre la vista previa JPEG que la cámara guarda dentro del archivo.
- **Interfaz**: selector de color propio, paneles *Color* y *Muestras*, paneles agrupados en pestañas, menú *Ventana*,
  menú contextual en las capas, teclas numéricas para la opacidad, `Tab` para ocultar paneles y `F` para pantalla completa.
- **Retoque profesional**: pincel corrector puntual (`J`: pinta sobre la imperfección y desaparece), pincel corrector
  (`Mayús+J`, con origen elegido con Alt+clic) y *Edición › Rellenar según contenido* (`Mayús+Retroceso`).
- **Máscara rápida** (`Q`): la selección se ve como una capa roja y se edita con cualquier herramienta de pintura.
- **Motor de pincel**: suavizado del trazo, espaciado y Alt para tomar color mientras se pinta.
- **Bloquear transparencia** (panel Capas): solo se pinta donde ya hay píxeles; se conserva en proyecto y en PSD.
- **Transformación avanzada**: *Edición › Transformar › Distorsionar / Perspectiva*, o Ctrl+arrastrar una esquina en la
  transformación libre.
- **Filtro › Licuar** (`Mayús+Ctrl+X`): deformar, reconstruir, suavizar, molinete, inflar y desinflar.
- **Paneles Navegador, Histograma e Información** (pestañas junto a Propiedades e Historial).
- **Texto avanzado**: texto de párrafo (arrastra una caja con la herramienta Texto y las líneas se ajustan solas),
  interletraje, interlineado, subrayado, tachado y mayúsculas.
- **Archivo**: *Imagen › Duplicar*, *Archivo › Exportar capas a archivos* (ZIP con un PNG por capa) y cambio de tamaño
  al exportar.
- **Punta del pincel**: ángulo, redondez y dispersión (para pinceles caligráficos o de textura).
- **Degradados**: editor con varias paradas de color y opacidad, predefinidos, y tipos lineal, radial, angular,
  reflejado y diamante.
- **Canales alfa**: *Selección › Guardar / Cargar selección* y panel *Canales* (junto a Capas).
- **Filtros inteligentes**: los filtros y ajustes aplicados a un objeto inteligente quedan como filtros inteligentes,
  que se pueden ocultar, editar o eliminar después desde *Propiedades* (también después de escalar o girar el objeto).
- **Motivos**: *Edición › Definir motivo* (de la selección o la imagen), *Rellenar…* con motivo (con escala) y el bote de
  pintura con motivo; incluye varios motivos de serie.
- **Panel Capas**: búsqueda por nombre y etiquetas de color (clic derecho; también se leen y guardan en PSD).
- **Historial**: instantáneas para volver a un estado guardado.
- **Selección rápida** (`W`): pinta sobre lo que quieres seleccionar y la selección se ajusta sola a los bordes
  (Alt para restar). **Seleccionar y aplicar máscara** (`Alt+Ctrl+R`): suavizar, calar, contraste y desplazar borde con
  vista previa sobre rojo, negro, blanco o transparente; salida a selección, máscara o capa nueva.
- **Ajuste magnético y guías inteligentes**: al mover capas, selecciones o el recorte se enganchan a los bordes y el
  centro del lienzo, a las guías y a otras capas (Ctrl mientras arrastras lo desactiva; *Vista › Ajustar*).
- **Fluidez**: deshacer, empezar a pintar y mover capas son mucho más rápidos en documentos grandes; los diálogos con
  vista previa se colocan a un lado sin oscurecer la imagen.
- **Girar vista** (`R`): gira el lienzo en pantalla para dibujar cómodo, sin cambiar la imagen (Esc la endereza).
- **Formas**: además de rectángulo, redondeado, elipse y línea: polígono, estrella, flecha y corazón.
- **Acciones** (panel junto a Capas): graba filtros, ajustes, tamaños, giros y operaciones de capa y repítelos con un
  clic. Incluye tres acciones de serie. *Archivo › Automatizar › Lote* aplica una acción a muchas imágenes y las
  descarga en un ZIP.
- **Filtro › Revelado (tipo Camera Raw)** (`Mayús+Ctrl+A`): temperatura, matiz, exposición, contraste, iluminaciones,
  sombras, blancos, negros, claridad, neblina, intensidad, saturación, viñeta, enfoque y reducción de ruido.
  También *Imagen › Ajustes › Sombras/Iluminaciones* y *Filtro › Ruido › Reducir ruido*.
- **Uso más ágil**: los filtros pesados calculan la vista previa en segundo plano (la ventana no se congela);
  clic derecho en el lienzo abre un menú con lo útil en ese momento; Alt + clic derecho y arrastrar cambia tamaño y
  dureza del pincel; mantener la letra de una herramienta la activa solo mientras la mantienes; Ctrl + arrastrar
  mueve la capa desde casi cualquier herramienta.
- **Recuperación automática**: el trabajo se copia cada pocos segundos en el propio navegador; si cierras la pestaña
  por accidente, al volver aparece «Recuperar» en la pantalla de inicio.
- **Más ajustes y edición**: tono, contraste y color automáticos; mapa de degradado y filtro de fotografía;
  *Edición › Contornear*; *Selección › Gama de colores*; botones de alinear en la herramienta Mover; cuadrícula (`Ctrl+'`).
- **Capas de relleno** (*Capa › Nueva capa de relleno*): color sólido, degradado o motivo, no destructivas y editables
  en *Propiedades*. Si hay una selección, se usa como máscara. Se guardan en PSD como rellenos editables (color y degradado).
- **Modos de fusión en capas de ajuste y de relleno** (Multiplicar, Trama, Color…), igual que en Photoshop.
- **Pegar en el mismo sitio** (`Mayús+Ctrl+V`) y **Pegar dentro de la selección** (`Alt+Mayús+Ctrl+V`, crea la capa con
  máscara). `Ctrl+V` normal pega en el centro de lo que estás viendo.
- **Preferencias** (`Ctrl+K`, en *Edición*): tema oscuro, gris medio o claro; tamaño de la interfaz; pasos de historial;
  distancia de ajuste de las guías; copia de recuperación automática.
- **Deformar** (*Edición › Transformar › Deformar*, o el modo «Deformar» con `Ctrl+T`): malla de 4×4 puntos como en
  Photoshop; arrastra los puntos, sus tiradores o directamente la imagen. Estilos predefinidos: arco, abultamiento,
  bandera, onda, pez, ascender, inflar, comprimir y giro, con su curvatura.
- **Lazo magnético** (grupo del lazo, `L`): haz clic en el borde y mueve el ratón; el contorno se pega solo a los
  bordes. Clic fija un punto, Alt+clic hace un tramo recto, Retroceso quita el último punto, Intro o doble clic cierra.
  Opciones de anchura, contraste y frecuencia, como en Photoshop.
- **Seleccionar sujeto** (*Selección › Sujeto*, o el botón en Selección rápida y Varita): selecciona automáticamente el
  objeto principal. Funciona muy bien cuando el fondo se distingue del sujeto (productos, retratos sobre fondo liso);
  en fotos muy complejas conviene retocar después con Selección rápida o *Seleccionar y aplicar máscara*.
- **Panel Pinceles** (junto a Color y Muestras): ajustes de pincel listos (duro, suave, aerógrafo, entintado,
  caligráfico, marcador, tiza, salpicado…) con vista previa del trazo; «+ Nuevo ajuste de pincel» guarda el tuyo.
- **Más ajustes**: *Corrección selectiva* (también como capa de ajuste, y se guarda en PSD), *Reemplazar color* y
  *Ecualizar*.
- **Más filtros**: desenfoque de superficie (suaviza la piel sin perder bordes), inclinación-desplazamiento (efecto
  miniatura), enfoque suavizado, polvo y rascaduras, coordenadas polares, rizo, cristalizar, pintura al óleo y nubes.
- **Mesas de trabajo** (*Capa › Nueva mesa de trabajo…*): varios lienzos en un mismo documento (por ejemplo, el mismo
  diseño para Instagram, historia y web). Cada una recorta su contenido y tiene su fondo; se mueven con Mover y se
  seleccionan haciendo clic en su nombre. Al exportar, cada mesa sale en su propio archivo. Se leen de los PSD.
- **Deformar texto** (*Capa › Texto › Deformar texto…*, botón en la barra del texto o en *Propiedades*): arco,
  bandera, onda… y el texto sigue siendo editable.
- **Exportar en varios tamaños a la vez**: en *Exportar como*, marca @0,5x, @2x o @3x y se descarga un ZIP.
- **Estilos de capa**: *Bisel y relieve* (interior, exterior, relieve y acolchado; profundidad, tamaño, ángulo, altitud,
  luces y sombras; se guarda en PSD) y *Superposición de motivo*, además de los que ya había.
- **Panel Trazados** (junto a Capas y Canales): la Pluma en modo «Trazado» guarda trazados sin crear capas; se pueden
  rellenar, contornear, convertir en selección y crear desde una selección (*Selección › Selección a trazado*).
- **Transformar › Sesgar** (o `Ctrl` + arrastrar un tirador lateral en la transformación libre).
- **Imagen › Rotación de imagen › Rotar lienzo un ángulo…** y herramienta **Regla** (con el cuentagotas, `I`): mide
  distancias y ángulos, y «Enderezar» pone recta una foto torcida.
- **Selección**: *Modificar › Borde* y *Suavizar*, *Extender* y *Similar*.
- **Herramientas nuevas**: borrador de fondos y borrador mágico (con el borrador, `E`), pincel de ojos rojos (con los
  correctores, `J`) y esponja (con sobreexponer/subexponer, `O`). El lazo magnético ya aparece en la barra.
- **Exportar a PDF y SVG**, e **Imprimir** (`Ctrl+P`).
- **Más fluido en imágenes grandes**: la vista usa una copia reducida que solo se actualiza donde cambia.
- **Fuentes**: más de 100 fuentes de Google Fonts (Montserrat, Poppins, Bebas Neue, Playfair…) con buscador,
  categorías y vista previa; se descargan solas al usarlas (solo la fuente: tus imágenes no salen del equipo).
  En Chrome y Edge también se pueden usar las fuentes instaladas en el equipo (categoría «Equipo»).
  Con la herramienta Texto y una capa de texto seleccionada, los cambios de la barra se aplican a toda la capa.
- **Puntas de pincel con imagen**: tiza, esponja, salpicadura, pincel seco, hierba, estrella, hoja y nube (botón de la
  punta en la barra del pincel), con «ángulo aleatorio»; y las tuyas con *Edición › Definir pincel* (a partir de una
  selección: lo oscuro pinta).
- **Consulta de colores** (ajuste o capa de ajuste): looks de cine (cian y naranja, película, vintage…) y archivos
  LUT `.cube`.
- **Transición** (`Mayús+Ctrl+F`): atenúa el último filtro, ajuste o trazo, con modo de fusión.
- **Pincel de historia** (`Y`): pinta con cómo estaba la imagen al abrirla (o en la última instantánea).
- **Sustitución de color** (con el pincel, `B`), **Fusionar si** (en *Estilo de capa*; se guarda en PSD),
  **Selección › Transformar selección**, **Imagen › Modo › Escala de grises**.
- **Resolución**: *Tamaño de imagen* trabaja en píxeles, cm, mm, pulgadas o %, con resolución (ppp) y la opción de
  remuestrear o no; *Nuevo documento* también tiene resolución. Se guarda y se lee en PSD, y el PDF sale a su tamaño real.
- **Degradados de varios colores** (con transparencia) en el *Mapa de degradado*, la capa de relleno de degradado y la
  superposición de degradado: se editan con el editor de degradados y se guardan en PSD.
- **Biblioteca de formas**: bocadillos, flechas, rayo, nube, gota, luna, ubicación, escudo, etiqueta, cinta, casa,
  visto bueno, cruz… (herramienta Forma, `U`). Siguen siendo vectoriales y editables.
- **Menú Ventana** con todos los paneles (Capas, Canales, Trazados, Historial, Pinceles, Info…).
- **Texto con varios estilos**: mientras editas un texto, selecciona una parte y cambia su color, fuente, tamaño,
  negrita, cursiva o subrayado; solo cambia esa parte. Los PSD con textos de varios colores o fuentes se importan así.
- **Más opciones de estilo de capa**: trazo exterior, interior o centrado con opacidad; extensión en la sombra y el
  resplandor; *Satinado*. Todo se guarda en PSD.
- **Objetos inteligentes**: *Nuevo objeto inteligente mediante copia* (contenido independiente) y *Exportar contenido*.
- **18 filtros más**: corrección de lente (barril/cojín, aberración cromática, viñeta), destello de lente, desenfoque de
  lente (bokeh), de caja y promediar, solarizar, viento, difusión, azulejos, trazar contorno, recortes, semitono de
  color, puntillista, fragmentar, nubes de diferencia, fibras, zigzag y vidrio.
- **Alinear y distribuir varias capas** (*Capa › Alinear* y *Capa › Distribuir*, o los botones de la herramienta Mover)
- **Atajos de teclado personalizables** (*Edición › Atajos de teclado…*, se guardan en el navegador)
- **Composiciones de capas** (*Ventana › Composiciones*): guarda variantes del diseño —visibilidad, posición y aspecto de cada capa— y cambia entre ellas con un clic
- **TIFF, TGA, BMP e ICO**: se abren TIFF (sin comprimir, LZW, ZIP o PackBits; 8, 16 y 32 bits; RGB, grises, paleta y
  CMYK; con transparencia; por bandas o mosaicos; los de varias páginas, una capa por página) y TGA; se exportan TIFF
  (sin pérdida, con transparencia y resolución), BMP, TGA e ICO con varios tamaños (16 a 256 px, para favicons).
- **Parche** y **Movimiento con detección de contenido** (con los correctores, `J`): rodea una imperfección y arrástrala
  a una zona limpia para taparla; o selecciona un objeto y arrástralo: se funde en el sitio nuevo y el hueco se rellena solo
  (modo «Extender» para duplicarlo).
- **Recorte con perspectiva** (con Recortar, `C`): coloca las cuatro esquinas sobre un documento, cartel o cuadro
  fotografiado de lado y sale enderezado; tamaño automático o el que indiques.
- **Panel Estilos** (junto a Color, Muestras y Pinceles): 20 estilos de capa listos con un clic (sombra suave, contorno,
  pegatina, neón, oro, plata, relieve, cristal, fuego, hielo, retro 3D…) y los tuyos con «＋». *Capa › Copiar / Pegar
  estilo de capa* lo pasa a otras capas (también a varias seleccionadas).
- **Color indexado** (*Imagen › Modo › Color indexado…*): reduce la capa a 2–256 colores (paleta adaptable, web, grises,
  blanco y negro o retro) con tramado por difusión o por motivo; útil para pixel art, GIF y efectos de impresión.
- **Quitar fondo** (*Capa › Quitar fondo* o el botón en *Propiedades*): detecta el sujeto y oculta el fondo con una
  máscara, sin borrar nada (pinta en la máscara para retocar el borde).
- **Desenfoque de iris** (*Filtro › Desenfocar*): elipse nítida con el resto desenfocado (posición, tamaño, alargamiento,
  ángulo, transición y brillo de las luces tipo bokeh).
- **Igualar color** (*Imagen › Ajustes*): da a la capa los colores y la luz de otro documento abierto o de otra capa
  (para que fotos de distintas cámaras o momentos combinen), con luminancia, intensidad, transición y neutralizar.
- **Vista › Nueva disposición de guías…**: columnas, filas, medianiles y márgenes con vista previa.
- **Edición › Buscar y reemplazar texto…**: en todas las capas de texto a la vez (conserva los estilos de cada trozo).
- **Selección › Cielo** y **Edición › Sustituir cielo…**: detecta el cielo (también con nubes) y lo cambia por uno de
  serie (despejado, con nubes, atardecer, hora dorada, tormenta, noche…) o por una foto tuya, con vista previa, borde
  ajustable y la luz del primer plano adaptada. Queda en un grupo con máscaras editables. Funciona mejor cuando el cielo
  ocupa la parte de arriba y se distingue del resto.
- **Archivos recientes** (*Archivo › Abrir reciente…* y en la pantalla de inicio): los últimos 12 archivos abiertos, con
  miniatura, se reabren con un clic. Se guardan solo en este navegador.
- **Tampón de motivo** (con el tampón, `S`): pinta con cualquier motivo, a la escala que quieras.
- **Muestra de color** (con el cuentagotas, `I`): fija hasta 4 puntos y ve su color en el panel *Info* mientras editas.
- **Sectores** (herramienta *Sector*, con Recortar `C`, y *Archivo › Exportar sectores…*): divide un diseño en zonas (a mano
  o desde las guías) y exporta cada una en su archivo PNG, JPG o WebP dentro de un ZIP, con una página HTML opcional
  que las recompone. Se guardan en el proyecto.
- **Filtro › Otro › Personalizado…**: tu propio filtro con una matriz de 5 × 5 (con ejemplos de enfocar, desenfocar,
  bordes y relieve), escala automática y desplazamiento.
- **Bloquear posición y bloquear píxeles** (panel Capas, junto a bloquear transparencia y bloquear todo): la capa no se
  mueve/transforma o no se pinta, respectivamente. Se guardan en el proyecto y en PSD.
- **Pluma de forma libre** (con la Pluma, `P`): dibuja a mano alzada y se convierte en una forma o trazado de curvas
  suaves con pocos puntos, editable con la Selección directa.
- **Pincel mezclador** (con el pincel, `B`): la pintura se mezcla con los colores de la imagen y los arrastra, como
  pintura húmeda (humedad, carga, mezcla, limpiar tras cada trazo y «solo mezclar»).
- **Marco** (`K`): dibuja huecos rectangulares o elípticos; con el marco seleccionado, arrastra una foto o usa *Colocar* y
  se mete dentro, cubriéndolo (como objeto inteligente, se puede mover y escalar dentro del marco). Ideal para plantillas.
- **Capa › Texto › Convertir en forma** y **Crear trazado de trabajo**: el texto (o lo opaco de una capa) pasa a forma
  vectorial (relleno de color con máscara vectorial, editable con la Selección directa) o a un trazado del panel Trazados.
- **Imagen › Aplicar imagen…**: combina con la capa activa otra capa, el documento combinado u otro documento abierto (o
  uno de sus canales: rojo, verde, azul, gris o transparencia, invertido si quieres) con un modo de fusión y opacidad.
- **Filtro › Interpretar › Efectos de iluminación…**: foco, luz omnidireccional o direccional, con color, alcance, luz
  ambiente y relieve a partir de la propia imagen.
- **Cuadrícula y guías a tu gusto** (*Edición › Preferencias*): tamaño de la cuadrícula y color de cuadrícula y guías; con la
  cuadrícula visible, las selecciones, el recorte y lo que mueves se ajustan a sus líneas.
- **Paneles Carácter y Párrafo** (*Ventana*, o el botón «Carácter y párrafo» de la herramienta Texto): fuente, estilo,
  tamaño, interlineado e interletraje en píxeles, escala horizontal y vertical, desplazamiento de la línea base, color,
  negrita, cursiva, mayúsculas, versalitas, subrayado, tachado y suavizado; alineación (también justificado), sangrías
  izquierda, derecha y de primera línea, y espacio antes y después de cada párrafo. Los números se cambian también
  arrastrando sobre su icono.
- **Relleno de capa** (panel Capas, junto a la opacidad): baja la opacidad del contenido sin tocar sus efectos exteriores
  (contorno, sombra, resplandor); por ejemplo, un texto con solo el contorno. Se lee y se guarda en PSD.
- **Propiedades del documento**: ancho y alto del lienzo editables (crece o se recorta desde el centro), resolución, modo de
  color y casillas para reglas, cuadrícula y guías.
- **Combinar capas seleccionadas** (`Ctrl+E` con varias capas seleccionadas): las une en una sola tal como se ven.
- **Móvil**: en pantallas estrechas los paneles se abren como un cajón con el botón «Paneles» (arriba a la derecha), los
  menús y submenús se abren tocándolos y la pantalla de inicio se adapta. Se pinta y se mueve con el dedo, y se hace
  zoom con dos dedos.
- **Vista › Extras** (`Ctrl+H`): oculta por un momento la selección, las guías, la cuadrícula y las muestras para ver la
  imagen limpia (la selección sigue activa).
- **Dinámica de color del pincel** (en «Más» de la barra del pincel): variar entre color frontal y de fondo, variar el tono
  y variar el brillo en cada pincelada (follaje, confeti, texturas).
- **Guía rápida** (`F1` o *Ayuda › Guía rápida*, también desde la pantalla de inicio) y lista de atajos
  (`Alt+Mayús+Ctrl+K`).
- **Pantallas pequeñas**: si las opciones de una herramienta no caben en la barra, las últimas pasan a «Más ▾».
- Si algo falla durante una operación, aparece un aviso (y se puede deshacer) en lugar de no pasar nada.
- **Tableta gráfica**: la presión puede controlar el tamaño y/o la opacidad del pincel («Presión = opacidad»).
- **Deformación de posición libre** (*Edición*): chinchetas sobre la capa; al mover una, la imagen se dobla alrededor
  de las demás (Alt+clic quita una chincheta, Intro aplica).
- **Escala según el contenido** (*Edición*): estrecha o ensancha una foto sin deformar a las personas ni los objetos
  importantes (protege tonos de piel o lo seleccionado).
- **Texto sobre trazado y texto vertical** (*Capa › Texto*): dibuja un trazado con la Pluma (modo «Trazado»), elige
  el texto y «Texto sobre trazado»; en *Propiedades* se ajusta dónde empieza y de qué lado va. Sigue siendo editable.
- **Máscaras vectoriales editables** (*Capa › Máscara vectorial › Trazado actual*): la capa solo se ve dentro de un
  trazado, que se edita con la Selección directa (`A`) y se mueve con la capa. Se pueden desactivar, invertir,
  rasterizar o eliminar. Las de los PSD se importan como trazados editables y se guardan como tales.
- **Motivos en PSD**: las capas de relleno de motivo (también las formas rellenas de motivo) y la superposición de motivo
  se leen y se guardan con sus motivos dentro del archivo; los motivos importados quedan disponibles en el editor.
- **Revelado de RAW en DNG**: los archivos DNG (móviles como iPhone ProRAW o Android, muchas cámaras y cualquier RAW
  convertido con el conversor gratuito de Adobe) se revelan desde los datos del sensor: negros y blancos, balance de
  blancos de la cámara, color del mosaico de Bayer, matriz de color, orientación y curva de tono. Después se puede
  ajustar todo con *Filtro › Revelado*.
- **Revelado de Sony ARW** (formato comprimido de las Alpha): desde los datos del sensor, con la curva de tono de Sony y
  balance de blancos automático.
- **Revelado de Nikon NEF** (compresión de Nikon con y sin pérdida, 12 y 14 bits): con la curva de linealización y el
  nivel de negro de la cámara. Si un NEF no se puede interpretar, se abre su vista previa.
- **Revelado de Canon CR2**: desde los datos del sensor, recortando los márgenes tapados, con el nivel de negro medido
  y el balance de blancos de la toma guardado por la cámara. De los RAW aún no admitidos se abre la vista previa.
- **Reemplazar contenido** de un objeto inteligente (*Capa › Objeto inteligente*): pone otra imagen en la misma caja.
- **Objetos inteligentes**: *Capa › Objeto inteligente › Convertir*, o al colocar/soltar una imagen sobre un documento.
  Se escalan y giran sin perder calidad, y con doble clic en su miniatura se edita su contenido en otra pestaña
  (el documento principal se actualiza solo). Las copias comparten contenido.
- **Máscaras de recorte** (`Alt+Ctrl+G`): la capa solo se ve donde la de debajo tiene píxeles.
- **Formas vectoriales** editables (color, trazo, tamaño) y **transformación de grupos** y de varias capas a la vez.
- Al mover una capa se conserva lo que queda fuera del lienzo (*Imagen › Revelar todo* lo muestra).

Pendiente: revelado de CR3, ORF, RW2 y RAF, y en PSD los efectos y ajustes que aún no existen en el editor (biselado, motivos, mapa de degradado…).

### Atajos principales

`V` mover · `M` marcos (Mayús+M alterna) · `L` lazo · `W` varita · `C` recortar · `I` cuentagotas · `S` tampón ·
`B` pincel/lápiz · `J` correctores · `Q` máscara rápida · `E` borrador · `G` degradado/bote · `T` texto · `P` pluma · `A` selección directa · `U` formas · `H` mano · `R` girar vista · `Z` zoom ·
`D` colores por defecto · `X` intercambiar colores · `[` `]` tamaño del pincel · Espacio (mantener) para desplazar.

`Ctrl+Z` deshacer · `Mayús+Ctrl+Z` rehacer · `Ctrl+S` guardar proyecto · `Mayús+Ctrl+S` exportar ·
`Ctrl+O` abrir · `Ctrl+A/D` seleccionar todo / deseleccionar · `Ctrl+J` capa vía copiar · `Ctrl+G` agrupar ·
`Ctrl+E` combinar hacia abajo · `Ctrl+L` niveles · `Ctrl+M` curvas · `Ctrl+U` tono/saturación · `Ctrl+I` invertir ·
`Ctrl+0` ajustar a pantalla · `Ctrl+1` 100 % · `Ctrl+R` reglas · `F1` lista completa.

> El navegador se reserva algunas combinaciones (`Ctrl+N`, `Ctrl+T`, `Ctrl+W`). Por eso **Nuevo** es `Alt+Ctrl+N`
> y **Transformación libre** es `Alt+Ctrl+T`.

## Para programadores

Tecnología: **TypeScript + Vite**, sin librerías en tiempo de ejecución. El dibujo usa Canvas 2D.

```bash
npm install        # una vez
npm run dev        # servidor de desarrollo con recarga automática
npm run build      # genera app/Editor.html y el index.html de la raíz (un solo archivo autocontenido)
```

Hace falta [Node.js](https://nodejs.org) 18 o superior.

### Estructura

```
src/
  core/      modelo: documento, capas, selección, historial, compositor
  tools/     una clase por herramienta (interfaz común en tool.ts)
  filters/   ajustes y filtros (funciones puras sobre ImageData) y su catálogo
  io/        abrir, exportar y formato de proyecto .edp
  ui/        interfaz: menús, paneles, diálogos, visor, acciones y atajos
```

Pensado para crecer:

- **Nuevos tipos de capa** (ajuste, objeto inteligente, vectorial): subclase de `Layer` en `core/layers.ts` y su caso en
  `core/compositor.ts`. El historial y el formato `.edp` ya guardan el tipo de cada capa.
- **Estilos de capa** (sombra, trazo, resplandor): se aplican en `drawLayer` del compositor, tras pintar la capa.
- **Filtros nuevos**: una entrada en `filters/registry.ts`; el menú y el diálogo con vista previa se generan solos.
  Las funciones de `filters/adjustments.ts` sirven también para futuras capas de ajuste no destructivas.
- **Herramientas nuevas** (pluma, trazados): una clase que implemente `Tool` y registrarla en `main.ts`.
- **Formatos** (PSD, RAW): nuevos lectores/escritores en `io/` que produzcan un `EditorDocument`.
- **Acciones de menú y atajos**: `ui/actions.ts`.
