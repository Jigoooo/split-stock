import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { ILineToolsPlugin } from 'lightweight-charts-line-tools-core';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

export type DrawingToolKind = 'TrendLine' | 'HorizontalLine' | 'VerticalLine' | 'Rectangle';

export const DRAWING_TOOL_STORAGE_PREFIX = 'split-stock.chart.drawings.';

export const getDrawingToolStorageKey = (pdno: string): string =>
  `${DRAWING_TOOL_STORAGE_PREFIX}${pdno}`;

type DrawingRuntime = Pick<
  typeof import('lightweight-charts-line-tools-core'),
  'createLineToolsPlugin'
> &
  Pick<
    typeof import('lightweight-charts-line-tools-lines'),
    'LineToolHorizontalLine' | 'LineToolTrendLine' | 'LineToolVerticalLine'
  > &
  Pick<typeof import('lightweight-charts-line-tools-rectangle'), 'LineToolRectangle'>;

let drawingRuntimePromise: Promise<DrawingRuntime> | null = null;

const loadDrawingRuntime = (): Promise<DrawingRuntime> => {
  if (drawingRuntimePromise) return drawingRuntimePromise;
  drawingRuntimePromise = Promise.all([
    import('lightweight-charts-line-tools-core'),
    import('lightweight-charts-line-tools-lines'),
    import('lightweight-charts-line-tools-rectangle'),
  ]).then(([core, lines, rectangle]) => ({
    createLineToolsPlugin: core.createLineToolsPlugin,
    LineToolHorizontalLine: lines.LineToolHorizontalLine,
    LineToolRectangle: rectangle.LineToolRectangle,
    LineToolTrendLine: lines.LineToolTrendLine,
    LineToolVerticalLine: lines.LineToolVerticalLine,
  }));
  return drawingRuntimePromise;
};

const readPersistedDrawings = (pdno: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(getDrawingToolStorageKey(pdno));
  } catch {
    return null;
  }
};

export const persistDrawings = (pdno: string, serialized: string): void => {
  if (typeof window === 'undefined') return;
  try {
    if (!serialized || serialized === '[]') {
      window.localStorage.removeItem(getDrawingToolStorageKey(pdno));
      return;
    }
    window.localStorage.setItem(getDrawingToolStorageKey(pdno), serialized);
  } catch {
    // localStorage quota / privacy mode failures are non-fatal.
  }
};

export interface UseDrawingToolsResult {
  activeTool: DrawingToolKind | null;
  connectHost: (chart: IChartApi, series: ISeriesApi<'Candlestick'>) => void;
  disconnectHost: (persistCurrent?: boolean) => void;
  exportAll: () => string | null;
  exportSelected: () => string | null;
  isReady: boolean;
  /** 플러그인 native removeAllLineTools + localStorage '[]' 동기화. */
  removeAll: () => void;
  /** 플러그인 native removeSelectedLineTools + 남은 상태 영속화. */
  removeSelected: () => void;
  startDraw: (tool: DrawingToolKind) => void;
}

