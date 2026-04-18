import { err, ok, type Result } from 'neverthrow';
import type { EventLogger } from '../logging/event-logger';
import type { SafetyState } from '../safety/safety-state';
import type { LotsRepo, LotsRepoError } from './lots-repo';
import type { RespiitPlan } from './respiit-planner';

export interface ApplyRespiitInput {
  accountId: number;
  plan: RespiitPlan;
}

/**
 * 리스플리트 실행 래퍼 — LotsRepo.replan 트랜잭션 후 안전장치 + 이벤트 로그.
 *
 * 보안 불변식:
 * - 성공 직후 해당 종목 safety.toggleSymbol(false) — 새 차수 구조에 대한
 *   전략 파라미터 재검증을 사용자에게 강제 (자동매매 실수 방지)
 */
export function applyRespiit(
  deps: { lots: LotsRepo; safety: SafetyState; logger: EventLogger },
  input: ApplyRespiitInput,
): Result<{ insertedIds: number[] }, LotsRepoError> {
  const res = deps.lots.replan(input.accountId, input.plan);
  if (res.isErr()) {
    deps.logger.log({
      level: 'ERROR',
      category: 'FSM',
      message: 'respiit.failed',
      payload: {
        accountId: input.accountId,
        pdno: input.plan.pdno,
        cause: String(res.error.cause ?? ''),
      },
    });
    return err(res.error);
  }
  deps.safety.toggleSymbol(input.plan.pdno, false);
  deps.logger.log({
    level: 'WARN',
    category: 'FSM',
    message: 'respiit.applied',
    payload: {
      accountId: input.accountId,
      pdno: input.plan.pdno,
      stages: input.plan.entries.length,
      firstNth: input.plan.entries[0]?.nth ?? null,
      lastNth: input.plan.entries[input.plan.entries.length - 1]?.nth ?? null,
    },
  });
  return ok(res.value);
}
