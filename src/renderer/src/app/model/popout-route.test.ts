// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeLegacyPopoutHash, readPopoutRoute, toPopoutPath } from './popout-route';

describe('popout-route', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('returns null for empty and unknown hash routes', () => {
    window.history.replaceState(null, '', '/');
    expect(readPopoutRoute()).toBeNull();

    window.history.replaceState(null, '', '#/popout/unknown');
    expect(readPopoutRoute()).toBeNull();

    window.history.replaceState(null, '', '#popout=unknown');
    expect(readPopoutRoute()).toBeNull();
  });

  it('reads TanStack hash popout routes', () => {
    window.history.replaceState(null, '', '#/popout/stock-picker');
    expect(readPopoutRoute()).toBe('stock-picker');
  });

  it('reads and normalizes legacy popout hashes', () => {
    window.history.replaceState(null, '', '#popout=add-watch-order');

    expect(readPopoutRoute()).toBe('add-watch-order');
    normalizeLegacyPopoutHash();

    expect(window.location.hash).toBe('#/popout/add-watch-order');
    expect(readPopoutRoute()).toBe('add-watch-order');
  });

  it('encodes route segments for Electron load hashes', () => {
    expect(toPopoutPath('profit-calculator')).toBe('/popout/profit-calculator');
  });
});
