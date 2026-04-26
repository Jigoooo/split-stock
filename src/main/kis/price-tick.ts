/**
 * @deprecated Stage 0 이후로 `@shared/market-rules`에서 import 하세요.
 *
 * KRX 호가 단위는 broker-agnostic 거래소 규칙이므로 KIS 디렉터리에 두지 않습니다.
 * 이 파일은 호환성 유지를 위한 re-export 입니다. Stage 7 cleanup에서 삭제됩니다.
 */
export { getTickSize, isOnTick, roundToTick } from '@shared/market-rules/price-tick';
