// Uso: node scripts/icons.cjs (necesita Playwright). Genera los iconos PNG de la app (normal y «maskable» para Android) a partir de public/icon.svg
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const svg = fs.readFileSync('public/icon.svg', 'utf8');
  // versión adaptable: fondo a sangre y el dibujo dentro de la zona segura (80 % central)
  const inner = svg.replace(/^<svg[^>]*>/, '').replace('</svg>', '').replace('<rect width="512" height="512" rx="96" fill="#1d1e21"/>', '');
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#1d1e21"/><g transform="translate(14.8 32.8) scale(.9)">${inner}</g></svg>`;
  const b = await chromium.launch(); const p = await b.newPage();
  for (const [name, s, size] of [['icon-192.png', svg, 192], ['icon-512.png', svg, 512], ['icon-maskable-512.png', mask, 512], ['apple-touch-icon.png', mask, 180]]) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${s.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: 'public/' + name, omitBackground: true });
  }
  await b.close();
})();
