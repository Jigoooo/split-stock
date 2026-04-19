import { blob, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * 자격증명 — safeStorage로 암호화된 직렬화 결과를 BLOB으로 저장.
 * 원문 평문은 어디에도 남기지 않는다.
 * 계좌별 1행 (account_id PK). env는 한 행당 1개만 가능 (UNIQUE INDEX).
 *
 * BC 노트: PK가 env→account_id로 변경됨 (마이그레이션 0005에서 데이터 보존).
 * 기존 호출자(env로 lookup)는 unique index 통한 단일 결과 보장.
 */
export const credentials = sqliteTable(
  'credentials',
  {
    accountId: integer('account_id').primaryKey(),
    env: text('env').notNull(), // 'MOCK' | 'PROD'
    payload: blob('payload', { mode: 'buffer' }).notNull(), // safeStorage.encryptString(JSON.stringify(Credentials))
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('credentials_env_uniq').on(t.env)],
);

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
  isActive: integer('is_active').notNull().default(0), // boolean — 현재 활성 계좌 여부. 한 시점에 1개만 true 보장은 앱 레벨에서.
  displayName: text('display_name'), // UI 표시용 (선택)
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
  auditPayload: text('audit_payload'), // 차수 수동편집 등 before/after 스냅샷 (JSON 직렬화, NULL 허용)
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
 * 매매 시간대 설정 — 계좌별 BUY/SELL 구간 최대 3슬롯.
 * side: 'BUY' | 'SELL', slot: 1~3, start/end_minute: 0~1439 (00:00=0, 23:59=1439).
 */
export const timeWindows = sqliteTable('time_windows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(), // FK → accounts.id
  side: text('side').notNull(), // 'BUY' | 'SELL'
  slot: integer('slot').notNull(), // 1 | 2 | 3
  enabled: integer('enabled').notNull().default(0), // boolean
  startMinute: integer('start_minute').notNull(), // 0~1439
  endMinute: integer('end_minute').notNull(), // 0~1439
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * 자동매매 보호 한도 — 계좌 단위 1행. accountId가 PK.
 * NULL = 미설정(제한 없음).
 */
export const protectionLimits = sqliteTable('protection_limits', {
  accountId: integer('account_id').primaryKey(), // FK → accounts.id
  perSymbolDailyMaxBuys: integer('per_symbol_daily_max_buys'), // NULL = 미설정
  dailyTotalMaxAmount: integer('daily_total_max_amount'),
  dailyTotalMaxCount: integer('daily_total_max_count'),
  accountTotalMaxAmount: integer('account_total_max_amount'),
  rateGuardEnabled: integer('rate_guard_enabled').notNull().default(0), // boolean
  rateGuardWindowSeconds: integer('rate_guard_window_seconds').default(40),
  rateGuardMaxCount: integer('rate_guard_max_count').default(5),
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

/**
 * 통합 자동감시주문 큐 — booster/prebuy/custom을 단일 큐로 일원화.
 *
 * source:
 *   - 'BOOSTER' : 1차 전량 매도 후 lastFilledPrice*(1-boosterPct) 도달 시 1차 재매수
 *   - 'PREBUY'  : 잔고 없는 신규 종목의 예약 매수
 *   - 'CUSTOM'  : 사용자 정의 자동감시 (BUY/SELL 모두 가능)
 *
 * comparator:
 *   - 'LTE' : price ≤ target_price 일 때 트리거 (BUY 기본)
 *   - 'GTE' : price ≥ target_price 일 때 트리거 (SELL 기본)
 *
 * status:
 *   - 'WATCHING' : 가격 감시 중
 *   - 'EXECUTED' : 주문 발사 성공
 *   - 'FAILED'   : 주문 발사 실패 (last_failure_reason 참조)
 *   - 'EXPIRED'  : expires_at 경과
 *   - 'CANCELLED': 사용자 취소
 *
 * qty_or_amount_mode == 'QTY'    → qty 사용 (수량 직접 지정)
 * qty_or_amount_mode == 'AMOUNT' → amount_krw 사용 (금액 → 트리거 시점 가격으로 수량 환산)
 */
export const watchOrders = sqliteTable('watch_orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(), // FK → accounts.id
  pdno: text('pdno').notNull(),
  source: text('source').notNull(), // 'BOOSTER' | 'PREBUY' | 'CUSTOM'
  side: text('side').notNull(), // 'BUY' | 'SELL'
  targetPrice: integer('target_price').notNull(),
  comparator: text('comparator').notNull(), // 'LTE' | 'GTE'
  orderType: text('order_type').notNull(), // 'MARKET' | 'LIMIT'
  qtyOrAmountMode: text('qty_or_amount_mode').notNull(), // 'QTY' | 'AMOUNT'
  qty: integer('qty'),
  amountKrw: integer('amount_krw'),
  nth: integer('nth'), // booster=1, prebuy=1, custom=사용자 지정 (nullable)
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  status: text('status').notNull(), // 'WATCHING' | 'EXECUTED' | 'FAILED' | 'EXPIRED' | 'CANCELLED'
  lastFailureReason: text('last_failure_reason'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  executedAt: integer('executed_at', { mode: 'timestamp_ms' }),
});
