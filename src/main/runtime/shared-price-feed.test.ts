import { describe, expect, it, vi } from 'vitest';
import { SharedPriceFeedRegistry, type SharedPriceFeedTarget } from './shared-price-feed';

function createFeed(): SharedPriceFeedTarget & {
  subscribe: ReturnType<typeof vi.fn<(pdno: string) => void>>;
  unsubscribe: ReturnType<typeof vi.fn<(pdno: string) => void>>;
} {
  return {
    subscribe: vi.fn<(pdno: string) => void>(),
    unsubscribe: vi.fn<(pdno: string) => void>(),
  };
}

describe('SharedPriceFeedRegistry', () => {
  it('같은 종목을 여러 source가 acquire해도 feed subscribe는 한 번만 호출한다', () => {
    const feed = createFeed();
    const registry = new SharedPriceFeedRegistry();
    registry.setFeed(feed);

    registry.acquire('005930');
    registry.acquire('005930');

    expect(registry.getRefCount('005930')).toBe(2);
    expect(feed.subscribe).toHaveBeenCalledTimes(1);
    expect(feed.subscribe).toHaveBeenCalledWith('005930');
  });

  it('마지막 release에서만 feed unsubscribe를 호출한다', () => {
    const feed = createFeed();
    const registry = new SharedPriceFeedRegistry();
    registry.setFeed(feed);
    registry.acquire('005930');
    registry.acquire('005930');

    registry.release('005930');
    expect(feed.unsubscribe).not.toHaveBeenCalled();
    expect(registry.getRefCount('005930')).toBe(1);

    registry.release('005930');
    expect(feed.unsubscribe).toHaveBeenCalledTimes(1);
    expect(feed.unsubscribe).toHaveBeenCalledWith('005930');
    expect(registry.getRefCount('005930')).toBe(0);
  });

  it('tracked set sync는 사라진 종목을 release하고 새 종목만 acquire한다', () => {
    const feed = createFeed();
    const registry = new SharedPriceFeedRegistry();
    const tracked = new Set<string>();
    registry.setFeed(feed);

    registry.syncTracked(tracked, ['005930', '000660']);
    feed.subscribe.mockClear();
    feed.unsubscribe.mockClear();

    registry.syncTracked(tracked, ['000660', '035420']);

    expect([...tracked].sort()).toEqual(['000660', '035420']);
    expect(feed.unsubscribe).toHaveBeenCalledWith('005930');
    expect(feed.subscribe).toHaveBeenCalledWith('035420');
    expect(feed.subscribe).not.toHaveBeenCalledWith('000660');
  });

  it('feed가 늦게 연결되면 기존 ref-count 종목을 새 feed에 구독한다', () => {
    const feed = createFeed();
    const registry = new SharedPriceFeedRegistry();

    registry.acquire('005930');
    registry.acquire('000660');
    registry.setFeed(feed);

    expect(feed.subscribe).toHaveBeenCalledTimes(2);
    expect(feed.subscribe).toHaveBeenCalledWith('005930');
    expect(feed.subscribe).toHaveBeenCalledWith('000660');
  });
});
