import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { DrawingPoint } from './drawing-types';

/**
 * 드로잉 전용 커스텀 primitive 모음.
 *
 * - 공통 색 토큰(매수=빨강, 그 외 중립 채색) 을 HTS 스타일에 맞춰 채택.
 * - Canvas2D 직접 호출로 렌더 — GPU surface 를 추가로 할당하지 않는다.
 * - 외부 라이브러리 대신 직접 구현한 이유는 종전 플러그인(difurious/*) 이
 *   chart detach 시 내부 GPU 리소스를 반납하지 않아 Electron IOSurface 고갈을
 *   초래했기 때문. 자체 구현은 chart/series 에 참조를 들지 않으므로 chart.remove
 *   시 자연스럽게 GC 된다.
 */

const STROKE = '#1f2937';
const FILL = 'rgba(37, 99, 235, 0.12)';
const SELECTED_STROKE = '#d97706';

interface PrimitiveHost {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
}

abstract class BaseSeriesPrimitive implements ISeriesPrimitive<Time> {
  protected host: PrimitiveHost | null = null;

  attached(param: SeriesAttachedParameter<Time>): void {
    this.host = {
      chart: param.chart as unknown as IChartApi,
      series: param.series as unknown as ISeriesApi<'Candlestick'>,
    };
  }

  detached(): void {
    this.host = null;
  }

  updateAllViews(): void {
    // paneViews 는 매 프레임 새로 계산해 반환하므로 상태 업데이트 불필요.
  }

  abstract paneViews(): readonly IPrimitivePaneView[];
}

/**
 * 두 점을 잇는 대각선(추세선).
 */
export class TrendLinePrimitive extends BaseSeriesPrimitive {
  public selected = false;
  constructor(
    private readonly p1: DrawingPoint,
    private readonly p2: DrawingPoint,
  ) {
    super();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const host = this.host;
    if (!host) return [];
    const { chart, series } = host;
    const x1 = chart.timeScale().timeToCoordinate(this.p1.time as Time);
    const x2 = chart.timeScale().timeToCoordinate(this.p2.time as Time);
    const y1 = series.priceToCoordinate(this.p1.price);
    const y2 = series.priceToCoordinate(this.p2.price);
    const selected = this.selected;
    return [
      {
        renderer: (): IPrimitivePaneRenderer => ({
          draw: (target) => {
            if (x1 === null || x2 === null || y1 === null || y2 === null) return;
            // biome-ignore lint/correctness/useHookAtTopLevel: canvas API, not a React hook
            target.useBitmapCoordinateSpace(
              ({ context: ctx, horizontalPixelRatio: hpx, verticalPixelRatio: vpx }) => {
                ctx.lineWidth = Math.max(1, Math.round(1.5 * vpx));
                ctx.strokeStyle = selected ? SELECTED_STROKE : STROKE;
                ctx.beginPath();
                ctx.moveTo(x1 * hpx, y1 * vpx);
                ctx.lineTo(x2 * hpx, y2 * vpx);
                ctx.stroke();
              },
            );
          },
        }),
      },
    ];
  }
}

/**
 * 두 점을 대각 꼭짓점으로 하는 직사각형.
 */
export class RectanglePrimitive extends BaseSeriesPrimitive {
  public selected = false;
  constructor(
    private readonly p1: DrawingPoint,
    private readonly p2: DrawingPoint,
  ) {
    super();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const host = this.host;
    if (!host) return [];
    const { chart, series } = host;
    const x1 = chart.timeScale().timeToCoordinate(this.p1.time as Time);
    const x2 = chart.timeScale().timeToCoordinate(this.p2.time as Time);
    const y1 = series.priceToCoordinate(this.p1.price);
    const y2 = series.priceToCoordinate(this.p2.price);
    const selected = this.selected;
    return [
      {
        renderer: (): IPrimitivePaneRenderer => ({
          draw: (target) => {
            if (x1 === null || x2 === null || y1 === null || y2 === null) return;
            // biome-ignore lint/correctness/useHookAtTopLevel: canvas API, not a React hook
            target.useBitmapCoordinateSpace(
              ({ context: ctx, horizontalPixelRatio: hpx, verticalPixelRatio: vpx }) => {
                const left = Math.min(x1, x2) * hpx;
                const right = Math.max(x1, x2) * hpx;
                const top = Math.min(y1, y2) * vpx;
                const bottom = Math.max(y1, y2) * vpx;
                ctx.fillStyle = FILL;
                ctx.fillRect(left, top, right - left, bottom - top);
                ctx.lineWidth = Math.max(1, Math.round(1.5 * vpx));
                ctx.strokeStyle = selected ? SELECTED_STROKE : STROKE;
                ctx.strokeRect(left, top, right - left, bottom - top);
              },
            );
          },
        }),
      },
    ];
  }
}

/**
 * 단일 시간(바)에 걸리는 세로선 — pane 전체 높이.
 * IPanePrimitive 가 아닌 ISeriesPrimitive 로 구현: candlestick series 에 attach 하면
 * main pane 영역에 paneView 가 렌더되고, 축 밖으로 나가는 좌표는 자동으로 clip 된다.
 */
export class VerticalLinePrimitive extends BaseSeriesPrimitive {
  public selected = false;
  constructor(private readonly time: string) {
    super();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const host = this.host;
    if (!host) return [];
    const { chart } = host;
    const x = chart.timeScale().timeToCoordinate(this.time as Time);
    const selected = this.selected;
    return [
      {
        renderer: (): IPrimitivePaneRenderer => ({
          draw: (target) => {
            if (x === null) return;
            // biome-ignore lint/correctness/useHookAtTopLevel: canvas API, not a React hook
            target.useBitmapCoordinateSpace(
              ({
                context: ctx,
                horizontalPixelRatio: hpx,
                verticalPixelRatio: vpx,
                mediaSize: { height },
              }) => {
                ctx.lineWidth = Math.max(1, Math.round(1.5 * vpx));
                ctx.strokeStyle = selected ? SELECTED_STROKE : STROKE;
                ctx.setLineDash([Math.round(3 * vpx), Math.round(3 * vpx)]);
                ctx.beginPath();
                ctx.moveTo(x * hpx, 0);
                ctx.lineTo(x * hpx, height * vpx);
                ctx.stroke();
                ctx.setLineDash([]);
              },
            );
          },
        }),
      },
    ];
  }
}
