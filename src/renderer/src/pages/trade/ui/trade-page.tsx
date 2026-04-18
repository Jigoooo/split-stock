import { SearchStockInput } from '@renderer/features/search-stock';
import { trpc } from '@renderer/shared/api/trpc';
import { PositionChart } from '@renderer/widgets/position-chart';
import { TradingPanel } from '@renderer/widgets/trading-panel';
import type { ReactElement } from 'react';
import { useState } from 'react';

interface Selected {
  pdno: string;
  name: string;
}

/**
 * 주문 전용 페이지 — 종목 검색 → 차트 + 호가창/체결창/주문 티켓/미체결 통합.
 * Dashboard와 달리 보유 중 아닌 종목도 직접 검색해 조회/주문 가능.
 */
export const TradePage = (): ReactElement => {
  const envQuery = trpc.auth.getEnv.useQuery();
  const realtimeStatus = trpc.realtime.status.useQuery(undefined, {
    enabled: (envQuery.data?.env ?? null) !== null,
    refetchInterval: 5000,
  });
  const startRealtime = trpc.realtime.start.useMutation({
    onSuccess: () => realtimeStatus.refetch(),
  });
  const [selected, setSelected] = useState<Selected | null>(null);
  const overlay = trpc.account.getPositionOverlay.useQuery(
    { pdno: selected?.pdno ?? '000000', includeSold: true },
    { enabled: selected !== null },
  );

  return (
    <div style={{ display: 'grid', gap: '1.2rem' }}>
      <div className="panel">
        <div className="panel__title">종목 선택</div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <SearchStockInput onSelect={(hit) => setSelected({ pdno: hit.pdno, name: hit.name })} />
          </div>
          {selected ? (
            <span className="chip chip--up">
              {selected.name} ({selected.pdno})
            </span>
          ) : (
            <span className="muted">종목명 또는 6자리 코드 검색</span>
          )}
          {selected ? (
            <button
              type="button"
              className="hts-btn"
              onClick={() => setSelected(null)}
              aria-label="선택 해제"
            >
              선택 해제
            </button>
          ) : null}
        </div>
      </div>

      {selected ? (
        <>
          <PositionChart
            pdno={selected.pdno}
            name={selected.name}
            lines={overlay.data?.lines ?? []}
          />
          {realtimeStatus.data?.started ? (
            <TradingPanel
              pdno={selected.pdno}
              name={selected.name}
              isProd={envQuery.data?.env === 'PROD'}
            />
          ) : (
            <div className="panel">
              <div
                className="panel__body"
                style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}
              >
                <span className="muted">실시간 피드 미활성 — 호가/체결을 보려면 시작 필요</span>
                <button
                  type="button"
                  className="hts-btn hts-btn--primary"
                  disabled={startRealtime.isPending}
                  onClick={() => startRealtime.mutate()}
                >
                  실시간 시작
                </button>
                {startRealtime.error ? (
                  <span className="chip chip--down">{startRealtime.error.message}</span>
                ) : null}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="panel">
          <div className="panel__body muted">
            위 검색창에서 종목을 선택하면 차트/호가창/체결창/주문 티켓이 나타납니다.
          </div>
        </div>
      )}
    </div>
  );
};
