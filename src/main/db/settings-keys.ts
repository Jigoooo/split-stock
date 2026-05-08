export type ReorderMode = 'NONE' | 'MARKET' | 'LIMIT_AT_LAST_PRICE';

export const SETTING_KEYS = {
  LAST_ACTIVE_ENV: 'last_active_env',
  WATCH_GLOBAL_ENABLED_PREFIX: 'watch.global.enabled',
  /** 안전 스위치 master(주문 허용) per-account 영속화 키 prefix. */
  SAFETY_MASTER_PREFIX: 'safety.master',
  /** 미체결 자동 취소 활성화 여부 ('true'/'false'). */
  PENDING_CANCEL_ENABLED: 'pending_cancel_enabled',
  /** 미체결 지정가 주문 자동 취소 타임아웃 (분, 1~60). */
  PENDING_CANCEL_TIMEOUT_MIN: 'pending_cancel_timeout_min',
  /** 자동 취소 재시도 최대 횟수 (1~30) 또는 'unlimited'. */
  PENDING_CANCEL_MAX_RETRIES: 'pending_cancel_max_retries',
  /** 취소 후 재주문 모드: 'NONE'|'MARKET'|'LIMIT_AT_LAST_PRICE'. */
  PENDING_CANCEL_REORDER_MODE: 'pending_cancel_reorder_mode',
  /** 실 계좌 매입 수수료 (%) */
  FEES_REAL_BUY: 'fees.real.buy',
  /** 실 계좌 매도 수수료 (%) */
  FEES_REAL_SELL: 'fees.real.sell',
  /** 실 계좌 제세금 (%) */
  FEES_REAL_TAX: 'fees.real.tax',
  /** 모의 계좌 매입 수수료 (%) */
  FEES_MOCK_BUY: 'fees.mock.buy',
  /** 모의 계좌 매도 수수료 (%) */
  FEES_MOCK_SELL: 'fees.mock.sell',
  /** 모의 계좌 제세금 (%) */
  FEES_MOCK_TAX: 'fees.mock.tax',
  /** 지정가 매수 호가 자동 보정 전략: 'AGGRESSIVE'|'CONSERVATIVE'. */
  PRICE_CORRECTION_BUY: 'price_correction.buy',
  /** 지정가 매도 호가 자동 보정 전략: 'AGGRESSIVE'|'CONSERVATIVE'. */
  PRICE_CORRECTION_SELL: 'price_correction.sell',

  DISPLAY_MA5_ENABLED: 'display.chart.ma5.enabled',
  DISPLAY_MA5_COLOR: 'display.chart.ma5.color',
  DISPLAY_MA5_WIDTH: 'display.chart.ma5.width',
  DISPLAY_MA5_STYLE: 'display.chart.ma5.style',
  DISPLAY_MA10_ENABLED: 'display.chart.ma10.enabled',
  DISPLAY_MA10_COLOR: 'display.chart.ma10.color',
  DISPLAY_MA10_WIDTH: 'display.chart.ma10.width',
  DISPLAY_MA10_STYLE: 'display.chart.ma10.style',
  DISPLAY_MA20_ENABLED: 'display.chart.ma20.enabled',
  DISPLAY_MA20_COLOR: 'display.chart.ma20.color',
  DISPLAY_MA20_WIDTH: 'display.chart.ma20.width',
  DISPLAY_MA20_STYLE: 'display.chart.ma20.style',
  DISPLAY_MA60_ENABLED: 'display.chart.ma60.enabled',
  DISPLAY_MA60_COLOR: 'display.chart.ma60.color',
  DISPLAY_MA60_WIDTH: 'display.chart.ma60.width',
  DISPLAY_MA60_STYLE: 'display.chart.ma60.style',
  DISPLAY_MA120_ENABLED: 'display.chart.ma120.enabled',
  DISPLAY_MA120_COLOR: 'display.chart.ma120.color',
  DISPLAY_MA120_WIDTH: 'display.chart.ma120.width',
  DISPLAY_MA120_STYLE: 'display.chart.ma120.style',

  DISPLAY_VOLUME_UP_COLOR: 'display.chart.volume.upColor',
  DISPLAY_VOLUME_DOWN_COLOR: 'display.chart.volume.downColor',
  DISPLAY_VOLUME_HEIGHT_PERCENT: 'display.chart.volume.heightPercent',
  DISPLAY_CROSSHAIR_MODE: 'display.chart.crosshair.mode',
  DISPLAY_CROSSHAIR_LABEL_VISIBLE: 'display.chart.crosshair.labelVisible',

  DISPLAY_GRID_ROW_HEIGHT_PX: 'display.grid.rowHeightPx',
  DISPLAY_GRID_STAGE_CELL_MODE: 'display.grid.stageCellMode',

  /** WS 세션 capacity — KIS 기본 20, 향후 60 확장 시 사용자가 변경 가능 (1~60). */
  REALTIME_WS_CAPACITY: 'realtime.wsCapacity',

  /** 2중 백업 외부 드라이브 경로 */
  BACKUP_DUPLICATE_PATH: 'backup.duplicatePath',
  /** 자동 백업 활성화 (기본: true) */
  BACKUP_AUTO_ENABLED: 'backup.autoEnabled',
  /** 자동 백업 보관 일수 (기본: 10일, 1~365 범위) */
  BACKUP_AUTO_RETENTION_DAYS: 'backup.autoRetentionDays',

  /**
   * NM-016 catch-up 통합 다이얼로그 — "나중에 결정" 시 영속화 batch JSON.
   * 다음 부팅 시 새 scan 결과 + pending batch 합쳐 모달 재노출 (pending 우선 표시).
   * 적용 / 명시적 무시 / 30초 timeout 시 삭제.
   */
  CATCH_UP_PENDING: 'catch_up.pending',
} as const;

export function watchGlobalEnabledKey(accountId: number): string {
  return `${SETTING_KEYS.WATCH_GLOBAL_ENABLED_PREFIX}.${accountId}`;
}

export function safetyMasterKey(accountId: number): string {
  return `${SETTING_KEYS.SAFETY_MASTER_PREFIX}.${accountId}`;
}
