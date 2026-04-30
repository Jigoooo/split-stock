import type { AppEnv, KisError, NormalizedOrderAck } from '@shared/contracts';
import {
  KisCommonHeaderSchema,
  KisOrderAmendRequestSchema,
  KisOrderRequestSchema,
  KisOrderResponseSchema,
} from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type { EventLogger } from '../logging/event-logger';
import { hashIdentifier } from '../logging/event-logger';
import { KIS_PATH, trId } from './endpoints';
import { interpretRtCd, makeKisError } from './errors';
import type { KisHttpClient } from './http-client';
import {
  divisionCode,
  getRateLimitRetryDelayMs,
  orderAuthHeaders,
  priceString,
  shouldRetryRateLimitedOrder,
  sleep,
} from './order-helpers';

export interface OrderDeps {
  http: KisHttpClient;
  env: AppEnv;
  token: string;
  appKey: string;
  appSecret: string;
  accountNo8: string;
  accountProdCd: string;
  logger: EventLogger;
  /** 테스트 단축 및 mock rolling-window 대응용 rate limit 재시도 대기(ms). */
  rateLimitRetryDelayMs?: number;
}

export interface OrderCashParams {
  side: 'BUY' | 'SELL';
  pdno: string; // 종목코드 6자리
  qty: number; // 주문수량
  price: number; // 지정가 (시장가는 0)
  division: 'LIMIT' | 'MARKET';
}

export interface OrderAmendParams {
  action: 'cancel' | 'revise';
  orgOrgNo: string; // 원주문 조직번호 (KRX_FWDG_ORD_ORGNO)
  orgOdno: string; // 원주문번호
  division: 'LIMIT' | 'MARKET'; // 정정 시 재지정
  qty: number;
  price: number; // 취소/시장가는 0
  qtyAllOrder?: boolean;
}

/**
 * 현금 매수/매도 — POST /uapi/domestic-stock/v1/trading/order-cash.
 *
 * tr_id:
 *   BUY:  실전 TTTC0012U / 모의 VTTC0012U
 *   SELL: 실전 TTTC0011U / 모의 VTTC0011U
 *
 * ORD_DVSN: '00' 지정가 / '01' 시장가. 시장가는 ORD_UNPR='0'.
 */
