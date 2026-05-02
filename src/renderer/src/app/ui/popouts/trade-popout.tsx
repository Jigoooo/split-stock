import { useActiveAccountId } from '@renderer/entities/account';
import { CryptoMainPage } from '@renderer/pages/main/ui/crypto-main-page';
import { TradePage } from '@renderer/pages/trade';
import type { ReactElement } from 'react';
import type { PopoutApi } from '../../model/use-popout-state';

export const TradePopout = ({ popout }: { popout: PopoutApi }): ReactElement => {
  const { account, accountId, isPending } = useActiveAccountId();

  if (isPending) {
    return <div className="panel__body muted">계좌 확인 중…</div>;
  }

  if (account?.broker === 'UPBIT') {
    if (accountId === null) {
      return <div className="panel__body muted">활성 Upbit 계좌가 없습니다.</div>;
    }
    return <CryptoMainPage accountId={accountId} variant="trade-popout" />;
  }

  return (
    <TradePage
      isStockPickerPopoutOpen={popout.isOpen('stock-picker')}
      onOpenStockPickerPopout={() => popout.popout('stock-picker')}
    />
  );
};
