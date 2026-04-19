import type {
  DisplaySettings,
  LineStyleType,
  MaPeriod,
  MaSettings,
} from '@renderer/entities/display-settings';
import {
  useGetDisplaySettings,
  useResetDisplaySettings,
  useUpdateDisplaySettings,
} from '@renderer/entities/display-settings';
import { useState, useTransition } from 'react';

/**
 * 차트/그리드 표시 설정 폼 상태 관리.
 * - 로컬 편집 상태를 서버 데이터와 분리
 * - 저장 성공 시 로컬 상태 초기화
 * - useEffect 내 setState 없음 (React 19 준수)
 */
export function useDisplaySettings() {
  const { isPending, error, settings } = useGetDisplaySettings();
  const { mutateAsync, isPending: isMutating } = useUpdateDisplaySettings();
  const reset = useResetDisplaySettings();

  // 로컬 편집 상태 (null = 서버값 사용)
  const [localMa, setLocalMa] = useState<Partial<Record<MaPeriod, Partial<MaSettings>>> | null>(
    null,
  );
  const [localVolume, setLocalVolume] = useState<Partial<
    DisplaySettings['chart']['volume']
  > | null>(null);
  const [localRowHeight, setLocalRowHeight] = useState<number | null>(null);

  const [isPendingTrans, startTransition] = useTransition();

  const isSaving = isPendingTrans || isMutating;

  // ── resolved values (local override 우선) ────────────────────────

  function resolvedMa(period: MaPeriod): MaSettings {
    const server = settings?.chart.ma[period];
    const local = localMa?.[period];
    return {
      enabled: local?.enabled ?? server?.enabled ?? period <= 20,
      color: local?.color ?? server?.color ?? '#888888',
      width: local?.width ?? server?.width ?? 1,
      style: local?.style ?? server?.style ?? 'solid',
    };
  }

  const resolvedVolume: DisplaySettings['chart']['volume'] = {
    upColor: localVolume?.upColor ?? settings?.chart.volume.upColor ?? 'rgba(220,38,38,0.5)',
    downColor: localVolume?.downColor ?? settings?.chart.volume.downColor ?? 'rgba(37,99,235,0.5)',
    heightPercent: localVolume?.heightPercent ?? settings?.chart.volume.heightPercent ?? 30,
  };

  const resolvedRowHeight: number = localRowHeight ?? settings?.grid.rowHeightPx ?? 26;

  // ── setters ──────────────────────────────────────────────────────

  function setMaField<K extends keyof MaSettings>(
    period: MaPeriod,
    field: K,
    value: MaSettings[K],
  ): void {
    setLocalMa((prev) => ({
      ...prev,
      [period]: { ...(prev?.[period] ?? {}), [field]: value },
    }));
  }

  function setVolumeField<K extends keyof DisplaySettings['chart']['volume']>(
    field: K,
    value: DisplaySettings['chart']['volume'][K],
  ): void {
    setLocalVolume((prev) => ({ ...(prev ?? {}), [field]: value }));
  }

  function setRowHeight(px: number): void {
    setLocalRowHeight(px);
  }

  // ── save / reset ─────────────────────────────────────────────────

  function handleSave(): void {
    startTransition(() => {
      const maPayload: Partial<Record<MaPeriod, MaSettings>> = {};
      for (const period of [5, 10, 20, 60, 120] as MaPeriod[]) {
        maPayload[period] = resolvedMa(period);
      }

      void mutateAsync({
        chart: {
          ma: maPayload as Record<
            5 | 10 | 20 | 60 | 120,
            {
              enabled: boolean;
              color: string;
              width: number;
              style: LineStyleType;
            }
          >,
          volume: resolvedVolume,
        },
        grid: { rowHeightPx: resolvedRowHeight },
      }).then(() => {
        setLocalMa(null);
        setLocalVolume(null);
        setLocalRowHeight(null);
      });
    });
  }

  function handleReset(): void {
    startTransition(() => {
      reset.mutate();
      setLocalMa(null);
      setLocalVolume(null);
      setLocalRowHeight(null);
    });
  }

  return {
    isPending,
    error,
    isSaving,
    resolvedMa,
    resolvedVolume,
    resolvedRowHeight,
    setMaField,
    setVolumeField,
    setRowHeight,
    handleSave,
    handleReset,
  };
}