export function useDrawingTools(pdno: string): UseDrawingToolsResult {
  const pluginRef = useRef<ILineToolsPlugin | null>(null);
  const hostRef = useRef<{ chart: IChartApi; series: ISeriesApi<'Candlestick'> } | null>(null);
  const connectTokenRef = useRef(0);
  const connectingRef = useRef(false);
  const prevPdnoRef = useRef(pdno);
  const [activeTool, setActiveTool] = useState<DrawingToolKind | null>(null);
  const [isReady, setIsReady] = useState(false);

  const saveCurrentDrawings = useEffectEvent((targetPdno: string) => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    try {
      persistDrawings(targetPdno, plugin.exportLineTools());
    } catch {
      // third-party plugin export failure should not break the chart surface
    }
  });

  const restoreDrawings = useEffectEvent((targetPdno: string) => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    const saved = readPersistedDrawings(targetPdno);
    if (saved) {
      let imported = false;
      try {
        imported = plugin.importLineTools(saved);
      } catch {
        imported = false;
      }
      if (!imported) {
        persistDrawings(targetPdno, '[]');
      }
    }
    setActiveTool(null);
  });

  const handleAfterEdit = useEffectEvent(() => {
    saveCurrentDrawings(pdno);
    setActiveTool(null);
  });

  const connectHost = useEffectEvent((chart: IChartApi, series: ISeriesApi<'Candlestick'>) => {
    const currentHost = hostRef.current;
    if (currentHost?.chart === chart && currentHost.series === series) {
      if (pluginRef.current && !isReady) setIsReady(true);
      if (pluginRef.current || connectingRef.current) return;
    }

    const token = connectTokenRef.current + 1;
    connectTokenRef.current = token;
    connectingRef.current = true;
    hostRef.current = { chart, series };
    setIsReady(false);

    void loadDrawingRuntime()
      .then((runtime) => {
        if (connectTokenRef.current !== token) return;

        const activeHost = hostRef.current;
        if (!activeHost || activeHost.chart !== chart || activeHost.series !== series) {
          return;
        }

        const prevPlugin = pluginRef.current;
        if (prevPlugin) {
          prevPlugin.unsubscribeLineToolsAfterEdit(handleAfterEdit);
        }

        const plugin = runtime.createLineToolsPlugin(chart, series);
        plugin.registerLineTool('TrendLine', runtime.LineToolTrendLine);
        plugin.registerLineTool('HorizontalLine', runtime.LineToolHorizontalLine);
        plugin.registerLineTool('VerticalLine', runtime.LineToolVerticalLine);
        plugin.registerLineTool('Rectangle', runtime.LineToolRectangle);
        plugin.subscribeLineToolsAfterEdit(handleAfterEdit);

        pluginRef.current = plugin;
        prevPdnoRef.current = pdno;
        restoreDrawings(pdno);
        return;
      })
      .finally(() => {
        if (connectTokenRef.current === token) {
          connectingRef.current = false;
          setIsReady(pluginRef.current !== null);
        }
      });
  });

  const disconnectHost = useEffectEvent((persistCurrent = true) => {
    if (persistCurrent) {
      saveCurrentDrawings(prevPdnoRef.current);
    }
    connectTokenRef.current += 1;
    connectingRef.current = false;
    const plugin = pluginRef.current;
    if (plugin) {
      plugin.unsubscribeLineToolsAfterEdit(handleAfterEdit);
    }
    pluginRef.current = null;
    hostRef.current = null;
    setActiveTool(null);
    setIsReady(false);
  });

  useEffect(() => {
    return () => {
      disconnectHost();
    };
  }, []);

  const startDraw = (tool: DrawingToolKind): void => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    const toolId = plugin.addLineTool(tool, []);
    setActiveTool(toolId ? tool : null);
  };

  const exportAll = (): string | null => {
    const plugin = pluginRef.current;
    if (!plugin) return null;
    try {
      return plugin.exportLineTools();
    } catch {
      return null;
    }
  };

  const exportSelected = (): string | null => {
    const plugin = pluginRef.current;
    if (!plugin) return null;
    try {
      return plugin.getSelectedLineTools();
    } catch {
      return null;
    }
  };

  /**
   * 플러그인 자체 removeAllLineTools() 호출 — 차트 remount 없이 즉시 반영.
   * remount 방식으로는 Electron/Chromium 이 IOSurface 를 반복 할당하다 1x1 크기에서
   * 실패(GPU state invalid) 했던 이슈가 있어 반드시 native API 사용.
   */
  const removeAll = (): void => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    try {
      plugin.removeAllLineTools();
    } catch {
      // plugin 내부 에러는 UI 를 먹통으로 만들지 않도록 삼킨다.
    }
    persistDrawings(pdno, '[]');
    setActiveTool(null);
  };

  const removeSelected = (): void => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    try {
      plugin.removeSelectedLineTools();
      // afterEdit 구독이 있더라도 일부 케이스에서 안 뜨므로 방어적으로 직접 persist.
      persistDrawings(pdno, plugin.exportLineTools());
    } catch {
      // no-op
    }
    setActiveTool(null);
  };

  return {
    activeTool,
    connectHost,
    disconnectHost,
    exportAll,
    exportSelected,
    isReady,
    removeAll,
    removeSelected,
    startDraw,
  };
}
