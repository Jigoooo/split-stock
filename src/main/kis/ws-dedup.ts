export class WsDeduper {
  private readonly seenKeys = new Set<string>();
  private readonly seenOrder: string[] = [];

  constructor(private readonly limit: number) {}

  remember(key: string): boolean {
    if (this.seenKeys.has(key)) return false;
    this.seenKeys.add(key);
    this.seenOrder.push(key);
    if (this.seenOrder.length > this.limit) {
      const evicted = this.seenOrder.shift();
      if (evicted) this.seenKeys.delete(evicted);
    }
    return true;
  }
}
