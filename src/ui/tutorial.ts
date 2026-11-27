// Tutorial: «cómo se hace cada cosa». Guías cortas paso a paso, agrupadas por temas, con buscador y un botón
// «Probar ahora» que lleva a la herramienta, el menú o el panel del que habla la guía.
// Cada frase es una cadena aparte para que el traductor automático de la interfaz la encuentre en el diccionario.
import { app } from './app';
import { h } from './dom';
import { showDialog } from './dialog';
import { actionById } from './actions';
import { t } from '../i18n/i18n';

type Go = { act?: string; tool?: string; panel?: string };
type Guide = { id: string; title: string; intro?: string; steps: string[]; tip?: string; go?: Go; needsDoc?: boolean };
type Topic = { title: string; guides: Guide[] };

export const TOPICS: Topic[] = [
  { title: 'Primeros pasos', guides: [
    { id: 'studio', title: 'Elegir qué vas a crear', steps: [
      'Al abrir Photocap eliges qué quieres crear: fotografía, ilustración, animación 2D, pixel art o videojuegos.',
      'Cada espacio enseña en la barra solo las herramientas de ese trabajo y te da formas rápidas de empezar (tamaños, plantillas, abrir una foto…).',
      'Cámbialo cuando quieras con el botón de arriba a la derecha. Allí también está «Todas las herramientas en la barra». Los menús siempre tienen todo.',
      'Con algo abierto, vuelve a esta pantalla con ⟦Archivo › ¿Qué quieres crear hoy? (espacios de trabajo)…⟧.',
    ], go: { act: 'studio' } },
    { id: 'screen', title: 'Conocer la pantalla', steps: [
      'Arriba está el menú con todas las funciones. En el móvil, pulsa ⟦Menú⟧.',
      'Las herramientas están a la izquierda (en el móvil, abajo). Las que tienen un pequeño triángulo esconden más: mantenlas pulsadas para verlas.',
      'La barra de opciones cambia según la herramienta: tamaño, dureza, opacidad…',
      'A la derecha están los paneles: ⟦Capas⟧, ⟦Ajustes⟧, ⟦Color⟧, ⟦Historial⟧… En el móvil, desliza el dedo desde el borde derecho o toca la pestaña del borde.',
      'Si no sabes qué hace un botón, deja el ratón encima o mantenlo pulsado con el dedo: aparece su nombre.',
    ], tip: '⟦Ayuda › Buscar una función…⟧ encuentra cualquier cosa escribiendo su nombre.', go: { act: 'cmdSearch' } },
    { id: 'open', title: 'Abrir una foto o empezar de cero', steps: [
      '⟦Archivo › Abrir…⟧ y elige la foto. También puedes arrastrarla a la ventana o pegarla con Ctrl+V.',
      'En el móvil o la tableta, ⟦Archivo › Abrir desde la galería…⟧',
      'Para empezar en blanco: ⟦Archivo › Nuevo…⟧ y elige un tamaño (redes sociales, A4, pantalla…).',
      '⟦Archivo › Plantillas…⟧ tiene diseños listos en los que solo cambias los textos y las fotos.',
    ], go: { act: 'open' } },
    { id: 'navigate', title: 'Acercar, alejar y moverse', steps: [
      'Con los dedos: separa o junta dos dedos para acercar o alejar, muévelos juntos para desplazarte y gíralos para girar el lienzo.',
      'Con el ratón: Alt + rueda para acercar o alejar y Espacio + arrastrar para moverte.',
      '⟦Vista › Ajustar a la pantalla⟧ (Ctrl+0) vuelve a mostrar la imagen entera.',
      '⟦Vista › Restablecer giro de la vista⟧ la deja recta otra vez.',
    ], go: { act: 'fit' }, needsDoc: true },
    { id: 'undo', title: 'Deshacer y rehacer', steps: [
      '⟦Edición › Deshacer⟧ (Ctrl+Z) y ⟦Edición › Rehacer⟧ (Shift+Ctrl+Z).',
      'Con los dedos: un toque rápido con dos dedos deshace y con tres dedos rehace. Si los mantienes, sigue deshaciendo.',
      '⟦Ventana › Historial⟧ muestra todos los pasos: pulsa uno para volver a ese momento.',
    ], go: { panel: 'Historial' } },
    { id: 'save', title: 'Guardar tu trabajo', steps: [
      '⟦Archivo › Guardar (en Mis proyectos)⟧ (Ctrl+S) lo guarda en ⟦Mis proyectos⟧ con todas sus capas.',
      '⟦Archivo › Mis proyectos…⟧ sirve para abrirlo otro día, ordenarlo en carpetas o recuperar una versión anterior.',
      'Si prefieres un archivo para guardarlo donde quieras: ⟦Archivo › Guardar como archivo (.edp)…⟧',
      'Además, se guarda sola una copia de recuperación por si se cierra la página.',
    ], tip: 'Guardar no es lo mismo que exportar: para compartir la foto terminada, usa ⟦Exportar⟧.', go: { act: 'projects' } },
    { id: 'export', title: 'Exportar o compartir la foto', steps: [
      '⟦Archivo › Exportar como (PNG, JPG, TIFF, PSD, PDF…)…⟧',
      'Elige el formato: JPG para fotos, PNG si hay partes transparentes, PSD para seguir en otro programa con las capas.',
      'Ajusta la calidad y el tamaño: se ve cuánto pesará el archivo.',
      'En JPG puedes conservar los datos de la cámara (EXIF). La ubicación solo se incluye si la marcas.',
      'Para redes sociales, ⟦Archivo › Exportar para redes sociales…⟧ crea cada tamaño de una vez.',
    ], go: { act: 'export' }, needsDoc: true },
    { id: 'send', title: 'Pasar un proyecto del móvil a la tableta', steps: [
      '⟦Archivo › Enviar a otro dispositivo (con capas)…⟧',
      'Envíalo por Quick Share, Drive, correo o cable. WhatsApp comprime las fotos y las capas se perderían.',
      'En el otro dispositivo, ábrelo con Photocap: se abre con todas las capas y queda en ⟦Mis proyectos⟧.',
    ], go: { act: 'sendProject' }, needsDoc: true },
  ] },
  { title: 'Mejorar fotos', guides: [
    { id: 'enhance', title: 'Mejorar una foto en un toque', steps: [
      '⟦Imagen › Mejorar la foto (automático)⟧.',
      'Si quieres más control, abre el panel ⟦Ajustes⟧ y prueba los looks o el ⟦Revelado (tipo Camera Raw)⟧.',
    ], go: { act: 'autoEnhance' }, needsDoc: true },
    { id: 'develop', title: 'Luz y color (Revelado)', steps: [
      '⟦Filtro › Revelado (tipo Camera Raw)⟧.',
      'Mueve ⟦Exposición⟧, ⟦Contraste⟧, ⟦Luces⟧ y ⟦Sombras⟧. ⟦Temperatura⟧ hace la foto más cálida o más fría.',
      'El botón ↺ junto a un control lo devuelve a su valor inicial. También un doble toque en el deslizador.',
      '⟦Aceptar⟧ lo aplica. Si no te gusta, Ctrl+Z lo deshace.',
      'Si la foto es un RAW (DNG, CR2, NEF, ARW), ⟦Filtro › Revelado RAW (16 bits)…⟧ la ajusta desde los datos originales de la cámara: aclara sombras y recupera luces sin bandas.',
    ], go: { act: 'filter:develop' }, needsDoc: true },
    { id: 'looks', title: 'Aplicar un look (filtro de color)', steps: [
      'Abre el panel ⟦Ajustes⟧.',
      'Elige una categoría (⟦Retrato⟧, ⟦Paisaje⟧, ⟦Cine⟧…) y pulsa un look.',
      'Con ⟦Intensidad⟧ lo haces más suave o más fuerte.',
      'Si está marcado ⟦Como capa de ajuste (se puede cambiar después)⟧, podrás cambiarlo o quitarlo después desde el panel ⟦Capas⟧.',
      '⟦＋ Guardar como look⟧ guarda tus ajustes para usarlos en otras fotos.',
    ], go: { panel: 'Ajustes' }, needsDoc: true },
    { id: 'adjlayers', title: 'Curvas, niveles y otros ajustes', steps: [
      '⟦Capa › Nueva capa de ajuste⟧ y elige uno: ⟦Curvas…⟧, ⟦Niveles⟧, ⟦Tono/Saturación…⟧',
      'Sus controles aparecen en el panel ⟦Propiedades⟧.',
      'La foto original no cambia: oculta o borra la capa de ajuste para quitarlo.',
    ], go: { act: 'adjust:curves' }, needsDoc: true },
    { id: 'crop', title: 'Recortar y enderezar', steps: [
      'Elige la herramienta ⟦Recortar⟧.',
      'Si necesitas una forma concreta, elige la proporción en la barra de opciones (1:1, 4:5, 16:9…).',
      'Arrastra los bordes del marco y pulsa ✓ (o Intro) para aplicar.',
      'Para una foto torcida: ⟦Imagen › Enderezar automáticamente⟧.',
    ], go: { tool: 'crop' }, needsDoc: true },
    { id: 'blemish', title: 'Quitar manchas y objetos', steps: [
      'Elige el ⟦Pincel corrector puntual⟧ y pinta sobre la mancha: se rellena con lo de alrededor.',
      'Para objetos más grandes: ⟦IA › Borrar objetos con IA (pinta encima)⟧ y pinta encima de lo que quieras quitar.',
      'También puedes seleccionar la zona y usar ⟦Edición › Rellenar según contenido⟧.',
    ], go: { tool: 'spotHeal' }, needsDoc: true },
    { id: 'clone', title: 'Copiar una zona (tampón de clonar)', steps: [
      'Elige el ⟦Tampón de clonar⟧.',
      'Mantén Alt y pulsa donde está lo que quieres copiar. En tableta o móvil, mantén pulsado el botón rápido redondo: hace de Alt.',
      'Pinta donde quieras que aparezca la copia.',
    ], go: { tool: 'clone' }, needsDoc: true },
    { id: 'removebg', title: 'Quitar el fondo', steps: [
      '⟦IA › Quitar fondo (IA)⟧.',
      'La primera vez se descarga el modelo (solo una vez). La foto no sale de tu dispositivo.',
      'El fondo no se borra: se oculta con una máscara. Pinta en la máscara para corregir los bordes.',
      'Exporta en PNG para conservar la transparencia.',
    ], go: { act: 'aiRemoveBg' }, needsDoc: true },
    { id: 'sky', title: 'Cambiar el cielo', steps: [
      '⟦Edición › Sustituir cielo…⟧',
      'Elige un cielo y ajusta el borde, el brillo del cielo y la luz del primer plano para que encaje con la foto.',
    ], go: { act: 'skyReplace' }, needsDoc: true },
    { id: 'blurbg', title: 'Desenfocar el fondo (efecto retrato)', steps: [
      '⟦Imagen › Desenfocar el fondo (efecto retrato)⟧.',
      'La persona u objeto principal se queda nítido y el fondo se difumina.',
    ], go: { act: 'blurBg' }, needsDoc: true },
    { id: 'expand', title: 'Ampliar el lienzo rellenando lo que falta', steps: [
      '⟦Imagen › Expandir imagen (rellenar según contenido)…⟧',
      'Elige el nuevo formato o el margen y hacia qué lado crece.',
      'La zona nueva se rellena con lo que hay alrededor. Funciona mejor con fondos sencillos (cielo, pared, suelo).',
    ], go: { act: 'expandImage' }, needsDoc: true },
    { id: 'portrait', title: 'Retoque de retrato', steps: [
      'En el grupo del ⟦Pincel corrector puntual⟧ están ⟦Blanquear dientes⟧, ⟦Iluminar ojos⟧ y ⟦Quitar ojeras⟧.',
      'Elige una y pinta encima de la zona con suavidad: cada pasada añade un poco más.',
    ], go: { tool: 'teeth' }, needsDoc: true },
    { id: 'fx', title: 'Efectos de foto y copiar ajustes', steps: [
      'En ⟦Filtro › Efectos de foto⟧ hay glitch, destellos de luz, bokeh, toque de color (todo en blanco y negro menos un color) y película antigua.',
      '⟦Imagen › Doble exposición…⟧ mezcla otra foto encima, dentro de la silueta si antes seleccionas a la persona.',
      '⟦Edición › Copiar ajustes (looks, curvas, niveles…)⟧ y después ⟦Edición › Pegar ajustes en todas las fotos abiertas⟧ aplica el mismo retoque a muchas fotos.',
    ], go: { act: 'filter:colorsplash' }, needsDoc: true },
    { id: 'upscale', title: 'Ampliar una foto pequeña', steps: [
      '⟦IA › Ampliar con IA (×2 / ×4)…⟧',
      'Elige cuánto ampliar: la IA añade detalle en vez de solo estirar los píxeles.',
    ], go: { act: 'aiUpscale' }, needsDoc: true },
  ] },
  { title: 'Capas', guides: [
    { id: 'layers', title: 'Qué son las capas', steps: [
      'Las capas son como hojas transparentes apiladas: lo de arriba tapa lo de abajo.',
      'Todo lo que haces se aplica a la capa seleccionada, la que está resaltada en el panel ⟦Capas⟧.',
      'El ojo la oculta o la muestra. Arrastra una capa para cambiar el orden.',
      '⟦Capa › Nueva capa⟧ añade una capa vacía encima de la actual.',
    ], go: { act: 'newLayer' }, needsDoc: true },
    { id: 'blend', title: 'Opacidad y modos de fusión', steps: [
      'En el panel ⟦Capas⟧, ⟦Opacidad⟧ hace la capa más transparente.',
      'El modo de fusión cambia cómo se mezcla con lo de abajo: ⟦Multiplicar⟧ oscurece, ⟦Trama⟧ aclara y ⟦Superponer⟧ da contraste.',
    ], go: { panel: 'Capas' }, needsDoc: true },
    { id: 'mask', title: 'Máscaras: ocultar sin borrar', steps: [
      '⟦Capa › Máscara de capa › Mostrar todo⟧.',
      'Pinta en negro para ocultar y en blanco para volver a mostrar. Los grises dejan ver a medias.',
      'Así siempre puedes corregir: nada se borra de verdad.',
    ], go: { act: 'maskReveal' }, needsDoc: true },
    { id: 'clipmask', title: 'Una foto dentro de un texto o una forma', steps: [
      'Pon la foto en una capa justo encima del texto o la forma.',
      '⟦Capa › Crear / soltar máscara de recorte⟧: la foto solo se ve dentro de la capa de abajo.',
    ], go: { act: 'clip' }, needsDoc: true },
    { id: 'organize', title: 'Agrupar, alinear y combinar', steps: [
      'Selecciona varias capas en el panel ⟦Capas⟧ con Ctrl o Mayús + clic.',
      '⟦Capa › Agrupar capas⟧ las mete en una carpeta.',
      '⟦Capa › Alinear⟧ y ⟦Capa › Distribuir⟧ las colocan con precisión.',
      '⟦Capa › Combinar hacia abajo (o las seleccionadas)⟧ une la capa con la de debajo.',
    ], go: { panel: 'Capas' }, needsDoc: true },
    { id: 'styles', title: 'Sombra, borde y resplandor', steps: [
      '⟦Capa › Estilo de capa (sombra, trazo, resplandor)…⟧',
      'Marca el efecto que quieras y ajústalo. Se puede cambiar o quitar cuando quieras.',
      'El panel ⟦Estilos⟧ aplica efectos listos con un toque: neón, oro, pegatina, sombra larga…',
    ], go: { act: 'layerStyle' }, needsDoc: true },
    { id: 'smart', title: 'Objetos inteligentes', steps: [
      '⟦Capa › Objeto inteligente › Convertir en objeto inteligente⟧.',
      'Se puede agrandar y girar sin perder calidad, y sus filtros se pueden cambiar después.',
      'Doble clic en su miniatura del panel ⟦Capas⟧ para editar su contenido.',
    ], go: { act: 'toSmart' }, needsDoc: true },
  ] },
  { title: 'Selecciones', guides: [
    { id: 'select', title: 'Seleccionar una zona', steps: [
      '⟦Marco rectangular⟧ y ⟦Marco elíptico⟧: rectángulos y círculos. ⟦Lazo⟧: a mano alzada. ⟦Varita mágica⟧: zonas de un mismo color. ⟦Selección rápida⟧: pinta sobre lo que quieres.',
      'Mientras hay una selección, los cambios solo afectan a esa zona.',
      '⟦Selección › Deseleccionar⟧ (Ctrl+D) para terminar.',
    ], go: { tool: 'quickSel' }, needsDoc: true },
    { id: 'subject', title: 'Seleccionar a una persona u objeto', steps: [
      '⟦Selección › Sujeto⟧ selecciona lo principal de la foto.',
      '⟦IA › Seleccionar objeto con un clic (IA)⟧: pulsa sobre el objeto y la IA lo selecciona entero.',
    ], go: { act: 'selectSubject' }, needsDoc: true },
    { id: 'addsub', title: 'Añadir o quitar de la selección', steps: [
      'Con Mayús pulsada, lo que selecciones se suma; con Alt, se resta.',
      'En tableta o móvil, usa el botón rápido o los modos de la barra de opciones.',
      '⟦Selección › Invertir⟧ selecciona todo lo demás.',
    ], go: { tool: 'lasso' }, needsDoc: true },
    { id: 'refine', title: 'Afinar los bordes (pelo, pelaje)', steps: [
      'Con una selección hecha: ⟦Selección › Seleccionar y aplicar máscara…⟧',
      'Ajusta ⟦Suavizar⟧, ⟦Calar⟧ y ⟦Desplazar borde⟧ mirando el resultado.',
      'En ⟦Salida a⟧ elige si quieres una selección o una máscara de capa.',
    ], go: { act: 'refine' }, needsDoc: true },
  ] },
  { title: 'Dibujar y pintar', guides: [
    { id: 'brush', title: 'Pintar con el pincel', steps: [
      'Elige el ⟦Pincel⟧ y un color en el panel ⟦Color⟧.',
      'Cambia el tamaño en la barra de opciones o con las teclas [ y ].',
      '⟦Opacidad⟧ y ⟦Flujo⟧ hacen el trazo más suave. El panel ⟦Pinceles⟧ tiene puntas distintas.',
      'El botón ⟦Simetría⟧, al principio de la barra de opciones, repite el trazo como en un espejo (vertical, horizontal, radial o mandala).',
    ], go: { tool: 'brush' }, needsDoc: true },
    { id: 'pen', title: 'Dibujar con lápiz en la tableta', steps: [
      'El lápiz dibuja con presión e inclinación; el dedo solo mueve la vista, así puedes apoyar la mano.',
      'El botón ⟦Presión = tamaño⟧, al principio de la barra de opciones, hace que apretar más dibuje más grueso. Desactívalo para pintar siempre con el mismo grosor, como en Photoshop.',
      '⟦Edición › Ajustes del lápiz…⟧ cambia la sensibilidad a la presión.',
      '⟦Vista › Modo dibujo (pantalla completa)⟧ esconde todo menos el lienzo y una barra pequeña.',
    ], go: { act: 'penSettings' } },
    { id: 'quickbtn', title: 'El botón rápido', steps: [
      'El botón redondo sobre la imagen hace de tecla: mantenlo con una mano mientras dibujas con la otra.',
      'Con el pincel, mantenerlo pulsado y tocar la imagen coge ese color.',
      'Tócalo una vez para abrir un menú circular con deshacer, herramientas y más. Arrástralo para cambiarlo de sitio.',
      '⟦Edición › Botón rápido (tecla en pantalla)…⟧ elige qué tecla hace y qué hay en su menú.',
    ], go: { act: 'quickBtnSettings' } },
    { id: 'colors', title: 'Elegir colores', steps: [
      'El panel ⟦Color⟧ tiene el selector de color. El panel ⟦Muestras⟧ guarda colores para reutilizarlos.',
      'El Cuentagotas coge un color de la imagen.',
      'X intercambia el color frontal y el de fondo.',
      'Las Armonías de color proponen colores que combinan con el tuyo.',
    ], go: { panel: 'Color' } },
    { id: 'fill', title: 'Rellenar una zona de color', steps: [
      'Elige el ⟦Bote de pintura⟧ y pulsa dentro de la zona.',
      'Para colorear un dibujo de líneas en otra capa: selecciona la capa de las líneas y usa ⟦Capa › Usar como capa de referencia (el bote y la varita miran sus líneas)⟧. Después pinta en la capa de color.',
    ], go: { tool: 'bucket' }, needsDoc: true },
    { id: 'pixelart', title: 'Hacer pixel art', steps: [
      '⟦Archivo › Nuevo pixel art…⟧ y elige el tamaño (32 × 32 es un buen comienzo) y una paleta.',
      'Pinta con el ⟦Pincel de píxeles⟧: cada toque pinta un píxel exacto. Elige el color en la barra de paleta de abajo.',
      'En ⟦Forma⟧ hay línea, rectángulo y elipse. ⟦Píxel perfecto⟧ deja las líneas a mano limpias, sin escalones dobles.',
      'Alt + clic (o mantener el botón rápido) toma un color del dibujo. El ⟦Bote de pintura⟧ rellena zonas.',
      'Para animarlo, pulsa el botón de la película en la barra de colores. Duplica el fotograma, cambia un poco el dibujo y repite: el papel cebolla muestra el anterior en transparencia.',
      '⟦Archivo › Exportar pixel art ampliado…⟧ lo agranda ×8, ×16… sin que se vea borroso, también como GIF animado.',
    ], tip: 'Con ⟦Simetría⟧ en vertical dibujas medio personaje y sale entero.', go: { act: 'newPixelArt' } },
    { id: 'reference', title: 'Tener una imagen de referencia a la vista', steps: [
      '⟦Ventana › Imagen de referencia⟧ abre una ventana flotante con la foto que quieras.',
      'Puedes moverla y cambiar su tamaño mientras dibujas.',
    ], go: { act: 'reference' } },
  ] },
  { title: 'Texto y diseño', guides: [
    { id: 'text', title: 'Escribir un texto', steps: [
      'Elige la herramienta ⟦Texto⟧ y pulsa en la imagen donde quieras escribir.',
      'Cambia la fuente y el tamaño en la barra de opciones. El color, el interlineado y lo demás están en el panel ⟦Carácter⟧.',
      'Para cambiarlo después, elige la herramienta ⟦Texto⟧ y pulsa sobre el texto.',
    ], go: { tool: 'text' }, needsDoc: true },
    { id: 'textfx', title: 'Efectos de texto', steps: [
      '⟦Capa › Texto › Efectos de texto…⟧ tiene estilos listos.',
      '⟦Capa › Texto › Deformar texto…⟧ lo curva o lo ondula, y sigue siendo editable.',
    ], go: { act: 'textFx' }, needsDoc: true },
    { id: 'shapes', title: 'Dibujar formas', steps: [
      'Elige la herramienta ⟦Forma⟧ y, en la barra de opciones, la forma (rectángulo, estrella, corazón…).',
      'Arrastra sobre la imagen para dibujarla. ⟦Redondear esquinas⟧ suaviza las esquinas del rectángulo.',
      'En ⟦Dibujar⟧, elige ⟦En una capa de forma nueva⟧ si quieres poder cambiarla después.',
    ], go: { tool: 'shape' }, needsDoc: true },
    { id: 'templates', title: 'Plantillas y collages', steps: [
      '⟦Archivo › Plantillas…⟧: elige un diseño y cambia sus textos y fotos.',
      '⟦Archivo › Collage…⟧: elige una distribución y pon tus fotos en los huecos.',
    ], go: { act: 'templates' } },
    { id: 'watermark', title: 'Poner tu marca de agua', steps: [
      '⟦Archivo › Añadir marca de agua…⟧',
      'Escribe tu nombre o ©, y elige la posición (en una esquina o repetida por toda la imagen), el tamaño y la opacidad.',
    ], go: { act: 'watermark' }, needsDoc: true },
  ] },
  { title: 'Videojuegos y animación', guides: [
    { id: 'textures', title: 'Texturas para videojuegos', steps: [
      '⟦Juegos › Texturas › Generador de texturas…⟧: elige ladrillo, piedra, madera, hierba, metal… en estilo realista o pixel art.',
      'Todas se repiten sin cortes. ⟦Juegos › Texturas › Vista en mosaico (ver la imagen repetida)⟧ enseña cómo queda.',
      '⟦Juegos › Texturas › Mapas para videojuegos (normal, relieve, rugosidad, oclusión)…⟧ crea los mapas para el material del motor (Godot, Unity, Unreal, Blender).',
      'Con una foto propia, ⟦Juegos › Texturas › Hacer repetible (sin costuras)…⟧ la convierte en textura repetible.',
    ], go: { act: 'texGen' } },
    { id: 'anim2d', title: 'Animar dibujos', steps: [
      '⟦Juegos › Animación › Animación (fotogramas, papel cebolla)⟧ abre la barra de animación abajo: cada fotograma es un dibujo y el fondo se ve en todos.',
      'Duplica el fotograma y cambia un poco el dibujo. El papel cebolla enseña el anterior (o también el siguiente, en color).',
      'Cada fotograma puede durar ×2, ×3… y la velocidad se elige en fps.',
      '⟦Juegos › Animación › Interpolar movimiento…⟧ crea solo los fotogramas intermedios para mover, girar, escalar o desvanecer un objeto.',
    ], go: { act: 'animDock' }, needsDoc: true },
    { id: 'gametools', title: 'Sprites para el juego', steps: [
      '⟦Juegos › Animación › Cortar hoja de sprites en fotogramas…⟧ convierte una tira o rejilla de sprites en una animación.',
      '⟦Juegos › Animación › Exportar animación (GIF, vídeo, PNG, hoja de sprites)…⟧ saca la hoja de sprites con su JSON para el motor.',
      '⟦Juegos › Mapas, sprites e iconos › Atlas de sprites (capas a una imagen + JSON)…⟧ junta todas las capas en una imagen, y ⟦Juegos › Pixel art › Contorno de 1 píxel (sprites)…⟧ y ⟦Juegos › Pixel art › Cambiar colores del sprite (variantes)…⟧ ayudan a terminarlos.',
    ], go: { act: 'sliceSheet' }, needsDoc: true },
    { id: 'texdetails', title: 'Tu propia textura con detalles', steps: [
      '⟦Juegos › Texturas › Nueva textura (repetible, la dibujas tú)…⟧ crea un lienzo que se repite: lo que pintas en un borde sale por el contrario.',
      'Dibuja la base (piedras, tablas, baldosas) con el pincel o con la herramienta de píxeles.',
      '⟦Juegos › Texturas › Añadir detalles (musgo, grietas, suciedad, óxido, nieve…)…⟧ añade musgo, grietas, suciedad, óxido, humedad, hollín, arañazos, pintura desconchada, nieve o polvo.',
      'Los detalles se colocan solos donde tienen sentido (el musgo en las juntas, la nieve arriba) y van en su propia capa. Marca el estilo pixel art para que salgan sin bordes suaves.',
    ], go: { act: 'newTexture' } },
    { id: 'quickanim', title: 'Animaciones rápidas y nombres', steps: [
      'Elige la capa del personaje y abre ⟦Juegos › Animación › Animaciones rápidas (rebotar, flotar, girar…)…⟧: rebotar, flotar, latido, temblor, moneda girando, parpadear, aparecer…',
      '⟦Juegos › Animación › Interpolar movimiento…⟧ también estira y aplasta, con el punto de giro en los pies para los saltos.',
      '⟦Juegos › Animación › Nombre de animación (andar, saltar…)…⟧ agrupa fotogramas; la hoja de sprites los guarda como etiquetas que leen Godot, Phaser o Unity.',
    ], go: { act: 'animPresets' }, needsDoc: true },
    { id: 'pixeltools', title: 'Colores del pixel art', steps: [
      '⟦Juegos › Pixel art › Rampa de color (sombras y luces)…⟧ crea las sombras y luces de un color con cambio de tono.',
      '⟦Juegos › Pixel art › Ajustar a la paleta (con tramado)…⟧ convierte cualquier dibujo o foto a los colores de tu paleta.',
      '⟦Juegos › Pixel art › Degradado tramado…⟧ hace cielos y luces con pocos colores, y ⟦Juegos › Pixel art › Ampliar pixel art (nítido o Scale2x)…⟧ cambia el tamaño sin emborronar.',
    ], go: { act: 'colorRamp' } },
    { id: 'social', title: 'Fotos para redes sociales', steps: [
      '⟦Imagen › Para redes sociales › Tamaño para todas las redes (Instagram, TikTok, YouTube…)…⟧ adapta la foto a la vez a publicación, historia, miniatura, portada…',
      '⟦Imagen › Para redes sociales › Carrusel panorámico para Instagram…⟧ parte una panorámica en fotos seguidas.',
      '⟦Imagen › Para redes sociales › Antes y después…⟧ enseña el retoque, también como GIF con cortinilla.',
      'Con el fondo quitado, ⟦Imagen › Para redes sociales › Crear pegatina (WhatsApp, Telegram)…⟧ le pone el borde blanco y la guarda en WebP.',
      'Selecciona el agua o el cielo y usa ⟦Imagen › Foto en movimiento (agua, nubes, humo)…⟧ para que fluya en bucle.',
    ], go: { act: 'magicResize' }, needsDoc: true },
    { id: 'tilemap', title: 'Mapas de tiles e iconos', steps: [
      'Abre la imagen con tus tiles y entra en ⟦Juegos › Mapas, sprites e iconos › Editor de mapas de tiles…⟧.',
      'Toca un tile (o arrastra para coger un bloque) y pinta el mapa por casillas. Hay capas, borrar, rellenar, rectángulo y cuentagotas.',
      'Exporta el mapa para Tiled, Godot o Phaser, en CSV, o como imagen.',
      '⟦Juegos › Mapas, sprites e iconos › Iconos en todos los tamaños (Android, iPhone, web…)…⟧ saca el icono del juego para cada tienda de una vez.',
    ], go: { act: 'tileMap' }, needsDoc: true },
  ] },
  { title: 'Trabajar más rápido', guides: [
    { id: 'search', title: 'Buscar cualquier función', steps: [
      '⟦Ayuda › Buscar una función…⟧',
      'Escribe lo que quieres hacer (por ejemplo «fondo» o «recortar») y pulsa el resultado.',
    ], go: { act: 'cmdSearch' } },
    { id: 'shortcuts', title: 'Atajos de teclado', steps: [
      '⟦Ayuda › Lista de atajos de teclado⟧ muestra todos.',
      '⟦Edición › Atajos de teclado⟧ permite cambiarlos a tu gusto.',
    ], go: { act: 'shortcuts' } },
    { id: 'macros', title: 'Grabar pasos para repetirlos', steps: [
      '⟦Ventana › Acciones⟧.',
      'Pulsa ⟦Grabar una acción nueva⟧ y haz los pasos.',
      'Pulsa ⟦Detener la grabación⟧. Después, en otra foto, ⟦Reproducir la acción seleccionada⟧ repite los pasos.',
    ], go: { panel: 'Acciones' } },
    { id: 'batch', title: 'Editar muchas fotos a la vez', steps: [
      'Primero graba en ⟦Ventana › Acciones⟧ los pasos que quieres repetir (mira la guía «Grabar pasos para repetirlos»).',
      '⟦Archivo › Automatizar › Lote…⟧ y elige esa acción, el formato y la calidad.',
      'Pulsa ⟦Elegir imágenes y procesar⟧: se aplican los pasos a todas las fotos y se guardan juntas.',
    ], go: { act: 'batch' } },
  ] },
  { title: 'Si algo va mal', guides: [
    { id: 'slow', title: 'La app va lenta', steps: [
      '⟦Edición › Rendimiento y memoria…⟧ muestra cuánta memoria se usa.',
      '⟦Liberar memoria⟧ borra el historial de deshacer de los documentos abiertos (la imagen no cambia).',
      'Cierra los documentos que no uses. Con fotos muy grandes, baja la ⟦Calidad de la vista⟧.',
    ], go: { act: 'perf' } },
    { id: 'error', title: 'Algo ha fallado', steps: [
      'Recarga la página: el trabajo sin guardar se recupera solo.',
      '⟦Ayuda › Informe de errores…⟧: copia el texto y envíanoslo. No incluye tus imágenes.',
    ], go: { act: 'errorLog' } },
    { id: 'lang', title: 'Cambiar el idioma', steps: [
      'Pulsa el botón del globo, arriba, y elige el idioma.',
    ] },
  ] },
];

