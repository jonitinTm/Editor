# Editor

Editor de imágenes por capas que funciona en el navegador, con la interfaz en español.
**Todo ocurre en tu equipo**: las imágenes no se suben a ningún servidor y funciona sin conexión a internet.

## Cómo abrirlo en Windows (sin instalar nada)

1. En GitHub, entra en el repositorio, elige la rama `claude/nice-galileo-6pmws2` y pulsa **Code › Download ZIP**.
2. Descomprime el ZIP (clic derecho › *Extraer todo…*).
3. Entra en la carpeta `app` y haz **doble clic en `Editor.html`**. Se abre en tu navegador.
   - Funciona mejor en **Google Chrome** o **Microsoft Edge** recientes.

Ese único archivo `Editor.html` contiene el programa entero: puedes copiarlo a donde quieras.

## Qué puede hacer (primera fase)

| Área | Funciones |
|---|---|
| Documento | Nuevo (tamaños predefinidos), abrir PNG/JPG/WebP/GIF desde archivo, arrastrando o pegando (Ctrl+V); varias pestañas; zoom, desplazamiento, reglas y guías |
| Capas | Crear, duplicar, borrar, renombrar (doble clic), reordenar arrastrando, grupos, opacidad, visibilidad, bloqueo, 17 modos de fusión, máscaras de capa, combinar, acoplar |
| Herramientas | Mover, marco rectangular/elíptico, lazo, varita mágica, recortar, pincel, lápiz, borrador, bote de pintura, degradado, cuentagotas, texto (editable), formas, tampón de clonar, mano, zoom y transformación libre (escalar, girar, voltear) |
| Ajustes y filtros | Brillo/contraste, niveles, curvas, tono/saturación, blanco y negro, desaturar, invertir, desenfoque gaussiano, máscara de enfoque, enfocar, añadir ruido (con vista previa) |
| Historial | Deshacer/rehacer y panel con todos los pasos |
| Guardar | Exportar a PNG, JPG y WebP; proyecto `.edp` que conserva capas, máscaras, textos y guías |

### Atajos principales

`V` mover · `M` marcos (Mayús+M alterna) · `L` lazo · `W` varita · `C` recortar · `I` cuentagotas · `S` tampón ·
`B` pincel/lápiz · `E` borrador · `G` degradado/bote · `T` texto · `U` formas · `H` mano · `Z` zoom ·
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
npm run build      # genera app/Editor.html (un solo archivo autocontenido)
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
