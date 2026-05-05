import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { type NormalizedOrder, OrdersPanel } from '@renderer/widgets/orders-panel';
import { type ReactElement, useMemo } from 'react';

export interface FilledPaneProps {
  selectedPdno: string | null;
  /** Phase R3-1: broker (default 'KIS'). 코인 page 가 'UPBIT' 로 사용 가능. */
  broker?: string;
}

const FILLED_COLUMNS = ['time', 'symbol', 'side', 'qty', 'price', 'state'] as const;

/**
 * L2 "실시간 체결" 탭 — 내 계좌의 체결된 주문 확인용.
 *
 * 시장 전체 tick 피드(useTradeFeed) 와 구분된다:
 *   - TradingPanel 의 "실시간 체결" 탭은 시장 tick (남의 체결 포함)
 *   - 이 탭(MainPositionsPane)은 "내 주문이 체결됐는지" 확인 목적
 *
 * 데이터 소스: orders 테이블 (FILLED / PARTIAL 상태, 활성 계좌)
 *   - selectedPdno 없음 → 전체 체결
 *   - selectedPdno 있음 → 해당 종목 체결만 필터
 *
 * KIS CNI 체결통보 또는 balance-sync 로 orders 상태가 갱신되면 자동 refetch.
 * refetchInterval 3초로 폴링 기반 보강 — WebSocket 이 끊겨도 최종 일관성 확보.
 *
 * P2: broker-agnostic OrdersPanel 위에서 wrap. KIS-specific (division==='MARKET' 시 "시장가"
 * 라벨, status==='PARTIAL' chip) 은 어댑터 단계에서 NormalizedOrder 로 흡수.
 */
export const FilledPane = ({ selectedPdno, broker }: FilledPaneProps): ReactElement => {
  const query = trpc.order.listMyFills.useQuery(
    {
      pdno: selectedPdno ?? undefined,
      limit: 100,
      ...(broker !== undefined ? { broker } : {}),
    },
    { refetchInterval: 3000 },
  );

  const rows = query.data?.orders ?? [];
  const orders = useMemo<NormalizedOrder[]>(
    () =>
      rows.map((row) => ({
        id: String(row.id),
        symbol: row.pdno,
        symbolLabel: row.name ? `${row.name} (${row.pdno})` : row.pdno,
        side: row.side === 'BUY' ? 'BUY' : 'SELL',
        qty: row.qty,
        remainingQty: 0,
        filledQty: row.qty,
        price: row.price,
        priceLabel: row.division === 'MARKET' ? '시장가' : thousandSeparator(row.price),
        stateLabel: row.status === 'FILLED' ? '체결' : '부분체결',
        stateVariant: row.status === 'FILLED' ? 'up' : 'neutral',
        placedAt: row.filledAt ?? row.placedAt,
      })),
    [rows],
  );

  const title = selectedPdno
    ? `내 체결 (${selectedPdno}) — 최근 ${thousandSeparator(rows.length)}건`
    : `내 체결 — 최근 ${thousandSeparator(rows.length)}건`;

  if (query.isLoading && rows.length === 0) {
    return (
      <div className="panel" style={panelStyle}>
        <div className="panel__title" style={{ flexShrink: 0 }}>
          {title}
        </div>
        <div className="panel__body muted">불러오는 중…</div>
      </div>
    );
  }

  if (query.error) {
    return (
      <div className="panel" style={panelStyle}>
        <div className="panel__title" style={{ flexShrink: 0 }}>
          {title}
        </div>
        <div className="panel__body">
          <span className="chip chip--down">{query.error.message}</span>
        </div>
      </div>
    );
  }

  return (
    <OrdersPanel
      mode="filled"
      title={title}
      columns={FILLED_COLUMNS}
      orders={orders}
      emptyText={selectedPdno ? '해당 종목의 체결 내역이 없습니다' : '체결 내역이 없습니다'}
      tableAriaLabel="내 체결 목록"
    />
  );
};

const panelStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
};
