import { trpc } from '@renderer/shared/api/trpc';
import type { LotOverlayLine } from '@shared/trading/lot-overlay';

export interface UsePositionOverlayOptions {
  includeSold?: boolean;
}

export interface UsePositionOverlayResult {
  isPending: boolean;
  error: { message: string } | null;
  lines: LotOverlayLine[];
}

export function usePositionOverlay(
  pdno: string | null,
  options: UsePositionOverlayOptions = {},
): UsePositionOverlayResult {
  const query = trpc.account.getPositionOverlay.useQuery(
    {
      pdno: pdno ?? '000000',
      ...(options.includeSold ? { includeSold: true } : {}),
    },
    { enabled: pdno !== null },
  );

  return {
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    lines: query.data?.lines ?? [],
  };
}
