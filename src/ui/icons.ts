// Iconos propios dibujados en SVG (trazos simples, 24×24).

const S = (body: string, extra = '') =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ICONS: Record<string, string> = {
  move: S('<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
  marqueeRect: S('<rect x="4" y="5" width="16" height="14" stroke-dasharray="2.5 2.2"/>'),
  marqueeEllipse: S('<ellipse cx="12" cy="12" rx="8.5" ry="6.5" stroke-dasharray="2.5 2.2"/>'),
  lasso: S('<path d="M7 16c-3-1.5-4-4-2.5-6.5C6.5 6 12 4.5 16.5 6s5 5.5 1.5 8-9 2.5-11 2z"/><path d="M7 16c-.5 2 .5 3.5 2 4"/><circle cx="7.3" cy="16.4" r="1.2"/>'),
  wand: S('<path d="M4 20l11-11"/><path d="M13.5 7.5l3 3"/><path d="M18 3v3M16.5 4.5h3M20.5 9v2M19.5 10h2M11 3.5v2M10 4.5h2"/>'),
  crop: S('<path d="M6 2v16h16"/><path d="M2 6h16v16"/>'),
  eyedropper: S('<path d="M14.5 4.5l5 5"/><path d="M17 3.5a2.1 2.1 0 013 3l-2 2-3-3z"/><path d="M15.5 8.5L7 17l-3 1 1-3 8.5-8.5"/>'),
  clone: S('<path d="M9 4h6v4l2 4H7l2-4z"/><rect x="5" y="12" width="14" height="4" rx="1"/><path d="M6 19h12"/>'),
  brush: S('<path d="M20 3.5c-3 1.5-8 6-10 9l2 2c3-2 7.5-7 9-10z"/><path d="M9.5 13c-2 0-3.5 1.5-3.5 3.5 0 1.2-.8 2.3-2.5 3 3.5 1 7.5 0 8-3.5z"/>'),
  pencil: S('<path d="M15.5 4.5l4 4L9 19l-5 1 1-5z"/><path d="M13 7l4 4"/>'),
  eraser: S('<path d="M8.5 19.5L3.5 14.5a1.5 1.5 0 010-2.1l8.9-8.9a1.5 1.5 0 012.1 0l5 5a1.5 1.5 0 010 2.1L11 19.5z"/><path d="M8 9.5l6.5 6.5"/><path d="M11 19.5h9"/>'),
  gradient: S('<defs><linearGradient id="ig" x1="0" x2="1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><rect x="4" y="5" width="16" height="14" rx="1.5"/><rect x="4" y="5" width="16" height="14" rx="1.5" fill="url(#ig)" stroke="none"/>'),
  bucket: S('<path d="M5 11l6.5-6.5 7 7L12 18a2 2 0 01-2.8 0L5 13.8a2 2 0 010-2.8z"/><path d="M5 11h13.5"/><path d="M19.5 14.5s1.5 2 1.5 3a1.5 1.5 0 01-3 0c0-1 1.5-3 1.5-3z"/><path d="M9 3l2.5 2.5"/>'),
  text: S('<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>'),
  shape: S('<rect x="3.5" y="3.5" width="10" height="10" rx="1"/><circle cx="15" cy="15" r="5.5"/>'),
  hand: S('<path d="M8 13V6.5a1.5 1.5 0 013 0V12M11 11.5V4.5a1.5 1.5 0 013 0V12M14 11.5V6a1.5 1.5 0 013 0v7.5c0 4-2.5 6.5-6 6.5-2.5 0-3.8-1-5.2-3L4 14.3a1.5 1.5 0 012.3-1.8L8 14.5"/>'),
  zoom: S('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5M8 10.5h5M10.5 8v5"/>'),
  eye: S('<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  lock: S('<rect x="5" y="10.5" width="14" height="9.5" rx="1.5"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>'),
  folder: S('<path d="M3 7.5A1.5 1.5 0 014.5 6H9l2 2h8.5A1.5 1.5 0 0121 9.5v8a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z"/>'),
  newLayer: S('<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 8.5v7M8.5 12h7"/>'),
  trash: S('<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10 10v6.5M14 10v6.5"/>'),
  mask: S('<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity=".35"/>'),
  adjust: S('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16z" fill="currentColor"/>'),
  duplicate: S('<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"/>'),
  chevronRight: S('<path d="M9 6l6 6-6 6"/>'),
  chevronDown: S('<path d="M6 9l6 6 6-6"/>'),
  swap: S('<path d="M7 4L4 7l3 3M4 7h11a4 4 0 014 4v2M17 20l3-3-3-3M20 17H9a4 4 0 01-4-4v-2"/>', 'width="12" height="12"'),
  check: S('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  flipH: S('<path d="M12 3v18"/><path d="M9 7L4 17h5zM15 7l5 10h-5z"/>'),
  flipV: S('<path d="M3 12h18"/><path d="M7 9L17 4v5zM7 15l10 5v-5z"/>'),
  selNew: S('<rect x="5" y="5" width="14" height="14" fill="currentColor" fill-opacity=".35"/>'),
  selAdd: S('<rect x="3" y="3" width="11" height="11" fill="currentColor" fill-opacity=".35"/><rect x="10" y="10" width="11" height="11" fill="currentColor" fill-opacity=".35"/>'),
  selSub: S('<rect x="3" y="3" width="11" height="11" fill="currentColor" fill-opacity=".35"/><rect x="10" y="10" width="11" height="11" fill="var(--panel)"/>'),
  selInt: S('<rect x="3" y="3" width="11" height="11"/><rect x="10" y="10" width="11" height="11"/><rect x="10" y="10" width="4" height="4" fill="currentColor"/>'),
  open: S('<path d="M3 7.5A1.5 1.5 0 014.5 6H9l2 2h8.5A1.5 1.5 0 0121 9.5V11"/><path d="M3 7.5V18h15.5l3-7H6z"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  logo: `<svg viewBox="0 0 32 32" width="22" height="22"><rect x="3" y="7" width="18" height="18" rx="3" fill="#3d8bfd"/><rect x="11" y="3" width="18" height="18" rx="3" fill="#f5a524" fill-opacity=".9"/><path d="M11 7h7a3 3 0 013 3v11h-7a3 3 0 01-3-3z" fill="#1d2a44" fill-opacity=".55"/></svg>`,
};

export function icon(name: string): string { return ICONS[name] ?? ''; }
