import { sql } from 'drizzle-orm';
import {
  blob,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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
    /** 'KIS' | 'KIWOOM' — Stage 5a 추가. 기존 row 는 'KIS' default backfill. */
    broker: text('broker').notNull().default('KIS'),
    payload: blob('payload', { mode: 'buffer' }).notNull(), // safeStorage.encryptString(JSON.stringify(Credentials))
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('credentials_env_broker_uniq').on(t.env, t.broker)],
);

/**
 * 액세스 토큰 캐시 — 만료 6h 이내면 재사용.
 *
 * Stage 5a: PK `env` → `(broker, env)` 변경 (broker 별 토큰 격리).
 */
export const accessTokens = sqliteTable(
  'access_tokens',
  {
    broker: text('broker').notNull().default('KIS'),
    env: text('env').notNull(),
    token: text('token').notNull(),
    tokenType: text('token_type').notNull().default('Bearer'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    issuedAt: integer('issued_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.broker, t.env] })],
);

/**
 * 계좌 — 박스권 분할매매은 단일/다계좌 모두 지원.
 */
export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  env: text('env').notNull(), // 'MOCK' | 'PROD'
  broker: text('broker').notNull().default('KIS'), // 'KIS' | 'KIWOOM' | 'UPBIT' — provider 라벨 prefix
  accountNo8: text('account_no_8').notNull(),
  accountProdCd: text('account_prod_cd').notNull(),
  nickname: text('nickname').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  isActive: integer('is_active').notNull().default(0), // boolean — 현재 활성 계좌 여부. 한 시점에 1개만 true 보장은 앱 레벨에서.
  displayName: text('display_name'), // UI 표시용 (선택)
  sortOrder: integer('sort_order').notNull().default(0), // 사용자 수동 정렬 순서 (asc). 마이그레이션은 createdAt asc 순으로 backfill.
});

/**
 * 차수 장부 — 박스권 분할매매의 핵심 자료구조.
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
  perSymbolDailyMaxBuysEnabled: integer('per_symbol_daily_max_buys_enabled').notNull().default(0), // boolean
  perSymbolDailyMaxBuys: integer('per_symbol_daily_max_buys'), // NULL = 미설정
  dailyTotalMaxAmountEnabled: integer('daily_total_max_amount_enabled').notNull().default(0),
  dailyTotalMaxAmount: integer('daily_total_max_amount'),
  dailyTotalMaxCountEnabled: integer('daily_total_max_count_enabled').notNull().default(0),
  dailyTotalMaxCount: integer('daily_total_max_count'),
  accountTotalMaxAmountEnabled: integer('account_total_max_amount_enabled').notNull().default(0),
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

export const cryptoInstruments = sqliteTable(
  'crypto_instruments',
  {
    exchange: text('exchange').notNull(),
    market: text('market').notNull(),
    koreanName: text('korean_name').notNull(),
    englishName: text('english_name').notNull(),
    quoteCurrency: text('quote_currency').notNull(),
    baseCurrency: text('base_currency').notNull(),
    marketWarning: text('market_warning').notNull().default('NONE'),
    rawJson: text('raw_json'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.exchange, t.market] })],
);

export const cryptoCandles = sqliteTable(
  'crypto_candles',
  {
    exchange: text('exchange').notNull(),
    market: text('market').notNull(),
    unit: text('unit').notNull(),
    candleAt: integer('candle_at', { mode: 'timestamp_ms' }).notNull(),
    open: text('open').notNull(),
    high: text('high').notNull(),
    low: text('low').notNull(),
    close: text('close').notNull(),
    volume: text('volume').notNull(),
    tradePrice: text('trade_price').notNull(),
    rawJson: text('raw_json'),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.exchange, t.market, t.unit, t.candleAt] })],
);

export const cryptoOrders = sqliteTable(
  'crypto_orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id').notNull(),
    exchange: text('exchange').notNull(),
    market: text('market').notNull(),
    uuid: text('uuid'),
    identifier: text('identifier'),
    side: text('side').notNull(),
    ordType: text('ord_type').notNull(),
    state: text('state').notNull(),
    price: text('price'),
    volume: text('volume'),
    remainingVolume: text('remaining_volume').notNull().default('0'),
    executedVolume: text('executed_volume').notNull().default('0'),
    paidFee: text('paid_fee').notNull().default('0'),
    locked: text('locked').notNull().default('0'),
    rawJson: text('raw_json'),
    placedAt: integer('placed_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('crypto_orders_account_uuid_uniq').on(t.accountId, t.uuid),
    uniqueIndex('crypto_orders_account_identifier_uniq').on(t.accountId, t.identifier),
  ],
);

export const cryptoFills = sqliteTable(
  'crypto_fills',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id').notNull(),
    exchange: text('exchange').notNull(),
    orderUuid: text('order_uuid').notNull(),
    tradeUuid: text('trade_uuid'),
    market: text('market').notNull(),
    side: text('side').notNull(),
    price: text('price').notNull(),
    volume: text('volume').notNull(),
    funds: text('funds').notNull().default('0'),
    fee: text('fee').notNull().default('0'),
    rawJson: text('raw_json'),
    executedAt: integer('executed_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('crypto_fills_account_trade_uniq').on(t.accountId, t.tradeUuid)],
);

export const cryptoBalances = sqliteTable(
  'crypto_balances',
  {
    accountId: integer('account_id').notNull(),
    exchange: text('exchange').notNull(),
    currency: text('currency').notNull(),
    balance: text('balance').notNull(),
    locked: text('locked').notNull(),
    avgBuyPrice: text('avg_buy_price').notNull(),
    unitCurrency: text('unit_currency').notNull(),
    rawJson: text('raw_json'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.exchange, t.currency] })],
);

export const cryptoRealtimeCheckpoints = sqliteTable(
  'crypto_realtime_checkpoints',
  {
    accountId: integer('account_id').notNull(),
    exchange: text('exchange').notNull(),
    stream: text('stream').notNull(),
    lastEventAt: integer('last_event_at', { mode: 'timestamp_ms' }).notNull(),
    cursorJson: text('cursor_json'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.exchange, t.stream] })],
);

export const cryptoAutoConfigs = sqliteTable(
  'crypto_auto_configs',
  {
    accountId: integer('account_id').notNull(),
    exchange: text('exchange').notNull().default('UPBIT'),
    market: text('market').notNull(),
    mode: text('mode').notNull().default('disabled'),
    emergencyDisabled: integer('emergency_disabled', { mode: 'boolean' }).notNull().default(true),
    baseOrderKrw: text('base_order_krw').notNull().default('5000'),
    maxOrderKrw: text('max_order_krw').notNull().default('5000'),
    maxTotalExposureKrw: text('max_total_exposure_krw').notNull().default('50000'),
    minOrderTotalKrw: text('min_order_total_krw').notNull().default('5000'),
    addTriggerPct: text('add_trigger_pct').notNull().default('0.03'),
    takeProfitPct: text('take_profit_pct').notNull().default('0.02'),
    maxOpenLots: integer('max_open_lots').notNull().default(3),
    cooldownMs: integer('cooldown_ms').notNull().default(60000),
    staleCancelCap: integer('stale_cancel_cap').notNull().default(3),
    requireReadOnlySmoke: integer('require_readonly_smoke', { mode: 'boolean' })
      .notNull()
      .default(true),
    requireDryRunHistoryBeforeLive: integer('require_dry_run_history_before_live', {
      mode: 'boolean',
    })
      .notNull()
      .default(true),
    strategyJson: text('strategy_json'),
    lastDryRunAt: integer('last_dry_run_at', { mode: 'timestamp_ms' }),
    lastReadonlySmokeAt: integer('last_readonly_smoke_at', { mode: 'timestamp_ms' }),
    lastLiveActionAt: integer('last_live_action_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.exchange, t.market] })],
);

export const cryptoAutoWatches = sqliteTable(
  'crypto_auto_watches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id').notNull(),
    exchange: text('exchange').notNull().default('UPBIT'),
    market: text('market').notNull(),
    label: text('label'),
    status: text('status').notNull().default('PAUSED'),
    entryConditionJson: text('entry_condition_json')
      .notNull()
      .default('{"type":"immediate","price":null}'),
    strategyJson: text('strategy_json').notNull(),
    guardJson: text('guard_json'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('crypto_auto_watches_account_market_uniq').on(t.accountId, t.exchange, t.market),
  ],
);

export const cryptoAutoTemplates = sqliteTable(
  'crypto_auto_templates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id').notNull(),
    name: text('name').notNull(),
    strategyJson: text('strategy_json').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('crypto_auto_templates_account_name_uniq').on(t.accountId, t.name)],
);

export const cryptoAutoLots = sqliteTable('crypto_auto_lots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  exchange: text('exchange').notNull().default('UPBIT'),
  market: text('market').notNull(),
  source: text('source').notNull().default('dry-run'),
  sequence: integer('sequence').notNull(),
  quantity: text('quantity').notNull(),
  avgEntryKrw: text('avg_entry_krw').notNull(),
  allocatedKrw: text('allocated_krw').notNull(),
  realizedPnl: text('realized_pnl').notNull().default('0'),
  feesPaid: text('fees_paid').notNull().default('0'),
  status: text('status').notNull(),
  openedAt: integer('opened_at', { mode: 'timestamp_ms' }).notNull(),
  closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const cryptoAutoEvents = sqliteTable(
  'crypto_auto_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id').notNull(),
    exchange: text('exchange').notNull().default('UPBIT'),
    market: text('market').notNull(),
    mode: text('mode').notNull(),
    kind: text('kind').notNull(),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    intentJson: text('intent_json'),
    resultJson: text('result_json'),
    idempotencyKey: text('idempotency_key'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('crypto_auto_events_idempotency_uniq').on(t.accountId, t.idempotencyKey)],
);

/**
 * 잔고(차수) 스냅샷 — 일자별 종목 차수 이력.
 * 장마감 후 스케줄러가 현재 잔고를 기준으로 upsert.
 * payload_json: LotSnapshotEntry[] 직렬화.
 * current_price: 스냅샷 시점 현재가 (원).
 */
export const lotsSnapshots = sqliteTable(
  'lots_snapshots',
  {
    accountId: integer('account_id').notNull(),
    snapshotDate: text('snapshot_date').notNull(), // YYYY-MM-DD (KST)
    pdno: text('pdno').notNull(),
    name: text('name').notNull().default(''), // stock_master에서 캡처
    currentPrice: integer('current_price').notNull().default(0), // 스냅샷 시점 현재가
    payloadJson: text('payload_json').notNull(), // JSON: LotSnapshotEntry[]
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.snapshotDate, t.pdno] })],
);