/** Nombre de menú, herramienta o panel en el idioma de la interfaz. «Archivo › Automatizar › Lote…» se traduce por
 *  trozos, juntando los que forman una sola etiqueta (la del menú puede llevar «›» dentro). */
function refText(r: string): string {
  const parts = r.split(' › '), out: string[] = [];
  for (let i = 0; i < parts.length;) {
    let j = parts.length;
    for (; j > i + 1; j--) { const c = parts.slice(i, j).join(' › '); if (t(c) !== c) break; }
    out.push(t(parts.slice(i, j).join(' › '))); i = j;
  }
  return out.join(' › ');
}
/** Frase con nombres marcados ⟦…⟧: se traduce la frase entera con huecos {0}, {1}… y los nombres se rellenan con las
 *  etiquetas reales de la interfaz (así coinciden siempre con lo que se ve en pantalla). Devuelve los nodos y el texto. */
export function rich(s: string): { nodes: (string | HTMLElement)[]; text: string } {
  const refs: string[] = [];
  const key = s.replace(/⟦([^⟧]+)⟧/g, (_, r) => '{' + (refs.push(r) - 1) + '}');
  const tr = refs.length ? t(key) : t(s);
  const nodes: (string | HTMLElement)[] = []; let text = '';
  tr.split(/(\{\d\})/).forEach(part => {
    const m = /^\{(\d)\}$/.exec(part);
    if (m && refs[+m[1]] !== undefined) { const r = refText(refs[+m[1]]); nodes.push(h('b', { class: 'tut-ref' }, r)); text += r; }
    else if (part) { nodes.push(part); text += part; }
  });
  return { nodes, text };
}

