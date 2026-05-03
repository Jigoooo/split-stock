/**
 * lightweight-charts 가 chart.remove() 후에도 내부 ResizeObserver / raf 콜백이
 * 한 tick 더 fire 되며 "Object is disposed" 를 던지는 알려진 race 를
 * console 에서 무음 처리. 다른 에러는 그대로 통과.
 *
 * trigger: 계좌/마켓 빠른 전환, 차트 panel unmount 직후
 * stack 특징: DevicePixelContentBoxBinding.get / TimeAxisWidget._internal_setSizes /
 *            ChartWidget._private__adjustSizeImpl
 *
 * 영향: 기능엔 영향 없음 (이미 dispose 됐으므로) — UI 노이즈만 발생.
 */
const SUPPRESSED_MESSAGE = 'Object is disposed';
const SUPPRESSED_STACK_HINT = 'lightweight-charts';

export function installChartDisposalErrorFilter(): void {
  const handle = (event: ErrorEvent | PromiseRejectionEvent): void => {
    const error =
      event instanceof ErrorEvent ? event.error : (event as PromiseRejectionEvent).reason;
    if (!(error instanceof Error)) return;
    if (error.message !== SUPPRESSED_MESSAGE) return;
    if (!(error.stack ?? '').includes(SUPPRESSED_STACK_HINT)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener('error', handle as EventListener, { capture: true });
  window.addEventListener('unhandledrejection', handle as EventListener, { capture: true });
}
