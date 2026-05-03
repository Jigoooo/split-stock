import { Button, TableGrid } from '@renderer/shared/ui';
import type { CryptoTransferStatus, CryptoWalletStatus } from '@shared/contracts';
import type { ReactElement } from 'react';
import { formatCryptoVolume } from '../model/crypto-format';
import { formatDateTime } from '../model/crypto-formatters';

function transferDirectionLabel(direction: CryptoTransferStatus['direction']): string {
  return direction === 'deposit' ? '입금' : '출금';
}

export const CryptoTransfersPanel = ({
  enabled,
  onCloseDetail,
  onOpenDetail,
  selectedTransfer,
  transferDetailLoading,
  transfers,
  walletStatuses,
}: {
  enabled: boolean;
  onCloseDetail: () => void;
  onOpenDetail: (transfer: CryptoTransferStatus) => void;
  selectedTransfer: CryptoTransferStatus | null;
  transferDetailLoading: boolean;
  transfers: CryptoTransferStatus[];
  walletStatuses: CryptoWalletStatus[];
}): ReactElement => (
  <section className="panel crypto-account-panel crypto-transfer-panel">
    <div className="panel__title">입출금 현황</div>
    {!enabled ? (
      <div className="panel__body muted">활성 Upbit 실전 계좌에서만 조회됩니다.</div>
    ) : (
      <>
        <TableGrid.Root variant="hts" stickyHeader horizontalScroll style={{ height: '100%' }}>
          <TableGrid.Header>
            <TableGrid.Cell width="5rem">구분</TableGrid.Cell>
            <TableGrid.Cell width="7rem">자산</TableGrid.Cell>
            <TableGrid.Cell width="7rem">상태</TableGrid.Cell>
            <TableGrid.Cell width="9rem" numeric>
              수량
            </TableGrid.Cell>
            <TableGrid.Cell width="8rem" numeric>
              수수료
            </TableGrid.Cell>
            <TableGrid.Cell width="10rem">완료</TableGrid.Cell>
            <TableGrid.Cell width="6rem">상세</TableGrid.Cell>
          </TableGrid.Header>
          <TableGrid.Body>
            {transfers.map((transfer) => (
              <TableGrid.Row key={`${transfer.direction}:${transfer.uuid}`}>
                <TableGrid.Cell width="5rem">
                  {transferDirectionLabel(transfer.direction)}
                </TableGrid.Cell>
                <TableGrid.Cell width="7rem">
                  {transfer.currency}
                  {transfer.netType ? `/${transfer.netType}` : ''}
                </TableGrid.Cell>
                <TableGrid.Cell width="7rem">{transfer.state}</TableGrid.Cell>
                <TableGrid.Cell width="9rem" numeric>
                  {formatCryptoVolume(transfer.amount)}
                </TableGrid.Cell>
                <TableGrid.Cell width="8rem" numeric>
                  {formatCryptoVolume(transfer.fee)}
                </TableGrid.Cell>
                <TableGrid.Cell width="10rem">{formatDateTime(transfer.doneAt)}</TableGrid.Cell>
                <TableGrid.Cell width="6rem">
                  <Button dense onClick={() => onOpenDetail(transfer)}>
                    상세
                  </Button>
                </TableGrid.Cell>
              </TableGrid.Row>
            ))}
            {transfers.length === 0 ? (
              <TableGrid.Row placeholder>
                <TableGrid.Cell width="100%" className="muted">
                  입출금 내역이 없습니다.
                </TableGrid.Cell>
              </TableGrid.Row>
            ) : null}
          </TableGrid.Body>
        </TableGrid.Root>
        <div className="panel__body crypto-wallet-status-strip">
          {walletStatuses.slice(0, 6).map((status) => (
            <span
              key={`${status.currency}:${status.netType}`}
              className={status.walletState === 'working' ? 'chip chip--live' : 'chip'}
            >
              {status.currency}/{status.netType} {status.walletState}
            </span>
          ))}
        </div>
        {selectedTransfer || transferDetailLoading ? (
          <CryptoTransferDetailModal
            loading={transferDetailLoading}
            onClose={onCloseDetail}
            transfer={selectedTransfer}
          />
        ) : null}
      </>
    )}
  </section>
);

const CryptoTransferDetailModal = ({
  loading,
  onClose,
  transfer,
}: {
  loading: boolean;
  onClose: () => void;
  transfer: CryptoTransferStatus | null;
}): ReactElement => (
  <div className="crypto-detail-modal" role="dialog" aria-label="입출금 상세">
    <div className="crypto-detail-modal__content">
      <div className="panel__title">
        입출금 상세
        <Button dense onClick={onClose}>
          닫기
        </Button>
      </div>
      {loading && !transfer ? (
        <div className="panel__body muted">상세 로드 중…</div>
      ) : transfer ? (
        <div className="panel__body crypto-detail-modal__body">
          <div className="crypto-detail-modal__summary">
            <span>{transferDirectionLabel(transfer.direction)}</span>
            <span>
              {transfer.currency}
              {transfer.netType ? `/${transfer.netType}` : ''}
            </span>
            <span>{transfer.state}</span>
            <span>수량 {formatCryptoVolume(transfer.amount)}</span>
            <span>수수료 {formatCryptoVolume(transfer.fee)}</span>
          </div>
          <dl className="crypto-detail-modal__fields">
            <div>
              <dt>UUID</dt>
              <dd className="num">{transfer.uuid}</dd>
            </div>
            <div>
              <dt>요청</dt>
              <dd>{formatDateTime(transfer.createdAt)}</dd>
            </div>
            <div>
              <dt>완료</dt>
              <dd>{formatDateTime(transfer.doneAt)}</dd>
            </div>
            <div>
              <dt>구분</dt>
              <dd>{transfer.transferType || transfer.transactionType || '-'}</dd>
            </div>
            <div>
              <dt>TX</dt>
              <dd className="num">{transfer.txid ?? '-'}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  </div>
);
