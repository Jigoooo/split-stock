import { trpc } from '@renderer/shared/api/trpc';
import type { DisplaySettings } from '../model/types';

export interface UseGetDisplaySettingsResult {
  isPending: boolean;
  error: { message: string } | null;
  settings: DisplaySettings | null;
}

export interface UseUpdateDisplaySettingsResult {
  mutateAsync: (
    data: Partial<{
      chart: Partial<{
        ma: Partial<
          Record<
            5 | 10 | 20 | 60 | 120,
            {
              enabled: boolean;
              color: string;
              width: number;
              style: 'solid' | 'dashed' | 'dotted';
            }
          >
        >;
        volume: Partial<{
          upColor: string;
          downColor: string;
          heightPercent: number;
        }>;
      }>;
      grid: Partial<{ rowHeightPx: number }>;
    }>,
  ) => Promise<{ ok: true }>;
  isPending: boolean;
  error: { message: string } | null;
}

export interface UseResetDisplaySettingsResult {
  mutate: () => void;
  isPending: boolean;
  error: { message: string } | null;
}

/**
 * 표시 설정 조회.
 */
export function useGetDisplaySettings(): UseGetDisplaySettingsResult {
  const query = trpc.display.getSettings.useQuery();
  return {
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    settings: (query.data as DisplaySettings | undefined) ?? null,
  };
}

/**
 * 표시 설정 부분 업데이트 mutation.
 */
export function useUpdateDisplaySettings(): UseUpdateDisplaySettingsResult {
  const utils = trpc.useUtils();
  const mutation = trpc.display.updateSettings.useMutation({
    onSuccess: () => {
      void utils.display.getSettings.invalidate();
    },
  });
  return {
    mutateAsync: mutation.mutateAsync as UseUpdateDisplaySettingsResult['mutateAsync'],
    isPending: mutation.isPending,
    error: mutation.error ? { message: mutation.error.message } : null,
  };
}

/**
 * 표시 설정 초기화 mutation.
 */
export function useResetDisplaySettings(): UseResetDisplaySettingsResult {
  const utils = trpc.useUtils();
  const mutation = trpc.display.resetSettings.useMutation({
    onSuccess: () => {
      void utils.display.getSettings.invalidate();
    },
  });
  return {
    mutate: mutation.mutate,
    isPending: mutation.isPending,
    error: mutation.error ? { message: mutation.error.message } : null,
  };
}
