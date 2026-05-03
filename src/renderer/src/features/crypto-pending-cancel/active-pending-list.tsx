import { trpc } from '@renderer/shared/api/trpc';
import { Button, EmptyState, TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

const SIDE_LABEL: Record<'BUY' | 'SELL', string> = {
  BUY: '매수',
  SELL: '매도',
};

/**
 * 코인(UPBIT) 미체결 자동취소 활성 목록. (RALPLAN P6 #2 후속)
 * stock pendingCancel 활성 목록과 동일 패턴, cryptoPendingOrderWatcher 인스턴스 기반.
 */
export const CryptoActivePendingList = (): ReactElement => {
  const utils = trpc.useUtils();
  const { data, isPending, error, refetch } = trpc.cryptoPendingCancel.listActive.useQuery(
    undefined,
    { refetchInterval: 10_000 },
  );
  const items = data?.items ?? [];

  const unregister = trpc.cryptoPendingCancel.unregister.useMutation({
    onSuccess: () => {
      void utils.cryptoPendingCancel.listActive.invalidate();
      void refetch();
    },
  });

  if (isPending) {
    return (
      <div className="panel">
        <div className="panel__body">
          <EmptyState dense title="코인 미체결 감시 로드 중…" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <div className="panel__body chip chip--down" role="alert">
          {error.message}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="panel">
        <div className="panel__title">코인 미체결 감시</div>
        <div className="panel__body">
          <EmptyState dense title="감시 중인 코인 미체결 주문 없음" />
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__title">코인 미체결 감시 ({items.length})</div>
      <div className="panel__body">
        <TableGrid.Root variant="hts" stickyHeader>
          <TableGrid.Header>
            <TableGrid.Cell flex={1}>마켓</TableGrid.Cell>
            <TableGrid.Cell width="4rem">방향</TableGrid.Cell>
            <TableGrid.Cell flex={2}>UUID</TableGrid.Cell>
            <TableGrid.Cell width="4rem" numeric>
              시도
            </TableGrid.Cell>
            <TableGrid.Cell width="6rem">조작</TableGrid.Cell>
          </TableGrid.Header>
          <TableGrid.Body>
            {items.map((item) => (
              <TableGrid.Row key={`${item.pdno}:${item.side}:${item.nth}`}>
                <TableGrid.Cell flex={1}>{item.pdno}</TableGrid.Cell>
                <TableGrid.Cell width="4rem">{SIDE_LABEL[item.side]}</TableGrid.Cell>
                <TableGrid.Cell flex={2} className="muted">
                  {item.odno}
                </TableGrid.Cell>
                <TableGrid.Cell width="4rem" numeric>
                  {item.attempts}
                </TableGrid.Cell>
                <TableGrid.Cell width="6rem">
                  <Button
                    dense
                    disabled={unregister.isPending || item.accountId === undefined}
                    onClick={() =>
                      item.accountId !== undefined &&
                      unregister.mutate({
                        market: item.pdno,
                        side: item.side,
                        nth: item.nth,
                        accountId: item.accountId,
                      })
                    }
                  >
                    감시 해제
                  </Button>
                </TableGrid.Cell>
              </TableGrid.Row>
            ))}
          </TableGrid.Body>
        </TableGrid.Root>
      </div>
    </div>
  );
};
