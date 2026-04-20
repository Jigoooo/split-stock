import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useEffect } from 'react';

type Division = 'LIMIT' | 'MARKET';
type Side = 'BUY' | 'SELL';

export interface OrderConfirmDialogProps {
  open: boolean;
  isProd: boolean;
  pdno: string;
  name: string;
  side: Side;
  qty: number;
  price: number;
  division: Division;
  nextNth?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 주문 실행 직전 단일 모달 확인 다이얼로그.
 * - PROD 환경: 빨간 '⚠ 실전' 배지 강조
 * - 체크박스 / 타이핑 / 카운트다운 없음 — 마찰 최소화
 * - ESC 또는 오버레이 바깥 클릭 = 취소
 */
export const OrderConfirmDialog = (props: OrderConfirmDialogProps): ReactElement | null => {
  const { open, isProd, pdno, name, side, qty, price, division, nextNth, onConfirm, onCancel } =
    props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const sideLabel = side === 'BUY' ? '매수' : '매도';
  const divisionLabel = division === 'MARKET' ? '시장가' : '지정가';

  return (
    <div className="modal-overlay">
      <div
        className="modal order-confirm-dialog panel"
        role="dialog"
        aria-modal="true"
        aria-label="주문 확인"
      >
        <div className="panel__title order-confirm-dialog__title">
          <span>주문 확인</span>
          {isProd ? (
            <span className="env-badge env-badge--prod">⚠ 실전</span>
          ) : (
            <span className="chip">모의</span>
          )}
        </div>
        <div className="panel__body">
          <dl className="order-confirm-dialog__summary">
            <dt>종목</dt>
            <dd>
              <span className="num">{pdno}</span> {name}
            </dd>
            <dt>구분</dt>
            <dd>
              <span className={side === 'BUY' ? 'num-up' : 'num-down'}>{sideLabel}</span> ·{' '}
              {divisionLabel}
              {nextNth !== undefined && side === 'BUY' ? (
                <>
                  {' · '}
                  <span className="chip">{nextNth}차</span>
                </>
              ) : null}
            </dd>
            <dt>수량</dt>
            <dd className="num">{thousandSeparator(qty)}주</dd>
            <dt>가격</dt>
            <dd className="num">
              {division === 'MARKET' ? '시장가' : `${thousandSeparator(price)}원`}
            </dd>
          </dl>
          {isProd ? (
            <p className="order-confirm-dialog__warning muted">
              실전 계좌로 실제 주문이 체결됩니다. 종목·수량·가격을 다시 확인하세요.
            </p>
          ) : null}
        </div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}
        >
          <Button onClick={onCancel} dense>
            취소
          </Button>
          <Button
            onClick={onConfirm}
            variant={isProd ? 'danger' : 'primary'}
            dense
            autoFocus
            aria-label={`${sideLabel} 주문 확정`}
          >
            {sideLabel} 확정
          </Button>
        </div>
      </div>
    </div>
  );
};