/** Lleva a donde explica la guía: una acción del menú, una herramienta o un panel. */
function go(g: Guide): boolean {
  if (!g.go) return false;
  if (g.needsDoc && !app.doc) { app.toast('Abre antes una foto o crea un documento nuevo (Archivo › Nuevo)', 'warn'); return false; }
  const { act, tool, panel } = g.go;
  if (act) {
    const a = actionById.get(act); if (!a) return false;
    if (a.enabled && !a.enabled()) { app.toast('Ahora no se puede: elige antes una capa o una selección adecuada', 'warn'); return false; }
    a.run(); return true;
  }
  if (tool) { app.setTool(tool); return true; }
  if (panel) {
    document.body.classList.remove('hide-panels');
    const btn = [...document.querySelectorAll<HTMLElement>('.side-nav-btn')].find(b => b.offsetParent && (b.textContent === panel || b.textContent === t(panel)));
    if (btn) { document.body.classList.add('show-side'); btn.click(); return true; }
    const tab = [...document.querySelectorAll<HTMLElement>('.tg-tab')].find(x => x.textContent === panel || x.textContent === t(panel));
    if (!tab) return false;
    tab.closest('.tab-group')?.classList.remove('closed'); tab.click();
    requestAnimationFrame(() => app.viewport.resize());
    return true;
  }
  return false;
}