export async function orderCash(
  deps: OrderDeps,
  params: OrderCashParams,
): Promise<Result<NormalizedOrderAck, KisError>> {
  const parsed = KisOrderRequestSchema.safeParse(params);
  if (!parsed.success) {
    return err(
      makeKisError('VALIDATION', '주문 요청 입력이 유효하지 않습니다', {
        cause: parsed.error.message,
      }),
    );
  }
  const req = parsed.data;
  if (req.division === 'LIMIT' && req.price <= 0) {
    return err(makeKisError('VALIDATION', '지정가 주문에는 price > 0 필요'));
  }

  const tr = trId(req.side === 'BUY' ? 'BUY_CASH' : 'SELL_CASH', deps.env);
  const headers = orderAuthHeaders(deps, tr);
  const body: Record<string, string> = {
    CANO: deps.accountNo8,
    ACNT_PRDT_CD: deps.accountProdCd,
    PDNO: req.pdno,
    EXCG_ID_DVSN_CD: 'KRX',
    ORD_DVSN: divisionCode(req.division),
    ORD_QTY: String(req.qty),
    ORD_UNPR: priceString(req.price, req.division),
  };

  deps.logger.log({
    level: 'INFO',
    category: 'ORDER',
    message: `order.cash.request ${req.side}`,
    payload: {
      env: deps.env,
      tr_id: tr,
      side: req.side,
      pdno: req.pdno,
      qty: req.qty,
      price: req.price,
      division: req.division,
      accountHash: hashIdentifier(`${deps.accountNo8}-${deps.accountProdCd}`),
    },
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await deps.http.post<unknown>(KIS_PATH.ORDER_CASH, body, headers);
    if (res.isErr()) {
      if (attempt === 0 && res.error.kind === 'RATE_LIMITED' && shouldRetryRateLimitedOrder(deps)) {
        const retryDelayMs = getRateLimitRetryDelayMs(deps);
        deps.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'order.cash.rate_limited_retry',
          payload: { pdno: req.pdno, retryDelayMs },
        });
        await sleep(retryDelayMs);
        continue;
      }

      deps.logger.log({
        level: 'ERROR',
        category: 'ORDER',
        message: 'order.cash.network_error',
        payload: { kind: res.error.kind, msg: res.error.msg, pdno: req.pdno },
      });
      return err(res.error);
    }

    const parsedHeader = KisCommonHeaderSchema.safeParse(res.value.body);
    if (!parsedHeader.success) {
      deps.logger.log({
        level: 'ERROR',
        category: 'ORDER',
        message: 'order.cash.response_malformed',
        payload: { pdno: req.pdno },
      });
      return err(
        makeKisError('VALIDATION', 'order-cash 응답 파싱 실패', {
          cause: parsedHeader.error.message,
        }),
      );
    }

    const bizErr = interpretRtCd(
      parsedHeader.data.rt_cd,
      parsedHeader.data.msg_cd,
      parsedHeader.data.msg1,
    );
    if (bizErr) {
      if (attempt === 0 && bizErr.kind === 'RATE_LIMITED' && shouldRetryRateLimitedOrder(deps)) {
        const retryDelayMs = getRateLimitRetryDelayMs(deps);
        deps.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'order.cash.rate_limited_retry',
          payload: { pdno: req.pdno, retryDelayMs },
        });
        await sleep(retryDelayMs);
        continue;
      }

      deps.logger.log({
        level: 'WARN',
        category: 'ORDER',
        message: 'order.cash.business_error',
        payload: {
          kind: bizErr.kind,
          rt_cd: bizErr.rt_cd,
          msg_cd: bizErr.msg_cd,
          msg: bizErr.msg,
          pdno: req.pdno,
        },
      });
      return err(bizErr);
    }

    const parsedRes = KisOrderResponseSchema.safeParse(res.value.body);
    if (!parsedRes.success) {
      deps.logger.log({
        level: 'ERROR',
        category: 'ORDER',
        message: 'order.cash.response_malformed',
        payload: { pdno: req.pdno },
      });
      return err(
        makeKisError('VALIDATION', 'order-cash 응답 파싱 실패', {
          cause: parsedRes.error.message,
        }),
      );
    }

    const ack: NormalizedOrderAck = {
      odno: parsedRes.data.output.ODNO,
      ...(parsedRes.data.output.KRX_FWDG_ORD_ORGNO !== undefined && {
        orgNo: parsedRes.data.output.KRX_FWDG_ORD_ORGNO,
      }),
      ...(parsedRes.data.output.ORD_TMD !== undefined && {
        orderedAt: parsedRes.data.output.ORD_TMD,
      }),
    };

    deps.logger.log({
      level: 'INFO',
      category: 'ORDER',
      message: 'order.cash.accepted',
      payload: {
        odnoHash: hashIdentifier(ack.odno),
        orgNo: ack.orgNo ?? null,
        pdno: req.pdno,
      },
    });

    return ok(ack);
  }

  return err(makeKisError('RATE_LIMITED', '주문 재시도 한도를 초과했습니다'));
}

/**
 * 주문 정정/취소 — POST /uapi/domestic-stock/v1/trading/order-rvsecncl.
 * tr_id: TTTC0013U(실전) / VTTC0013U(모의) — 매수/매도 공용.
 */
