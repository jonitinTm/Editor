// Fuentes: las del sistema, una biblioteca de Google Fonts que se descarga al usarla (solo se pide
// la fuente; ninguna imagen sale del equipo) y, si el navegador lo permite, las instaladas en el equipo.

export const SYSTEM_FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Georgia', 'Times New Roman', 'Garamond', 'Courier New', 'Consolas', 'Impact', 'Comic Sans MS', 'serif', 'sans-serif', 'monospace', 'cursive'];

/** Fuentes de Google Fonts más usadas (familia → categoría). */
export const WEB_FONTS: [string, string][] = [
  ['Roboto', 'sans'], ['Open Sans', 'sans'], ['Lato', 'sans'], ['Montserrat', 'sans'], ['Poppins', 'sans'], ['Inter', 'sans'], ['Oswald', 'sans'], ['Raleway', 'sans'],
  ['Nunito', 'sans'], ['Ubuntu', 'sans'], ['Rubik', 'sans'], ['Work Sans', 'sans'], ['Noto Sans', 'sans'], ['PT Sans', 'sans'], ['Mukta', 'sans'], ['Kanit', 'sans'],
  ['Fira Sans', 'sans'], ['Barlow', 'sans'], ['Quicksand', 'sans'], ['Josefin Sans', 'sans'], ['Titillium Web', 'sans'], ['DM Sans', 'sans'], ['Manrope', 'sans'],
  ['Mulish', 'sans'], ['Heebo', 'sans'], ['Karla', 'sans'], ['Cabin', 'sans'], ['Archivo', 'sans'], ['Bebas Neue', 'display'], ['Anton', 'display'], ['Archivo Black', 'display'],
  ['Teko', 'display'], ['Fjalla One', 'display'], ['Exo 2', 'sans'], ['Hind', 'sans'], ['Space Grotesk', 'sans'], ['Outfit', 'sans'], ['Plus Jakarta Sans', 'sans'],
  ['Lexend', 'sans'], ['Sora', 'sans'], ['Urbanist', 'sans'], ['Figtree', 'sans'], ['Red Hat Display', 'sans'], ['Signika', 'sans'], ['Asap', 'sans'], ['Maven Pro', 'sans'],
  ['Merriweather', 'serif'], ['Playfair Display', 'serif'], ['Lora', 'serif'], ['PT Serif', 'serif'], ['Noto Serif', 'serif'], ['Libre Baskerville', 'serif'], ['EB Garamond', 'serif'],
  ['Crimson Text', 'serif'], ['Source Serif 4', 'serif'], ['Bitter', 'serif'], ['Cormorant Garamond', 'serif'], ['Roboto Slab', 'serif'], ['Arvo', 'serif'], ['Zilla Slab', 'serif'],
  ['DM Serif Display', 'serif'], ['Abril Fatface', 'display'], ['Prata', 'serif'], ['Cinzel', 'serif'], ['Spectral', 'serif'], ['Libre Bodoni', 'serif'], ['Alegreya', 'serif'],
  ['Dancing Script', 'handwriting'], ['Pacifico', 'handwriting'], ['Caveat', 'handwriting'], ['Satisfy', 'handwriting'], ['Great Vibes', 'handwriting'], ['Shadows Into Light', 'handwriting'],
  ['Indie Flower', 'handwriting'], ['Kaushan Script', 'handwriting'], ['Amatic SC', 'handwriting'], ['Sacramento', 'handwriting'], ['Permanent Marker', 'handwriting'], ['Allura', 'handwriting'],
  ['Parisienne', 'handwriting'], ['Courgette', 'handwriting'], ['Cookie', 'handwriting'], ['Yellowtail', 'handwriting'], ['Gloria Hallelujah', 'handwriting'], ['Patrick Hand', 'handwriting'],
  ['Lobster', 'display'], ['Righteous', 'display'], ['Alfa Slab One', 'display'], ['Bangers', 'display'], ['Russo One', 'display'], ['Black Ops One', 'display'], ['Bungee', 'display'],
  ['Passion One', 'display'], ['Staatliches', 'display'], ['Monoton', 'display'], ['Press Start 2P', 'display'], ['Orbitron', 'display'], ['Audiowide', 'display'], ['Creepster', 'display'],
  ['Luckiest Guy', 'display'], ['Fredoka', 'display'], ['Comfortaa', 'display'], ['Chewy', 'display'], ['Special Elite', 'display'], ['Poiret One', 'display'], ['Bowlby One SC', 'display'],
  ['Roboto Mono', 'mono'], ['Source Code Pro', 'mono'], ['JetBrains Mono', 'mono'], ['Space Mono', 'mono'], ['IBM Plex Mono', 'mono'], ['Fira Code', 'mono'], ['Inconsolata', 'mono'],
];
export const CATEGORY_NAMES: Record<string, string> = { sans: 'Sin serifa', serif: 'Con serifa', display: 'Decorativas', handwriting: 'Manuscritas', mono: 'Monoespaciadas', system: 'Del sistema', local: 'Del equipo' };

