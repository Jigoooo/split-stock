/**
 * Broker 레이어 공통 Result/Promise 타입.
 *
 * neverthrow 의 Result/ok/err 를 그대로 재export. 추후 broker-specific
 * helper 가 필요해지면 이 파일에 추가한다.
 */

export { err, errAsync, ok, okAsync, type Result, type ResultAsync } from 'neverthrow';