export async function cancelOrRevise(
  deps: OrderDeps,
  params: OrderAmendParams,
): Promise<Result<NormalizedOrderAck, KisError>> {
  const parsed = KisOrderAmendRequestSchema.safeParse({
    action: params.action,
    orgOrgNo: params.orgOrgNo,
    orgOdno: params.orgOdno,
    division: params.division,
    qty: params.qty,
    price: params.price,
    qtyAllOrder: params.qtyAllOrder ?? false,
  });
  if (!parsed.success) {
    return err(
      makeKisError('VALIDATION', '정정/취소 요청 입력이 유효하지 않습니다', {
        cause: parsed.error.message,
      }),
    );
  }
  const req = parsed.data;
  if (req.action === 'revise' && req.division === 'LIMIT' && req.price <= 0) {
    return err(makeKisError('VALIDATION', '지정가 정정에는 price > 0 필요'));
  }

  const tr = trId('CANCEL_REVISE', deps.env);
  const headers = orderAuthHeaders(deps, tr);
  const body: Record<string, string> = {
    CANO: deps.accountNo8,
    ACNT_PRDT_CD: deps.accountProdCd,
    KRX_FWDG_ORD_ORGNO: req.orgOrgNo,
    ORGN_ODNO: req.orgOdno,
    ORD_DVSN: divisionCode(req.division),
    RVSE_CNCL_DVSN_CD: req.action === 'cancel' ? '02' : '01',
    ORD_QTY: String(req.qty),
    ORD_UNPR: req.action === 'cancel' ? '0' : priceString(req.price, req.division),
    QTY_ALL_ORD_YN: req.qtyAllOrder ? 'Y' : 'N',
  };

  deps.logger.log({
    level: 'INFO',
    category: 'ORDER',
    message: `order.amend.request ${req.action}`,
    payload: {
      env: deps.env,
      tr_id: tr,
      action: req.action,
      orgOdnoHash: hashIdentifier(req.orgOdno),
      qty: req.qty,
      price: req.price,
      division: req.division,
      qtyAllOrder: req.qtyAllOrder,
    },
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await deps.http.post<unknown>(KIS_PATH.ORDER_CANCEL_REVISE, body, headers);
    if (res.isErr()) {
      if (attempt === 0 && res.error.kind === 'RATE_LIMITED' && shouldRetryRateLimitedOrder(deps)) {
        const retryDelayMs = getRateLimitRetryDelayMs(deps);
        deps.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'order.amend.rate_limited_retry',
          payload: { action: req.action, retryDelayMs },
        });
        await sleep(retryDelayMs);
        continue;
      }

      deps.logger.log({
        level: 'ERROR',
        category: 'ORDER',
        message: 'order.amend.network_error',
        payload: { kind: res.error.kind, action: req.action },
      });
      return err(res.error);
    }

    const parsedHeader = KisCommonHeaderSchema.safeParse(res.value.body);
    if (!parsedHeader.success) {
      deps.logger.log({
        level: 'ERROR',
        category: 'ORDER',
        message: 'order.amend.response_malformed',
        payload: { action: req.action },
      });
      return err(
        makeKisError('VALIDATION', 'order-rvsecncl 응답 파싱 실패', {
          cause: parsedHeader.error.message,
        }),
      );
    }

    const bizErr = interpretRtCd(
      parsedHeader.data.rt_cd,
      parsedHeader.data.msg_cd,
      parsedHeader.data.msg1,
    );
    if (bizErr) {
      if (attempt === 0 && bizErr.kind === 'RATE_LIMITED' && shouldRetryRateLimitedOrder(deps)) {
        const retryDelayMs = getRateLimitRetryDelayMs(deps);
        deps.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'order.amend.rate_limited_retry',
          payload: { action: req.action, retryDelayMs },
        });
        await sleep(retryDelayMs);
        continue;
      }

      deps.logger.log({
        level: 'WARN',
        category: 'ORDER',
        message: 'order.amend.business_error',
        payload: {
          kind: bizErr.kind,
          rt_cd: bizErr.rt_cd,
          msg_cd: bizErr.msg_cd,
          msg: bizErr.msg,
          action: req.action,
        },
      });
      return err(bizErr);
    }

    const parsedRes = KisOrderResponseSchema.safeParse(res.value.body);
    if (!parsedRes.success) {
      deps.logger.log({
        level: 'ERROR',
        category: 'ORDER',
        message: 'order.amend.response_malformed',
        payload: { action: req.action },
      });
      return err(
        makeKisError('VALIDATION', 'order-rvsecncl 응답 파싱 실패', {
          cause: parsedRes.error.message,
        }),
      );
    }

    const ack: NormalizedOrderAck = {
      odno: parsedRes.data.output.ODNO,
      ...(parsedRes.data.output.KRX_FWDG_ORD_ORGNO !== undefined && {
        orgNo: parsedRes.data.output.KRX_FWDG_ORD_ORGNO,
      }),
      ...(parsedRes.data.output.ORD_TMD !== undefined && {
        orderedAt: parsedRes.data.output.ORD_TMD,
      }),
    };

    deps.logger.log({
      level: 'INFO',
      category: 'ORDER',
      message: 'order.amend.accepted',
      payload: {
        action: req.action,
        odnoHash: hashIdentifier(ack.odno),
        orgNo: ack.orgNo ?? null,
      },
    });

    return ok(ack);
  }

  return err(makeKisError('RATE_LIMITED', '주문 정정/취소 재시도 한도를 초과했습니다'));
}
