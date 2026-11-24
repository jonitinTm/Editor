// Descripción de cada herramienta en una frase (para los avisos de la barra y el buscador).

export const TOOL_DESC: Record<string, string> = {
  move: 'Mueve capas o lo seleccionado', artboardTool: 'Crea mesas de trabajo (diseños de varios tamaños)',
  marqueeRect: 'Selecciona un rectángulo', marqueeEllipse: 'Selecciona un óvalo o círculo', marqueeRow: 'Selecciona una fila de 1 píxel', marqueeCol: 'Selecciona una columna de 1 píxel',
  lasso: 'Selecciona dibujando a mano alzada', polyLasso: 'Selecciona con líneas rectas, clic a clic', magLasso: 'Selecciona siguiendo los bordes solo',
  aiSel: 'Toca un objeto y la IA lo selecciona entero',
  objectSel: 'Rodea un objeto y lo selecciona solo', quickSel: 'Pinta sobre algo para seleccionarlo', wand: 'Selecciona zonas del mismo color con un clic',
  crop: 'Recorta la imagen (o ajusta su proporción)', perspCrop: 'Recorta y endereza algo fotografiado de lado', slice: 'Divide un diseño en trozos para la web', frame: 'Hueco donde colocar fotos que se recortan solas',
  eyedropper: 'Toma un color de la imagen', colorSampler: 'Fija puntos para vigilar su color', ruler: 'Mide distancias y ángulos; endereza', note: 'Pega notas de texto sobre la imagen', count: 'Numera y cuenta objetos',
  spotHeal: 'Pinta sobre una mancha y desaparece', remove: 'Pinta sobre un objeto y se borra: la IA inventa lo que había detrás', heal: 'Corrige copiando de otra zona (Alt+clic para elegirla)', patch: 'Rodea una zona y arrástrala a otra limpia', contentMove: 'Mueve un objeto y rellena el hueco', redEye: 'Quita los ojos rojos',
  clone: 'Copia una zona pintando (Alt+clic para el origen)', patternStamp: 'Pinta con un motivo', historyBrush: 'Pinta devolviendo cómo estaba al principio', artHistory: 'Pinta trazos artísticos con los colores originales',
  brush: 'Pinta trazos suaves', pencil: 'Pinta trazos de borde duro (pixel art)', colorReplace: 'Cambia el color de lo que pintas sin perder detalle', mixer: 'Pinta mezclando con los colores de la imagen',
  eraser: 'Borra', bgEraser: 'Borra el fondo alrededor de un objeto', magicEraser: 'Borra con un clic una zona de color',
  gradient: 'Rellena con un degradado', bucket: 'Rellena una zona con un color', lassoFill: 'Dibuja un contorno y se rellena con el color al soltar', blurTool: 'Desenfoca donde pintas', sharpenTool: 'Enfoca donde pintas', smudge: 'Arrastra la pintura como con el dedo',
  dodge: 'Aclara donde pintas', burn: 'Oscurece donde pintas', sponge: 'Satura o quita color donde pintas',
  text: 'Escribe texto', textV: 'Escribe texto en vertical', typeMask: 'Escribe y obtienes una selección con forma de letras', typeMaskV: 'Selección con forma de letras, en vertical',
  pen: 'Dibuja trazados y formas con curvas precisas', freePen: 'Dibuja a mano y se convierte en curvas', curvPen: 'Dibuja curvas suaves clic a clic', addAnchor: 'Añade puntos a un trazado', delAnchor: 'Quita puntos de un trazado', convertPoint: 'Cambia un punto entre esquina y curva',
  pathSelect: 'Mueve un trazado entero', node: 'Mueve los puntos de un trazado', shape: 'Dibuja rectángulos, círculos, estrellas, flechas…',
  hand: 'Desplaza la vista', rotateView: 'Gira la vista (no la imagen)', zoom: 'Acerca o aleja', transform: 'Cambia tamaño, gira o deforma', puppet: 'Dobla una figura con chinchetas', warp: 'Deforma con una malla',
};

