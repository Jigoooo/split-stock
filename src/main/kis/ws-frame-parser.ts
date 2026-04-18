/**
 * KIS 국내주식 실시간 WebSocket 프레임 파서.
 *
 * 프레임 구조: `암호화구분|tr_id|데이터건수|payload`
 * payload는 `^`로 필드 구분, 복수 레코드는 필드 개수만큼 반복.
 *
 * 참조: github.com/koreainvestment/open-trading-api legacy/websocket/python/ws_domestic_stock.py
 */

export type TickDirection = 'UP' | 'DOWN' | 'FLAT' | 'UPPER_LIMIT' | 'LOWER_LIMIT';

export interface TickUpdate {
  pdno: string;
  time: string; // HHMMSS
  price: number;
  dayChange: number;
  dayChangeRate: number;
  tickDirection: TickDirection;
  volume: number; // 이번 체결 수량
  accumVolume: number;
  open: number;
  high: number;
  low: number;
  bestAsk: number; // 매도호가1
  bestBid: number; // 매수호가1
}

export interface OrderbookLevel {
  price: number;
  quantity: number;
}

export interface OrderbookUpdate {
  pdno: string;
  time: string;
  asks: OrderbookLevel[]; // 매도 1~10단
  bids: OrderbookLevel[]; // 매수 1~10단
  totalAskQty: number;
  totalBidQty: number;
  expectedPrice: number;
  expectedQty: number;
}

const H0STCNT0_FIELDS = 46;
const H0STASP0_FIELDS = 59;

function toNum(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function tickDirection(code: string | undefined): TickDirection {
  switch (code) {
    case '1':
      return 'UPPER_LIMIT';
    case '2':
      return 'UP';
    case '3':
      return 'FLAT';
    case '4':
      return 'DOWN';
    case '5':
      return 'LOWER_LIMIT';
    default:
      return 'FLAT';
  }
}

interface ParsedEnvelope {
  trId: string;
  count: number;
  records: string[][];
}

/**
 * envelope 파싱 — `{암호화|tr_id|count|payload}` 구조 확인 후 payload를 `^`로 split.
 * 복수 레코드 지원: payload를 fieldsPerRecord 단위로 chunk.
 */
export function parseEnvelope(frame: string, fieldsPerRecord: number): ParsedEnvelope | null {
  const head = frame.split('|');
  if (head.length < 4) return null;
  const [, trId, countStr, ...rest] = head;
  if (!trId || !countStr) return null;
  const count = Number(countStr);
  if (!Number.isFinite(count) || count < 1) return null;
  const payload = rest.join('|');
  const fields = payload.split('^');
  if (fields.length < fieldsPerRecord * count) return null;

  const records: string[][] = [];
  for (let i = 0; i < count; i++) {
    const start = i * fieldsPerRecord;
    records.push(fields.slice(start, start + fieldsPerRecord));
  }
  return { trId, count, records };
}

/**
 * H0STCNT0 체결가 프레임 파싱 — 46필드.
 */
export function parseH0STCNT0(frame: string): TickUpdate[] {
  const env = parseEnvelope(frame, H0STCNT0_FIELDS);
  if (!env || env.trId !== 'H0STCNT0') return [];
  return env.records.map((r) => ({
    pdno: r[0] ?? '',
    time: r[1] ?? '',
    price: toNum(r[2]),
    dayChange: toNum(r[4]),
    dayChangeRate: toNum(r[5]),
    tickDirection: tickDirection(r[3]),
    volume: toNum(r[12]),
    accumVolume: toNum(r[13]),
    open: toNum(r[7]),
    high: toNum(r[8]),
    low: toNum(r[9]),
    bestAsk: toNum(r[10]),
    bestBid: toNum(r[11]),
  }));
}

/**
 * H0STASP0 호가 프레임 파싱 — 59필드.
 * 매도/매수 10단 호가가격([3~22])과 잔량([23~42])을 쌍으로 결합.
 */
export function parseH0STASP0(frame: string): OrderbookUpdate[] {
  const env = parseEnvelope(frame, H0STASP0_FIELDS);
  if (!env || env.trId !== 'H0STASP0') return [];
  return env.records.map((r) => {
    const asks: OrderbookLevel[] = [];
    const bids: OrderbookLevel[] = [];
    for (let i = 0; i < 10; i++) {
      asks.push({ price: toNum(r[3 + i]), quantity: toNum(r[23 + i]) });
      bids.push({ price: toNum(r[13 + i]), quantity: toNum(r[33 + i]) });
    }
    return {
      pdno: r[0] ?? '',
      time: r[1] ?? '',
      asks,
      bids,
      totalAskQty: toNum(r[43]),
      totalBidQty: toNum(r[44]),
      expectedPrice: toNum(r[47]),
      expectedQty: toNum(r[48]),
    };
  });
}