const LAST = 'editor.tutorial';

export function tutorialDialog(startId?: string) {
  const all = TOPICS.flatMap(tp => tp.guides.map(g => ({ g, tp })));
  const list = h('div', { class: 'tut-list', role: 'navigation' });
  const view = h('div', { class: 'tut-view', 'aria-live': 'polite' });
  const search = h('input', { type: 'search', class: 'tut-search', placeholder: 'Buscar: fondo, texto, recortar…', 'aria-label': 'Buscar en el tutorial' }) as HTMLInputElement;
  const wrap = h('div', { class: 'tut' }, h('div', { class: 'tut-side' }, search, list), view);
  let cur = '';
  const buttons = new Map<string, HTMLElement>();
  for (const tp of TOPICS) {
    list.append(h('div', { class: 'tut-topic' }, tp.title));
    for (const g of tp.guides) {
      const b = h('button', { type: 'button', class: 'tut-item' }, g.title);
      b.onclick = () => show(g.id);
      buttons.set(g.id, b); list.append(b);
    }
  }
  const show = (id: string) => {
    const i = all.findIndex(x => x.g.id === id); if (i < 0) return;
    const { g, tp } = all[i]; cur = id;
    try { localStorage.setItem(LAST, id); } catch { /* sin almacenamiento */ }
    buttons.forEach((b, k) => b.classList.toggle('on', k === id));
    const back = h('button', { type: 'button', class: 'btn tut-back' }, '‹ Temas');
    back.onclick = () => { wrap.classList.remove('reading'); buttons.get(cur)?.focus(); };
    const tryBtn = g.go ? h('button', { type: 'button', class: 'btn primary tut-try' }, 'Probar ahora') : null;
    if (tryBtn) tryBtn.onclick = () => { if (go(g)) dlg.close(); };
    const next = all[i + 1];
    const nextBtn = next ? h('button', { type: 'button', class: 'btn tut-next' }, h('span', { class: 'hint' }, 'Siguiente:'), ' ', h('span', {}, next.g.title)) : null;
    if (nextBtn) nextBtn.onclick = () => show(next.g.id);
    view.replaceChildren(
      back,
      h('div', { class: 'tut-crumb hint' }, tp.title),
      h('h3', {}, g.title),
      ...(g.intro ? [h('p', {}, g.intro)] : []),
      h('ol', { class: 'tut-steps no-i18n' }, ...g.steps.map(s => h('li', {}, ...rich(s).nodes))),
      ...(g.tip ? [h('div', { class: 'tut-tip' }, h('b', {}, 'Consejo'), ' ', h('span', { class: 'no-i18n' }, ...rich(g.tip).nodes))] : []),
      h('div', { class: 'tut-actions' }, tryBtn, nextBtn),
    );
    view.scrollTop = 0;
    wrap.classList.add('reading');
  };
  // el buscador mira el texto en el idioma de la interfaz (títulos y pasos)
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  search.addEventListener('input', () => {
    const q = norm(search.value.trim());
    let any = false;
    for (const { g } of all) {
      const text = norm([g.title, ...g.steps, g.tip ?? ''].map(s => rich(s).text + ' ' + s.replace(/[⟦⟧]/g, '')).join(' '));
      const hit = !q || q.split(/\s+/).every(w => text.includes(w));
      buttons.get(g.id)!.style.display = hit ? '' : 'none'; if (hit) any = true;
    }
    list.querySelectorAll<HTMLElement>('.tut-topic').forEach(el => {
      let n = el.nextElementSibling as HTMLElement | null, vis = false;
      while (n && !n.classList.contains('tut-topic')) { if (n.style.display !== 'none') vis = true; n = n.nextElementSibling as HTMLElement | null; }
      el.style.display = vis ? '' : 'none';
    });
    empty.style.display = any ? 'none' : '';
    wrap.classList.remove('reading');
  });
  const empty = h('div', { class: 'hint tut-empty', style: { display: 'none' } }, 'No hay ninguna guía con esas palabras. Prueba con otras o usa Ayuda › Buscar una función.');
  list.append(empty);
  const dlg = showDialog({ title: 'Tutorial: cómo se hace cada cosa', cancelLabel: null, okLabel: 'Cerrar', width: 860, body: [wrap] });
  dlg.form.classList.add('tut-modal');
  let first = startId; if (!first) try { first = localStorage.getItem(LAST) ?? undefined; } catch { /* */ }
  show(first && all.some(x => x.g.id === first) ? first : all[0].g.id);
  // en pantallas estrechas se empieza por la lista de temas (salvo que se pida una guía concreta)
  if (!startId) wrap.classList.remove('reading');
}
