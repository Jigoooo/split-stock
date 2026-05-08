/**
 * C12-b: syncLotsFromFillEvent FIFO 차감 단위 테스트
 *
 * 변경 전: 단일 SELL fill 로 모든 open lots 일괄 close → 차수 매매 위반.
 * 변경 후: executedVolume 만큼 낮은 nth(차수)부터 FIFO 차감.
 */
import type { CryptoPrivateOrderEvent } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { CryptoAutoTradingRepo } from './crypto-auto-repo';

function setup() {
  const db = createTestDb();
  bootstrapSchema(db);
  const repo = new CryptoAutoTradingRepo(db);
  return { db, repo };
}

const ACCOUNT_ID = 1;
const MARKET = 'KRW-BTC' as const;

function makeSellEvent(
  executedVolume: string,
  overrides: Partial<CryptoPrivateOrderEvent> = {},
): CryptoPrivateOrderEvent {
  return {
    exchange: 'UPBIT',
    accountId: ACCOUNT_ID,
    market: MARKET,
    uuid: 'sell-uuid-1',
    side: 'ask',
    ordType: 'limit',
    state: 'done',
    price: '50000000',
    volume: executedVolume,
    remainingVolume: '0',
    executedVolume,
    paidFee: '0',
    locked: '0',
    orderTimestamp: Date.now(),
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('CryptoAutoTradingRepo.syncLotsFromFillEvent', () => {
  it('1차(qty=10) + 2차(qty=20) 보유 → SELL executedVolume=10 → 1차만 close, 2차 open 유지', () => {
    const { repo } = setup();

    const lot1 = repo.createLot({
      accountId: ACCOUNT_ID,
      market: MARKET,
      source: 'live',
      quantity: '10',
      avgEntryKrw: '50000000',
      allocatedKrw: '500000000',
    });
    const lot2 = repo.createLot({
      accountId: ACCOUNT_ID,
      market: MARKET,
      source: 'live',
      quantity: '20',
      avgEntryKrw: '48000000',
      allocatedKrw: '960000000',
    });

    repo.syncLotsFromFillEvent(makeSellEvent('10'));

    const openLots = repo.listOpenLots(ACCOUNT_ID, MARKET, 'live');
    expect(openLots).toHaveLength(1);
    const [remaining2nd] = openLots;
    expect(remaining2nd?.id).toBe(lot2.id);
    expect(remaining2nd?.quantity).toBe('20');

    // lot1 은 closed 로 전환
    const closedLots = repo.listClosedLots(ACCOUNT_ID, MARKET, { source: 'live' });
    expect(closedLots).toHaveLength(1);
    const [closed1st] = closedLots;
    expect(closed1st?.id).toBe(lot1.id);
  });

  it('1차(qty=10) + 2차(qty=20) 보유 → SELL executedVolume=15 → 1차 close + 2차 partial reduce(qty=15 남음)', () => {
    const { repo } = setup();

    repo.createLot({
      accountId: ACCOUNT_ID,
      market: MARKET,
      source: 'live',
      quantity: '10',
      avgEntryKrw: '50000000',
      allocatedKrw: '500000000',
    });
    const lot2 = repo.createLot({
      accountId: ACCOUNT_ID,
      market: MARKET,
      source: 'live',
      quantity: '20',
      avgEntryKrw: '48000000',
      allocatedKrw: '960000000',
    });

    repo.syncLotsFromFillEvent(makeSellEvent('15'));

    const openLots = repo.listOpenLots(ACCOUNT_ID, MARKET, 'live');
    expect(openLots).toHaveLength(1);
    const [partialLot] = openLots;
    expect(partialLot?.id).toBe(lot2.id);
    // 20 - 5(잔여) = 15
    expect(Number(partialLot?.quantity)).toBeCloseTo(15, 6);

    const closedLots = repo.listClosedLots(ACCOUNT_ID, MARKET, { source: 'live' });
    expect(closedLots).toHaveLength(1);
  });

  it('1차(qty=10)만 보유 → SELL executedVolume=10 → 1차 close', () => {
    const { repo } = setup();

    const lot1 = repo.createLot({
      accountId: ACCOUNT_ID,
      market: MARKET,
      source: 'live',
      quantity: '10',
      avgEntryKrw: '50000000',
      allocatedKrw: '500000000',
    });

    repo.syncLotsFromFillEvent(makeSellEvent('10'));

    const openLots = repo.listOpenLots(ACCOUNT_ID, MARKET, 'live');
    expect(openLots).toHaveLength(0);

    const closedLots = repo.listClosedLots(ACCOUNT_ID, MARKET, { source: 'live' });
    expect(closedLots).toHaveLength(1);
    const [closedLot] = closedLots;
    expect(closedLot?.id).toBe(lot1.id);
  });

  it('모든 lot 합(30) 보다 큰 executedVolume=50 → 모든 lot close, 잔여 무시', () => {
    const { repo } = setup();

    repo.createLot({
      accountId: ACCOUNT_ID,
      market: MARKET,
      source: 'live',
      quantity: '10',
      avgEntryKrw: '50000000',
      allocatedKrw: '500000000',
    });
    repo.createLot({
      accountId: ACCOUNT_ID,
      market: MARKET,
      source: 'live',
      quantity: '20',
      avgEntryKrw: '48000000',
      allocatedKrw: '960000000',
    });

    repo.syncLotsFromFillEvent(makeSellEvent('50'));

    const openLots = repo.listOpenLots(ACCOUNT_ID, MARKET, 'live');
    expect(openLots).toHaveLength(0);

    const closedLots = repo.listClosedLots(ACCOUNT_ID, MARKET, { source: 'live' });
    expect(closedLots).toHaveLength(2);
  });

  it('executedVolume=0 → no-op (lots 변동 없음)', () => {
    const { repo } = setup();

    repo.createLot({
      accountId: ACCOUNT_ID,
      market: MARKET,
      source: 'live',
      quantity: '10',
      avgEntryKrw: '50000000',
      allocatedKrw: '500000000',
    });

    repo.syncLotsFromFillEvent(makeSellEvent('0'));

    const openLots = repo.listOpenLots(ACCOUNT_ID, MARKET, 'live');
    expect(openLots).toHaveLength(1);
    const [openLot] = openLots;
    expect(openLot?.quantity).toBe('10');
  });
});
