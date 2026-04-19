import { usePendingCancelActive } from '@renderer/entities/pending-cancel';
import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

const SIDE_LABEL: Record<'BUY' | 'SELL', string> = {
  BUY: '매수',
  SELL: '매도',
};

export const ActivePendingList = (): ReactElement => {
  const { isPending, error, items, refetch } = usePendingCancelActive();
  const utils = trpc.useUtils();

  const unregister = trpc.pendingCancel.unregister.useMutation({
    onSuccess: () => {
      void utils.pendingCancel.listActive.invalidate();
      refetch();
    },
  });

  if (isPending) {
    return (
      <div className="panel">
        <div className="panel__body muted">감시 목록 로드 중…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <div className="panel__body">
          <span className="chip chip--down">{error.message}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__title">감시 중인 미체결 주문</div>
      <div className="panel__body">
        {items.length === 0 ? (
          <span className="muted">감시 중인 미체결 주문이 없습니다.</span>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.2rem' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '0.3rem 0.6rem' }}>종목</th>
                <th style={{ padding: '0.3rem 0.6rem' }}>구분</th>
                <th style={{ padding: '0.3rem 0.6rem' }}>차수</th>
                <th style={{ padding: '0.3rem 0.6rem' }}>주문번호</th>
                <th style={{ padding: '0.3rem 0.6rem' }}>시도</th>
                <th style={{ padding: '0.3rem 0.6rem' }} />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.pdno}:${item.side}:${item.nth}`}>
                  <td style={{ padding: '0.3rem 0.6rem' }}>{item.pdno}</td>
                  <td style={{ padding: '0.3rem 0.6rem' }}>
                    <span className={item.side === 'BUY' ? 'chip chip--up' : 'chip chip--down'}>
                      {SIDE_LABEL[item.side]}
                    </span>
                  </td>
                  <td style={{ padding: '0.3rem 0.6rem' }}>{item.nth}차</td>
                  <td style={{ padding: '0.3rem 0.6rem', fontFamily: 'monospace' }}>{item.odno}</td>
                  <td style={{ padding: '0.3rem 0.6rem' }}>{item.attempts}회</td>
                  <td style={{ padding: '0.3rem 0.6rem' }}>
                    <Button
                      dense
                      variant="danger"
                      disabled={unregister.isPending}
                      onClick={() => {
                        if (item.accountId !== undefined) {
                          unregister.mutate({
                            pdno: item.pdno,
                            side: item.side,
                            nth: item.nth,
                            accountId: item.accountId,
                          });
                        }
                      }}
                    >
                      해제
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
