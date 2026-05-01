import { usePendingCancelActive } from '@renderer/entities/pending-cancel';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, EmptyState, TableGrid } from '@renderer/shared/ui';
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
        <div className="panel__body">
          <EmptyState dense title="감시 목록 로드 중…" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <div className="panel__body">
          <EmptyState dense role="alert" title="감시 목록 조회 실패" description={error.message} />
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__title">감시 중인 미체결 주문</div>
      <div className="panel__body">
        {items.length === 0 ? (
          <EmptyState dense title="감시 중인 미체결 주문이 없습니다" />
        ) : (
          <TableGrid.Root
            variant="hts"
            horizontalScroll
            overlayScrollbar={false}
            aria-label="감시 중인 미체결 주문"
            style={{ height: 'auto' }}
          >
            <TableGrid.Header>
              <TableGrid.Cell width="9rem">종목</TableGrid.Cell>
              <TableGrid.Cell width="8rem">구분</TableGrid.Cell>
              <TableGrid.Cell width="7rem" numeric>
                차수
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} minWidth="12rem">
                주문번호
              </TableGrid.Cell>
              <TableGrid.Cell width="7rem" numeric>
                시도
              </TableGrid.Cell>
              <TableGrid.Cell width="7.2rem" align="right" resizable={false}>
                액션
              </TableGrid.Cell>
            </TableGrid.Header>
            <TableGrid.Body>
              {items.map((item) => (
                <TableGrid.Row key={`${item.pdno}:${item.side}:${item.nth}`}>
                  <TableGrid.Cell width="9rem" numeric>
                    {item.pdno}
                  </TableGrid.Cell>
                  <TableGrid.Cell width="8rem">
                    <span className={item.side === 'BUY' ? 'chip chip--up' : 'chip chip--down'}>
                      {SIDE_LABEL[item.side]}
                    </span>
                  </TableGrid.Cell>
                  <TableGrid.Cell width="7rem" numeric>
                    {item.nth}차
                  </TableGrid.Cell>
                  <TableGrid.Cell flex={1} minWidth="12rem" className="num" overflow="ellipsis">
                    {item.odno}
                  </TableGrid.Cell>
                  <TableGrid.Cell width="7rem" numeric>
                    {item.attempts}회
                  </TableGrid.Cell>
                  <TableGrid.Cell width="7.2rem" align="right" resizable={false}>
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
                  </TableGrid.Cell>
                </TableGrid.Row>
              ))}
            </TableGrid.Body>
          </TableGrid.Root>
        )}
      </div>
    </div>
  );
};
