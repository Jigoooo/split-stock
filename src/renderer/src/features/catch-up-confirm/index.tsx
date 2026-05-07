import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import { type ReactElement, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * NM-016 catch-up 통합 다이얼로그.
 *
 * 부팅 시 활성 계좌의 모든 종목에 대해 catch-up scan 후 도달한 차수가 있는 경우
 * 단일 통합 모달로 종목별 결정 받음. 자동 진입 절대 금지 — 결정은 event_logs 기록만 (MVP).
 *
 * 모달은 사용자 결정 후 close. 다음 부팅 때 다시 scan.
 */

type CatchUpDecision = 'ENTER_ALL' | 'ENTER_DEEPEST_ONLY' | 'IGNORE';

const DECISION_LABELS: Record<CatchUpDecision, string> = {
  ENTER_ALL: '모두 진입',
  ENTER_DEEPEST_ONLY: '가장 깊은 차수만',
  IGNORE: '무시',
};

export const CatchUpRuntime = ({
  accountId,
}: {
  accountId: number | null;
}): ReactElement | null => {
  const [dismissed, setDismissed] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, CatchUpDecision>>({});

  const scan = trpc.catchUp.scan.useQuery(
    { accountId: accountId ?? 0 },
    {
      enabled: accountId !== null && !dismissed,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    },
  );
  const apply = trpc.catchUp.applyDecision.useMutation();

  const items = useMemo(() => scan.data?.items ?? [], [scan.data?.items]);

  const setDecision = useCallback((pdno: string, decision: CatchUpDecision) => {
    setDecisions((prev) => ({ ...prev, [pdno]: decision }));
  }, []);

  const setBulk = useCallback(
    (decision: CatchUpDecision) => {
      setDecisions((prev) => {
        const next = { ...prev };
        for (const item of items) next[item.pdno] = decision;
        return next;
      });
    },
    [items],
  );

  const handleApply = useCallback(async () => {
    if (accountId === null) return;
    for (const item of items) {
      const decision = decisions[item.pdno] ?? 'IGNORE';
      await apply.mutateAsync({
        accountId,
        pdno: item.pdno,
        decision,
        maxReachedNth: item.maxReachedNth,
      });
    }
    setDismissed(true);
  }, [accountId, apply, decisions, items]);

  if (accountId === null || dismissed) return null;
  if (scan.isPending || items.length === 0) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[80vh] w-[min(960px,90vw)] overflow-auto rounded-lg bg-white shadow-2xl">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">자동매매 catch-up 감지 ({items.length}종목)</h2>
          <p className="mt-1 text-sm text-gray-600">
            프로그램 비가동 중 가격이 다수 차수 trigger 까지 도달했습니다. 종목별 진행 방향을
            선택하세요. 매직스플릿 룰상 "가장 깊은 차수만" 은 룰 위배 (빈 차수 발생) 입니다.
          </p>
          <div className="mt-3 flex gap-2 text-sm">
            <span className="text-gray-500">전체 일괄:</span>
            {(Object.keys(DECISION_LABELS) as CatchUpDecision[]).map((d) => (
              <button
                key={d}
                type="button"
                className="rounded border px-2 py-0.5 hover:bg-gray-50"
                onClick={() => setBulk(d)}
              >
                {DECISION_LABELS[d]}
              </button>
            ))}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">종목</th>
              <th className="px-4 py-2 text-right">현재가</th>
              <th className="px-4 py-2 text-right">도달 차수</th>
              <th className="px-4 py-2 text-right">1차 매입가</th>
              <th className="px-4 py-2 text-left">결정</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const firstLot = item.lots.find((l) => l.nth === 1);
              const current = decisions[item.pdno] ?? 'IGNORE';
              return (
                <tr key={item.pdno} className="border-t">
                  <td className="px-4 py-2">
                    {item.name} ({item.pdno})
                  </td>
                  <td className="px-4 py-2 text-right">{item.currentPrice.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">{item.maxReachedNth ?? '-'}차</td>
                  <td className="px-4 py-2 text-right">
                    {firstLot ? firstLot.buyPrice.toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={current}
                      onChange={(e) => setDecision(item.pdno, e.target.value as CatchUpDecision)}
                      className="rounded border px-2 py-1"
                      aria-label={`${item.name} catch-up 결정`}
                    >
                      {(Object.keys(DECISION_LABELS) as CatchUpDecision[]).map((d) => (
                        <option key={d} value={d}>
                          {DECISION_LABELS[d]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex justify-end gap-2 border-t bg-gray-50 px-6 py-3">
          <Button onClick={() => setDismissed(true)}>나중에 결정</Button>
          <Button onClick={handleApply} disabled={apply.isPending}>
            적용
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

CatchUpRuntime.displayName = 'CatchUpRuntime';
