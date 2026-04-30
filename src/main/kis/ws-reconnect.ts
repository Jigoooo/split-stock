export function reconnectDelayMs(baseMs: number, maxMs: number, attempt: number): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}
