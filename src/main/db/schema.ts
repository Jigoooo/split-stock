import { blob, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 자격증명 — safeStorage로 암호화된 직렬화 결과를 BLOB으로 저장.
 * 원문 평문은 어디에도 남기지 않는다.
 * env별 1행 (MOCK / PROD 각각).
 */
export const credentials = sqliteTable('credentials', {
  env: text('env').primaryKey(), // 'MOCK' | 'PROD'
  payload: blob('payload', { mode: 'buffer' }).notNull(), // safeStorage.encryptString(JSON.stringify(Credentials))
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * 액세스 토큰 캐시 — 만료 6h 이내면 재사용.
 */
export const accessTokens = sqliteTable('access_tokens', {
  env: text('env').primaryKey(),
  token: text('token').notNull(),
  tokenType: text('token_type').notNull().default('Bearer'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  issuedAt: integer('issued_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * 계좌 — 매직스플릿은 단일/다계좌 모두 지원.
 */
export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  env: text('env').notNull(), // 'MOCK' | 'PROD'
  accountNo8: text('account_no_8').notNull(),
  accountProdCd: text('account_prod_cd').notNull(),
  nickname: text('nickname').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * 차수 장부 — 매직스플릿의 핵심 자료구조.
 * 각 차수(nth)는 독립 포지션으로 관리되며, 해당 차수 매입가 기준 익절.
 */
export const lots = sqliteTable('lots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  pdno: text('pdno').notNull(), // 종목코드
  nth: integer('nth').notNull(), // 1..N차
  buyPrice: integer('buy_price').notNull(), // 원(정수)
  qty: integer('qty').notNull(),
  amountKrw: integer('amount_krw').notNull(),
  status: text('status').notNull(), // 'OPEN' | 'SOLD' | 'BUYING' | 'SELLING'
  boughtAt: integer('bought_at', { mode: 'timestamp_ms' }).notNull(),
  soldAt: integer('sold_at', { mode: 'timestamp_ms' }),
  sellPrice: integer('sell_price'),
});

/**
 * 주문 — KIS 주문번호(ODNO)와 로컬 차수(lotId) 매핑.
 */
export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  lotId: integer('lot_id'), // 매도일 때 해당 차수
  odno: text('odno').notNull(), // KIS 주문번호
  orgNo: text('org_no'), // KRX_FWDG_ORD_ORGNO — 정정/취소 시 필수
  pdno: text('pdno').notNull(),
  side: text('side').notNull(), // 'BUY' | 'SELL'
  division: text('division').notNull(), // 'LIMIT' | 'MARKET'
  qty: integer('qty').notNull(),
  price: integer('price').notNull(),
  status: text('status').notNull(), // 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'PARTIAL'
  placedAt: integer('placed_at', { mode: 'timestamp_ms' }).notNull(),
  filledAt: integer('filled_at', { mode: 'timestamp_ms' }),
  cancelCount: integer('cancel_count').notNull().default(0),
});

/**
 * 체결 — 주문이 실제 체결된 레코드.
 */
export const trades = sqliteTable('trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').notNull(),
  qty: integer('qty').notNull(),
  price: integer('price').notNull(),
  executedAt: integer('executed_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * 이벤트 로그 — 자동매매/주문/오류 타임라인.
 * API 응답 원문을 저장할 때는 토큰/키를 반드시 마스킹한 후 payload에 기록.
 */
export const eventLogs = sqliteTable('event_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts', { mode: 'timestamp_ms' }).notNull(),
  level: text('level').notNull(), // 'INFO' | 'WARN' | 'ERROR'
  category: text('category').notNull(), // 'AUTH' | 'ORDER' | 'FSM' | 'WS' | 'SYS'
  message: text('message').notNull(),
  payloadJson: text('payload_json'), // nullable JSON text
});

/**
 * 앱 설정 — 환경/기본 전략 파라미터 등.
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * 종목 마스터 — pdno→이름/섹터 로컬 캐시 (주간 갱신).
 * KIS search-stock-info 또는 KRX 공시를 upsert.
 */
export const stockMaster = sqliteTable('stock_master', {
  pdno: text('pdno').primaryKey(), // 종목코드 6자리
  name: text('name').notNull(),
  sector: text('sector'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * 일/주/월봉 로컬 캐시 — KIS inquire-daily-itemchartprice 호출 결과 누적.
 * (pdno, period, date) 복합 PK. 오래된 바는 고정(불변), 최근 바는 upsert로 갱신.
 */
export const dailyCandles = sqliteTable(
  'daily_candles',
  {
    pdno: text('pdno').notNull(),
    period: text('period').notNull(), // 'D' | 'W' | 'M'
    date: text('date').notNull(), // YYYY-MM-DD
    open: integer('open').notNull(),
    high: integer('high').notNull(),
    low: integer('low').notNull(),
    close: integer('close').notNull(),
    volume: integer('volume').notNull(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.pdno, t.period, t.date] })],
);

/**
 * 예약 매수 — 잔고에 없는 신규 종목 감시 주문(최대 100건).
 * status: 'PENDING' | 'FILLED' | 'EXPIRED' | 'CANCELLED'.
 */
export const prebuyOrders = sqliteTable('prebuy_orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pdno: text('pdno').notNull(),
  targetPrice: integer('target_price').notNull(),
  amountKrw: integer('amount_krw').notNull(),
  validUntil: integer('valid_until', { mode: 'timestamp_ms' }).notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
