import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import type { RefObject } from 'react';

export interface UseTableGridVirtualOptions {
  count: number;
  /** 행 높이 추정 — index 별 가변 가능 */
  estimateSize: (index: number) => number;
  /** scroll container ref */
  parentRef: RefObject<HTMLElement | null>;
  /** 화면 밖 prefetch 행 수 (default 8) */
  overscan?: number;
}

export interface UseTableGridVirtualResult {
  items: VirtualItem[];
  totalSize: number;
  /** 동적 높이 측정 — Row 의 ref 로 전달 */
  measureElement: (el: Element | null) => void;
}

/**
 * @tanstack/react-virtual 의 useVirtualizer 를 table-grid 패턴에 맞춰 wrapping.
 * - flex 컨테이너 (Body) 안에서도 정상 동작
 * - measureElement 로 동적 높이 (expand 등) 지원
 *
 * 주의: Compound 외부에서 직접 사용 가능 — Body 가 자동으로 호출하지는 않음.
 * Body 컴포넌트는 ref forwarding 만 담당, 가상화 적용은 호출 측에서 결정.
 */
export function useTableGridVirtual(
  options: UseTableGridVirtualOptions,
): UseTableGridVirtualResult {
  const { count, estimateSize, parentRef, overscan = 8 } = options;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan,
  });

  return {
    items: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    measureElement: virtualizer.measureElement,
  };
}
