import { trpc } from '@renderer/shared/api/trpc';
import { PositionChart } from '@renderer/widgets/position-chart';
import { StockPickerList } from '@renderer/widgets/stock-picker-list';
import { TradingPanel } from '@renderer/widgets/trading-panel';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';

interface Selected {
  pdno: string;
  name: string;
}

const LAST_SELECTED_KEY = 'trade.lastSelected';

function readLastSelected(): Selected | null {
  try {
    const raw = window.localStorage.getItem(LAST_SELECTED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Selected).pdno === 'string' &&
      typeof (parsed as Selected).name === 'string' &&
      /^\d{6}$/.test((parsed as Selected).pdno)
    ) {
      return parsed as Selected;
    }
  } catch {
    // JSON 파싱 실패 등 무시
  }
  return null;
}

/**
 * 주문 전용 페이지.
 * 레이아웃(항상 동일):
 *   1) 상단: 종목 검색 인풋 (autocomplete) + 현재 선택 칩
 *   2) 중단: 차트 (일/주/월 탭)
 *   3) 하단: 호가창/체결창/주문 티켓 (실시간 자동 시작)
 */
export const TradePage = (): ReactElement => {
  const envQuery = trpc.auth.getEnv.useQuery();
  const envReady = (envQuery.data?.env ?? null) !== null;
  const realtimeStatus = trpc.realtime.status.useQuery(undefined, {
    enabled: envReady,
    refetchInterval: 5000,
  });
  const startRealtime = trpc.realtime.start.useMutation({
    onSuccess: () => realtimeStatus.refetch(),
  });

  const [selected, setSelectedState] = useState<Selected | null>(() => readLastSelected());
  const setSelected = useCallback((next: Selected | null): void => {
    setSelectedState(next);
    try {
      if (next) {
        window.localStorage.setItem(LAST_SELECTED_KEY, JSON.stringify(next));
      } else {
        window.localStorage.removeItem(LAST_SELECTED_KEY);
      }
    } catch {
      // storage 쿼터/권한 문제 무시 — 세션 내 동작엔 영향 없음
    }
  }, []);
  const overlay = trpc.account.getPositionOverlay.useQuery(
    { pdno: selected?.pdno ?? '000000', includeSold: true },
    { enabled: selected !== null },
  );

  // 팝아웃 창(stock-picker 등)에서 선택한 종목을 메인 창에도 반영
  useEffect(() => {
    const shell = window.appShell;
    if (!shell) return;
    return shell.onStockAssigned((pdno, name) => {
      setSelected({ pdno, name });
    });
  }, [setSelected]);

  // 실시간 피드는 항상 켜짐 — 환경 준비 후 자동 start 1회.
  useEffect(() => {
    if (!envReady) return;
    if (realtimeStatus.data?.started) return;
    if (startRealtime.isPending || startRealtime.isSuccess) return;
    startRealtime.mutate();
  }, [envReady, realtimeStatus.data?.started, startRealtime]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.2rem',
        height: '100%',
        minHeight: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <StockPickerList
            {...(selected ? { selectedPdno: selected.pdno } : {})}
            onSelect={(entry) => setSelected({ pdno: entry.pdno, name: entry.name })}
          />
        </div>
        {selected ? (
          <span className="chip chip--up">
            {selected.name} ({selected.pdno})
            <button
              type="button"
              className="hts-btn"
              onClick={() => setSelected(null)}
              aria-label="선택 해제"
              style={{
                marginLeft: '0.6rem',
                padding: '0.1rem 0.5rem',
                fontSize: '1rem',
              }}
            >
              ✕
            </button>
          </span>
        ) : null}
      </div>

      {selected ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(360px, 1fr) minmax(640px, 760px)',
            gap: '1.2rem',
          }}
        >
          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <PositionChart
              pdno={selected.pdno}
              name={selected.name}
              lines={overlay.data?.lines ?? []}
            />
          </div>
          <div
            style={{
              minHeight: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'auto',
            }}
          >
            <TradingPanel
              pdno={selected.pdno}
              name={selected.name}
              isProd={envQuery.data?.env === 'PROD'}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};
