import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * NM-016 catch-up 통합 다이얼로그.
 *
 * Phase B 강화:
 *  - IPC push(`appShell:catch-up-detected`) 수신 시 즉시 모달 표시.
 *  - tRPC scan pull 도 유지 (fallback / 부팅 초기 정합성).
 *  - [나중에 결정]: dismiss mutation 호출 → pending 영속화 + strategyEngine.resume.
 *  - [적용]: applyDecision mutation (마지막 항목에 isLastDecision=true) → strategyEngine.resume + clearPending.
 *  - 30초 timeout: 응답 없으면 timeoutDismiss mutation → strategyEngine.resume + 모달 unmount.
 */

type CatchUpDecision = 'ENTER_ALL' | 'ENTER_DEEPEST_ONLY' | 'IGNORE';

const DECISION_LABELS: Record<CatchUpDecision, string> = {
  ENTER_ALL: '모두 진입',
  ENTER_DEEPEST_ONLY: '가장 깊은 차수만',
  IGNORE: '무시',
};

const TIMEOUT_MS = 30_000;

interface CatchUpItem {
  accountId: number;
  pdno: string;
  name: string;
  currentPrice: number;
  maxReachedNth: number | null;
  lots: Array<{ nth: number; buyPrice: number }>;
  triggers: Array<unknown>;
}

export const CatchUpRuntime = ({
  accountId,
}: {
  accountId: number | null;
}): ReactElement | null => {
  /** scan query 로 받은 항목 (부팅 pull). IPC push 가 오면 덮어씀. */
  const [overrideItems, setOverrideItems] = useState<CatchUpItem[] | null>(null);
  /** 모달 닫힘 플래그 — true 이면 unmount. */
  const [dismissed, setDismissed] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, CatchUpDecision>>({});
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── tRPC mutations ──────────────────────────────────────────────────────────
  const applyMutation = trpc.catchUp.applyDecision.useMutation();
  const dismissMutation = trpc.catchUp.dismiss.useMutation();
  const timeoutDismissMutation = trpc.catchUp.timeoutDismiss.useMutation();

  // ── tRPC scan pull (부팅 fallback) ─────────────────────────────────────────
  const scan = trpc.catchUp.scan.useQuery(
    { accountId: accountId ?? 0 },
    {
      enabled: accountId !== null && !dismissed && overrideItems === null,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    },
  );

  // scan query 결과 반영 (IPC push 없을 때).
  const scanItems = useMemo(() => (scan.data?.items ?? []) as CatchUpItem[], [scan.data?.items]);

  /** 실제 표시할 items: IPC push 우선, 없으면 scan pull 결과 */
  const items: CatchUpItem[] = overrideItems ?? scanItems;

  // ── IPC push 구독 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (accountId === null) return;
    const unsub = window.appShell?.onCatchUpDetected?.((event) => {
      if (event.accountId !== accountId) return;
      // IPC push: 모달 즉시 표시. dismissed 상태 초기화.
      setDismissed(false);
      setOverrideItems(event.items as CatchUpItem[]);
    });
    return () => unsub?.();
  }, [accountId]);

  // ── 30초 timeout ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (dismissed || items.length === 0 || accountId === null) return;
    // 모달이 표시될 때마다 타이머 재설정.
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutDismissMutation.mutate({ accountId });
      setDismissed(true);
    }, TIMEOUT_MS);
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
    // items.length 가 바뀌면 (IPC re-push) 타이머 재설정.
  }, [accountId, dismissed, items.length, timeoutDismissMutation.mutate]);

  // ── 결정 handlers ──────────────────────────────────────────────────────────
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

  /** [적용] — 모든 항목에 결정 적용. 마지막 항목에 isLastDecision=true 로 resume + clearPending. */
  const handleApply = useCallback(async () => {
    if (accountId === null || items.length === 0) return;
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      const decision = decisions[item.pdno] ?? 'IGNORE';
      await applyMutation.mutateAsync({
        accountId,
        pdno: item.pdno,
        decision,
        maxReachedNth: item.maxReachedNth,
        isLastDecision: i === items.length - 1,
      });
    }
    setDismissed(true);
  }, [accountId, applyMutation, decisions, items]);

  /** [나중에 결정] — pending 영속화 + strategyEngine.resume. 다음 부팅에서 재노출. */
  const handleDismiss = useCallback(async () => {
    if (accountId === null) return;
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    await dismissMutation.mutateAsync({
      accountId,
      items: items.map((item) => ({
        accountId: item.accountId,
        pdno: item.pdno,
        name: item.name,
        maxReachedNth: item.maxReachedNth,
      })),
    });
    setDismissed(true);
  }, [accountId, dismissMutation, items]);

  // ── render guard ───────────────────────────────────────────────────────────
  if (accountId === null || dismissed) return null;
  // scan 로딩 중이고 IPC override 도 없으면 대기.
  if (overrideItems === null && scan.isPending) return null;
  if (items.length === 0) return null;

  const isMutating = applyMutation.isPending || dismissMutation.isPending;

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
          <p className="mt-1 text-xs text-amber-600">
            30초 내 미응답 시 자동으로 닫힙니다 (다음 부팅에서 다시 확인).
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
          <Button onClick={handleDismiss} disabled={isMutating}>
            나중에 결정
          </Button>
          <Button onClick={handleApply} disabled={isMutating}>
            적용
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

CatchUpRuntime.displayName = 'CatchUpRuntime';
