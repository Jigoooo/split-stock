export function formatStockLabel(name: string | null | undefined, pdno: string): string {
  const code = pdno.trim();
  const trimmedName = name?.trim() ?? '';

  if (trimmedName === '' || trimmedName === code) return code;
  if (code === '') return trimmedName;
  return `${trimmedName} (${code})`;
}
