import type {
  CrosshairSettings,
  DisplaySettings,
  LineStyleType,
  MaPeriod,
  MaSettings,
} from '@renderer/entities/display-settings';
import {
  MA_PERIODS,
  useGetDisplaySettings,
  useResetDisplaySettings,
  useUpdateDisplaySettings,
} from '@renderer/entities/display-settings';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

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
  const [localCrosshair, setLocalCrosshair] = useState<Partial<CrosshairSettings> | null>(null);
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

  const resolvedCrosshair: CrosshairSettings = {
    mode: localCrosshair?.mode ?? settings?.chart.crosshair.mode ?? 'Magnet',
    labelVisible: localCrosshair?.labelVisible ?? settings?.chart.crosshair.labelVisible ?? true,
  };

  const resolvedRowHeight: number = localRowHeight ?? settings?.grid.rowHeightPx ?? 26;

  function serverMa(period: MaPeriod): MaSettings {
    const server = settings?.chart.ma[period];
    return {
      enabled: server?.enabled ?? period <= 20,
      color: server?.color ?? '#888888',
      width: server?.width ?? 1,
      style: server?.style ?? 'solid',
    };
  }

  function buildMaPayload(resolve: (period: MaPeriod) => MaSettings): Record<MaPeriod, MaSettings> {
    return Object.fromEntries(MA_PERIODS.map((period) => [period, resolve(period)])) as Record<
      MaPeriod,
      MaSettings
    >;
  }

  const isChartDirty =
    JSON.stringify({
      ma: buildMaPayload(resolvedMa),
      volume: resolvedVolume,
      crosshair: resolvedCrosshair,
    }) !==
    JSON.stringify({
      ma: buildMaPayload(serverMa),
      volume: {
        upColor: settings?.chart.volume.upColor ?? 'rgba(220,38,38,0.5)',
        downColor: settings?.chart.volume.downColor ?? 'rgba(37,99,235,0.5)',
        heightPercent: settings?.chart.volume.heightPercent ?? 30,
      },
      crosshair: {
        mode: settings?.chart.crosshair.mode ?? 'Magnet',
        labelVisible: settings?.chart.crosshair.labelVisible ?? true,
      },
    });

  const isGridDirty = resolvedRowHeight !== (settings?.grid.rowHeightPx ?? 26);

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

  function setCrosshairField<K extends keyof CrosshairSettings>(
    field: K,
    value: CrosshairSettings[K],
  ): void {
    setLocalCrosshair((prev) => ({ ...(prev ?? {}), [field]: value }));
  }

  function setRowHeight(px: number): void {
    setLocalRowHeight(px);
  }

  // ── save / reset ─────────────────────────────────────────────────

  function handleSave(): void {
    startTransition(() => {
      const maPayload = buildMaPayload(resolvedMa);

      mutateAsync({
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
          crosshair: resolvedCrosshair,
        },
        grid: { rowHeightPx: resolvedRowHeight },
      }).then(
        () => {
          setLocalMa(null);
          setLocalVolume(null);
          setLocalCrosshair(null);
          setLocalRowHeight(null);
          toast.success('표시 설정이 저장되었습니다');
        },
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : '알 수 없는 오류';
          toast.error(`표시 설정 저장 실패: ${msg}`);
        },
      );
    });
  }

  function handleReset(): void {
    startTransition(() => {
      reset.mutateAsync().then(
        () => {
          toast.success('표시 설정이 초기화되었습니다');
        },
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : '알 수 없는 오류';
          toast.error(`표시 설정 초기화 실패: ${msg}`);
        },
      );
      setLocalMa(null);
      setLocalVolume(null);
      setLocalCrosshair(null);
      setLocalRowHeight(null);
    });
  }

  return {
    isPending,
    error,
    isSaving,
    isChartDirty,
    isGridDirty,
    resolvedMa,
    resolvedVolume,
    resolvedCrosshair,
    resolvedRowHeight,
    setMaField,
    setVolumeField,
    setCrosshairField,
    setRowHeight,
    handleSave,
    handleReset,
  };
}
