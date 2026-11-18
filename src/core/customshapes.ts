// Formas personalizadas: trazados SVG en un cuadro de 100 × 100 que se estiran a la caja dibujada.

export const CUSTOM_SHAPES: [string, string, string][] = [
  ['bubble', 'Bocadillo', 'M10 8h80a8 8 0 0 1 8 8v46a8 8 0 0 1-8 8H42L22 92l6-22H10a8 8 0 0 1-8-8V16a8 8 0 0 1 8-8z'],
  ['thought', 'Pensamiento', 'M50 10c12 0 18 6 20 12 10-2 22 4 22 16 6 4 8 16-2 22 0 10-12 14-20 12-6 8-22 8-28 2-10 4-24 0-24-12-10-2-14-14-6-22-2-14 12-22 22-18 4-8 10-12 16-12zM18 82a6 6 0 1 0 0.1 0zM8 94a4 4 0 1 0 0.1 0z'],
  ['triangle', 'Triángulo', 'M50 4L97 94H3z'],
  ['rtriangle', 'Triángulo rectángulo', 'M4 4V96H96z'],
  ['diamond', 'Rombo', 'M50 2L98 50L50 98L2 50z'],
  ['plus', 'Cruz', 'M36 2h28v34h34v28H64v34H36V64H2V36h34z'],
  ['times', 'Aspa', 'M20 2L50 32L80 2L98 20L68 50L98 80L80 98L50 68L20 98L2 80L32 50L2 20z'],
  ['check', 'Visto bueno', 'M4 52L18 38L38 58L82 12L96 26L38 86z'],
  ['bolt', 'Rayo', 'M58 2L14 56H44L36 98L86 40H54L66 2z'],
  ['cloud', 'Nube', 'M26 82C10 82 2 72 2 60s10-22 22-22c2-16 16-28 32-28 14 0 26 10 30 22 8 0 14 8 14 16 0 2 0 4-1 5 1 3 1 5 1 7 0 12-8 22-22 22z'],
  ['drop', 'Gota', 'M50 2C50 2 14 46 14 66a36 36 0 0 0 72 0C86 46 50 2 50 2z'],
  ['moon', 'Luna', 'M62 2A48 48 0 1 0 98 70 38 38 0 1 1 62 2z'],
  ['pin', 'Ubicación', 'M50 2A34 34 0 0 0 16 36C16 62 50 98 50 98S84 62 84 36A34 34 0 0 0 50 2zM50 22a14 14 0 1 1 0 28 14 14 0 0 1 0-28z'],
  ['shield', 'Escudo', 'M50 2L94 16V46C94 72 76 90 50 98 24 90 6 72 6 46V16z'],
  ['tag', 'Etiqueta', 'M2 14V48L52 98L98 52L48 2H14zM24 18a6 6 0 1 1 0 12 6 6 0 0 1 0-12z'],
  ['banner', 'Cinta', 'M2 22H24V12H76V22H98L86 44L98 66H76V76H24V66H2L14 44z'],
  ['house', 'Casa', 'M50 4L96 46H84V96H60V66H40V96H16V46H4z'],
  ['curved', 'Flecha curva', 'M8 90C8 46 34 24 66 24V8L96 36L66 64V48C44 48 26 62 8 90z'],
  ['doublearrow', 'Flecha doble', 'M2 50L26 26V40H74V26L98 50L74 74V60H26V74z'],
  ['chevron', 'Galón', 'M2 10H62L98 50L62 90H2L38 50z'],
];
const cache = new Map<string, Path2D>();
export function customShapePath(id: string): Path2D | null {
  let p = cache.get(id);
  if (!p) { const d = CUSTOM_SHAPES.find(s => s[0] === id)?.[2]; if (!d) return null; p = new Path2D(d); cache.set(id, p); }
  return p;
}
