// Atajos de teclado: cómo se escribe una combinación de teclas.

export function keyString(e: KeyboardEvent) {
  const parts: string[] = [];
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  let k = e.key;
  if (e.code.startsWith('Numpad') && (e.code === 'NumpadAdd' || e.code === 'NumpadSubtract')) k = e.code;
  else if (k.length === 1) k = k.toUpperCase();
  // Con Mayús, algunas teclas cambian de símbolo; usamos el código físico
  if (e.code === 'BracketRight') k = ']'; if (e.code === 'BracketLeft') k = '[';
  if (e.code === 'Equal' && (e.ctrlKey || e.metaKey)) k = '=';
  if (e.code === 'Minus') k = '-';
  if (e.code.startsWith('Digit')) k = e.code.slice(5);
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  parts.push(k);
  return parts.join('+');
}
