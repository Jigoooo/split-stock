export interface SharedPriceFeedTarget {
  subscribe(pdno: string): void;
  unsubscribe(pdno: string): void;
}

export class SharedPriceFeedRegistry {
  private feed: SharedPriceFeedTarget | null = null;
  private readonly refCounts = new Map<string, number>();

  setFeed(feed: SharedPriceFeedTarget | null): void {
    if (this.feed === feed) return;
    const activePdnos = this.activePdnos();
    const previous = this.feed;
    this.feed = feed;

    if (previous) {
      for (const pdno of activePdnos) previous.unsubscribe(pdno);
    }
    if (feed) {
      for (const pdno of activePdnos) feed.subscribe(pdno);
    }
  }

  acquire(pdno: string): void {
    const nextCount = (this.refCounts.get(pdno) ?? 0) + 1;
    this.refCounts.set(pdno, nextCount);
    if (nextCount === 1) {
      this.feed?.subscribe(pdno);
    }
  }

  release(pdno: string): void {
    const prevCount = this.refCounts.get(pdno) ?? 0;
    if (prevCount <= 1) {
      this.refCounts.delete(pdno);
      this.feed?.unsubscribe(pdno);
      return;
    }
    this.refCounts.set(pdno, prevCount - 1);
  }

  syncTracked(tracked: Set<string>, pdnos: readonly string[]): void {
    const next = new Set(pdnos);
    for (const pdno of Array.from(tracked)) {
      if (next.has(pdno)) continue;
      tracked.delete(pdno);
      this.release(pdno);
    }
    for (const pdno of next) {
      if (tracked.has(pdno)) continue;
      tracked.add(pdno);
      this.acquire(pdno);
    }
  }

  getRefCount(pdno: string): number {
    return this.refCounts.get(pdno) ?? 0;
  }

  activePdnos(): string[] {
    return Array.from(this.refCounts)
      .filter(([, count]) => count > 0)
      .map(([pdno]) => pdno);
  }
}
