import type { KisError } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import { KIS_PATH } from './endpoints';
import { makeKisError } from './errors';
import type { KisHttpClient } from './http-client';

const KisApprovalResponseSchema = z.object({
  approval_key: z.string().min(1),
});

export async function issueApprovalKey(
  http: KisHttpClient,
  appKey: string,
  appSecret: string,
): Promise<Result<string, KisError>> {
  const r = await http.post<unknown>(KIS_PATH.APPROVAL_KEY, {
    grant_type: 'client_credentials',
    appkey: appKey,
    secretkey: appSecret,
  });
  if (r.isErr()) return err(r.error);
  const parsed = KisApprovalResponseSchema.safeParse(r.value.body);
  if (!parsed.success) {
    return err(
      makeKisError('VALIDATION', 'approval 응답 파싱 실패', {
        cause: parsed.error.message,
      }),
    );
  }
  return ok(parsed.data.approval_key);
}