const webSet = new Set(WEB_FONTS.map(f => f[0]));

/** ¿Está instalada esta fuente del sistema en el equipo? Se mide un texto con ella y con una fuente de reserva: si
 *  mide igual con las tres reservas, el navegador está usando la reserva (la fuente no existe). En Android, por
 *  ejemplo, no hay Arial, Georgia ni Times: así no se ofrece una fuente que luego se vería con otra. */
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
const availCache = new Map<string, boolean>();
export function systemFontAvailable(family: string): boolean {
  if (GENERIC.has(family)) return true;
  const hit = availCache.get(family); if (hit !== undefined) return hit;
  let ok = true;
  try {
    const c = document.createElement('canvas').getContext('2d')!, sample = 'mmmmmmmmmmlliWQ@#ÁÑ 0123';
    ok = ['monospace', 'serif', 'sans-serif'].some(fb => { c.font = `72px ${fb}`; const w0 = c.measureText(sample).width; c.font = `72px ${JSON.stringify(family)}, ${fb}`; return Math.abs(c.measureText(sample).width - w0) > 0.5; });
  } catch { ok = true; }
  availCache.set(family, ok);
  return ok;
}
/** ¿Se verá esta fuente tal cual en este equipo? (de la biblioteca, del equipo o del sistema instalada) */
export function fontUsable(family: string): boolean { return webSet.has(family) || localFonts.includes(family) || systemFontAvailable(family); }
const state = new Map<string, Promise<boolean>>();
export let localFonts: string[] = [];

/** ¿Hay que descargar esta fuente antes de usarla? */
export const needsDownload = (family: string) => webSet.has(family) && !state.has(family);
export const isWebFont = (family: string) => webSet.has(family);

/** Descarga (una vez) una fuente de Google Fonts con sus pesos normal y negrita, y cursiva. */
export function ensureFont(family: string): Promise<boolean> {
  if (!webSet.has(family)) return Promise.resolve(true);
  let p = state.get(family);
  if (p) return p;
  p = (async () => {
    try {
      const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
      let css = await fetch(url).then(r => r.ok ? r.text() : '').catch(() => '');
      if (!css) css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`).then(r => r.ok ? r.text() : '').catch(() => '');
      if (!css) return false;
      const faces: Promise<unknown>[] = [];
      for (const block of css.split('@font-face').slice(1)) {
        const src = /url\(([^)]+)\)/.exec(block)?.[1]; if (!src) continue;
        const weight = /font-weight:\s*(\d+)/.exec(block)?.[1] ?? '400', style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? 'normal';
        const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
        const ff = new FontFace(family, `url(${src})`, { weight, style, ...(range ? { unicodeRange: range } : {}) });
        (document.fonts as any).add(ff);
        // se cargan solo los subconjuntos latinos (los demás se cargan si hacen falta)
        if (!range || /U\+0000-00FF/i.test(range)) faces.push(ff.load().catch(() => null));
      }
      await Promise.all(faces);
      window.dispatchEvent(new CustomEvent('editor-font', { detail: family }));
      return true;
    } catch { return false; }
  })();
  state.set(family, p);
  return p;
}

/** Fuentes instaladas en el equipo (Chrome y Edge; pide permiso al usuario). */
export async function loadLocalFonts(): Promise<string[]> {
  const q = (window as any).queryLocalFonts;
  if (!q) throw new Error('Este navegador no permite leer las fuentes del equipo (prueba con Chrome o Edge)');
  const list = await q();
  localFonts = [...new Set<string>(list.map((f: any) => f.family as string))].sort((a, b) => a.localeCompare(b));
  return localFonts;
}

/** Nombre de fuente de un PSD (PostScript, p. ej. «Montserrat-Bold») → familia conocida, si la hay. */
export function familyFromPostScript(ps: string): string | null {
  const base = ps.split('-')[0].replace(/MT$|PS$|Std$|Pro$/, '');
  const spaced = base.replace(/([a-z])([A-Z])/g, '$1 $2');
  for (const n of [spaced, base]) { const f = WEB_FONTS.find(w => w[0].toLowerCase() === n.toLowerCase()); if (f) return f[0]; }
  return null;
}