/**
 * 공통 KRX 거래 캘린더.
 *
 * 주문 가능 여부는 KIS/Kiwoom broker별 응답이 아니라 이 테이블의 KRX 기준
 * verdict 를 최종 판단으로 사용한다. KIS chk-holiday 는 보조 검증 로그만 남긴다.
 */
export const tradingCalendarDays = sqliteTable('trading_calendar_days', {
  date: text('date').primaryKey(), // YYYYMMDD
  openDay: integer('open_day', { mode: 'boolean' }).notNull(),
  openMinute: integer('open_minute'), // KST 0~1439, 휴장/UNKNOWN 이면 NULL
  closeMinute: integer('close_minute'),
  reason: text('reason').notNull(),
  source: text('source').notNull(), // KRX_DOWNLOAD | MANUAL_IMPORT | BUNDLED | UNKNOWN
  sourceVersion: text('source_version'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * 예약 매수 — 잔고에 없는 신규 종목 감시 주문(최대 100건).
 * status: 'PENDING' | 'FILLED' | 'EXPIRED' | 'CANCELLED'.
 */
export const prebuyOrders = sqliteTable('prebuy_orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id'),
  pdno: text('pdno').notNull(),
  targetPrice: integer('target_price').notNull(),
  amountKrw: integer('amount_krw').notNull(),
  validUntil: integer('valid_until', { mode: 'timestamp_ms' }).notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * 종목 메모 — 글로벌 종목별 단일 메모(여러 계좌 공유).
 * pdno 가 PK. 향후 per-account 가 필요해지면 (account_id, pdno) 복합 PK로 확장 가능.
 */
export const symbolMemos = sqliteTable('symbol_memos', {
  pdno: text('pdno').primaryKey(), // 종목코드 6자리
  content: text('content').notNull().default(''), // 메모 본문
  updatedAt: integer('updated_at').notNull(), // unix epoch (ms)
});

/**
 * 코인 마켓별 메모 — UPBIT market(KRW-BTC 등)이 PK.
 * symbolMemos와 같은 패턴이지만 broker-specific으로 분리해 stock pdno regex와 충돌을 피한다. (RALPLAN P6 A5)
 */
export const cryptoMarketMemos = sqliteTable('crypto_market_memos', {
  market: text('market').primaryKey(), // KRW-BTC 등
  content: text('content').notNull().default(''),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * 통합 자동감시주문 큐 — 예약매수/사용자 감시를 단일 큐로 일원화.
 *
 * source:
 *   - 'BOOSTER' : 제거된 레거시 기능 호환용 잔존 값
 *   - 'PREBUY'  : 잔고 없는 신규 종목의 예약 매수
 *   - 'CUSTOM'  : 사용자 정의 자동감시 (BUY/SELL 모두 가능)
 *
 * comparator:
 *   - 'LTE' : price ≤ target_price 일 때 트리거 (BUY 기본)
 *   - 'GTE' : price ≥ target_price 일 때 트리거 (SELL 기본)
 *
 * status:
 *   - 'WATCHING' : 가격 감시 중
 *   - 'PAUSED'   : 사용자 일시중지 (재개 가능)
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
  sourceRefId: text('source_ref_id'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  status: text('status').notNull(), // 'WATCHING' | 'PAUSED' | 'EXECUTED' | 'FAILED' | 'EXPIRED' | 'CANCELLED'
  lastFailureReason: text('last_failure_reason'),
  metadata: text('metadata'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  executedAt: integer('executed_at', { mode: 'timestamp_ms' }),
});

/**
 * AI provider 키 카탈로그 — 사용자 BYO 로 등록한 OpenAI / Anthropic 키.
 *
 * 보안 불변식:
 *  - api_key 평문 저장 금지. safeStorage.encryptString(plain) 결과를 BLOB 으로 저장.
 *  - renderer 로 평문 송출 금지 — masked(prefix+****) 만 노출.
 *
 * is_default 는 동시에 1개만 true 여야 함 (라우터에서 enforce).
 */
/**
 * DART (한국 금융감독원 공시) corp_code 매핑 테이블 — KIS 6자리 stock_code → DART 8자리 corp_code.
 *
 * OpenDART corpCode.xml 을 zip 다운로드해 1회 sync 하고 나면 strategy 추천 시 공시 컨텍스트
 * 자동 lookup 가능. modify_date 는 회사 정보 변경일자 (YYYYMMDD).
 *
 * fetched_at 으로 30일 이상 stale 시 재 sync 트리거.
 */
export const dartCorpCodes = sqliteTable('dart_corp_codes', {
  stockCode: text('stock_code').primaryKey(), // KIS 6자리. 비상장은 미포함.
  corpCode: text('corp_code').notNull(), // DART 8자리.
  corpName: text('corp_name').notNull(),
  modifyDate: text('modify_date'), // YYYYMMDD
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * KRX 일별매매정보 캐시 — confirmed KRX Open API daily trading info only.
 *
 * 데이터 출처는 KOSPI/KOSDAQ/KONEX 일별매매정보 API 이며, market_cap 은 추천 컨텍스트와
 * 향후 market-cap candidate expansion 검증용 보조 데이터로만 사용한다.
 */
export const krxDailyTradeCache = sqliteTable(
  'krx_daily_trade_cache',
  {
    market: text('market').notNull(), // KOSPI | KOSDAQ | KONEX
    pdno: text('pdno').notNull(),
    date: text('date').notNull(), // YYYY-MM-DD
    name: text('name').notNull(),
    close: integer('close'),
    change: integer('change'),
    changeRate: real('change_rate'),
    open: integer('open'),
    high: integer('high'),
    low: integer('low'),
    volume: integer('volume'),
    tradeValue: integer('trade_value'),
    marketCap: integer('market_cap', { mode: 'number' }),
    listedShares: integer('listed_shares', { mode: 'number' }),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.market, t.pdno, t.date] })],
);

/**
 * KRX 종목기본정보 캐시 — basic info endpoint only.
 */
export const krxBaseInfoCache = sqliteTable(
  'krx_base_info_cache',
  {
    market: text('market').notNull(), // KOSPI | KOSDAQ | KONEX
    pdno: text('pdno').notNull(),
    date: text('date').notNull(), // YYYY-MM-DD
    isin: text('isin'),
    name: text('name').notNull(),
    shortName: text('short_name'),
    englishName: text('english_name'),
    listedAt: text('listed_at'), // YYYY-MM-DD
    marketName: text('market_name'),
    securityGroup: text('security_group'),
    section: text('section'),
    stockKind: text('stock_kind'),
    parValue: text('par_value'),
    listedShares: integer('listed_shares', { mode: 'number' }),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.market, t.pdno, t.date] })],
);

/**
 * ECOS 시계열 캐시 — StatisticSearch generic series.
 *
 * indicator 는 앱 내부의 의미 이름이고 stat/item/frequency 는 ECOS source contract 를 보존한다.
 */
export const ecosSeriesCache = sqliteTable(
  'ecos_series_cache',
  {
    indicator: text('indicator').notNull(),
    statCode: text('stat_code').notNull(),
    itemCode: text('item_code').notNull(),
    frequency: text('frequency').notNull(), // D | M | Q | A 등 ECOS cycle
    date: text('date').notNull(),
    value: real('value').notNull(),
    unitName: text('unit_name'),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.indicator, t.date] })],
);

export const aiProviderConfigs = sqliteTable(
  'ai_provider_configs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider').notNull(), // 'openai' | 'anthropic'
    model: text('model').notNull(),
    encryptedApiKey: blob('encrypted_api_key', { mode: 'buffer' }).notNull(),
    apiKeyMasked: text('api_key_masked').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    // is_default 단일성 DB 차원 enforce — repo transaction 만으로는 동시 다중 main 인스턴스 / 직접 SQL
    // / 마이그레이션 회귀 시 invariant 가 깨질 수 있다. partial unique index 로 안전망 추가.
    uniqueIndex('ai_provider_configs_default_uniq').on(t.isDefault).where(sql`is_default = 1`),
  ],
);
