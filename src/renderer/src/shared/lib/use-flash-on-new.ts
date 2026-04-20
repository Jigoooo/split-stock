import { useEffect, useRef, useState } from 'react';

/**
 * 새로 진입한 row key에 대해 flashDurationMs 동안만 true를 반환한다.
 * - 첫 마운트(초기 대량 로드) 때는 flash 없음 — 사용자에게 "방금 들어온 이벤트"만 강조.
 * - stable key 기반 (id 또는 equivalent unique key).
 *
 * 사용 예:
 *   const flashSet = useFlashOnNew(ticks, (t) => t.id);
 *   <tr data-flash={flashSet.has(tick.id) ? sideToFlash(tick.side) : undefined}>
 */
export function useFlashOnNew<T>(
  items: readonly T[],
  getKey: (item: T) => string | number,
  flashDurationMs = 500,
): ReadonlySet<string | number> {
  const seenRef = useRef<Set<string | number> | null>(null);
  const [flashing, setFlashing] = useState<ReadonlySet<string | number>>(() => new Set());

  useEffect(() => {
    // 첫 렌더: 기존 아이템은 전부 "seen"으로 기록해서 초기 로드 시 flash 방지
    if (seenRef.current === null) {
      seenRef.current = new Set(items.map(getKey));
      return;
    }

    const seen = seenRef.current;
    const nextKeys = items.map(getKey);
    const newKeys: (string | number)[] = [];
    for (const key of nextKeys) {
      if (!seen.has(key)) {
        seen.add(key);
        newKeys.push(key);
      }
    }

    if (newKeys.length === 0) return;

    // 기존 flashing set 에 추가
    setFlashing((prev) => {
      const next = new Set(prev);
      for (const k of newKeys) next.add(k);
      return next;
    });

    const timeouts = newKeys.map((key) =>
      setTimeout(() => {
        setFlashing((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, flashDurationMs),
    );

    return () => {
      for (const id of timeouts) clearTimeout(id);
    };
    // items 배열 자체의 참조/길이/순서 변경 시 재평가
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, flashDurationMs]);

  return flashing;
}
