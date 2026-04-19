import { trpc } from '@renderer/shared/api/trpc';
import { PositionChart } from '@renderer/widgets/position-chart';
import { StockPickerList } from '@renderer/widgets/stock-picker-list';
import { TradingPanel } from '@renderer/widgets/trading-panel';
import type { ReactElement } from 'react';
import { useState } from 'react';

interface Selected {
  pdno: string;
  name: string;
}

/**
 * 주문 전용 페이지 — 종목 리스트(무한스크롤) → 차트 + 호가창/체결창/주문 티켓/미체결 통합.
 * 좌측은 전체 KOSPI/KOSDAQ 종목 마스터, 우측은 선택된 종목의 차트/트레이딩 패널.
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
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(320px, 360px) 1fr',
        gap: '1.2rem',
        height: '100%',
        minHeight: 0,
      }}
    >
      <div style={{ minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <StockPickerList
          {...(selected ? { selectedPdno: selected.pdno } : {})}
          onSelect={(entry) => setSelected({ pdno: entry.pdno, name: entry.name })}
        />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.2rem',
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        <div className="panel">
          <div className="panel__title">선택한 종목</div>
          <div
            className="panel__body"
            style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}
          >
            {selected ? (
              <>
                <span className="chip chip--up">
                  {selected.name} ({selected.pdno})
                </span>
                <button
                  type="button"
                  className="hts-btn"
                  onClick={() => setSelected(null)}
                  aria-label="선택 해제"
                >
                  선택 해제
                </button>
              </>
            ) : (
              <span className="muted">좌측 목록에서 종목을 선택하세요</span>
            )}
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
              종목 선택 시 차트/호가창/체결창/주문 티켓이 여기에 표시됩니다.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
