import type { WatchOrder } from '@renderer/entities/watch-order';
import type { ReactElement } from 'react';
import type { WatchOrderFormPrefill } from '../model/types';
import { useAddWatchOrderFormController } from '../model/use-add-watch-order-form-controller';
import { AddWatchOrderDialogContent } from './add-watch-order-dialog-content';

export interface AddWatchOrderDialogProps {
  open: boolean;
  accountId: number;
  prefill: WatchOrderFormPrefill | null;
  onClose: () => void;
  layout?: 'modal' | 'page';
  onSaved?: (order: WatchOrder) => void;
}

export const AddWatchOrderDialog = (props: AddWatchOrderDialogProps): ReactElement | null => {
  const { accountId, layout = 'modal', onClose, onSaved, open, prefill } = props;
  if (!open) return null;
  return (
    <AddWatchOrderDialogInner
      key={prefill?.existingId ?? 'new'}
      accountId={accountId}
      layout={layout}
      onClose={onClose}
      onSaved={onSaved}
      prefill={prefill}
    />
  );
};

interface InnerProps {
  accountId: number;
  layout: 'modal' | 'page';
  prefill: WatchOrderFormPrefill | null;
  onClose: () => void;
  onSaved?: ((order: WatchOrder) => void) | undefined;
}

const AddWatchOrderDialogInner = ({
  accountId,
  layout,
  onClose,
  onSaved,
  prefill,
}: InnerProps): ReactElement => {
  const controller = useAddWatchOrderFormController({ accountId, onClose, onSaved, prefill });
  return <AddWatchOrderDialogContent controller={controller} layout={layout} onClose={onClose} />;
};
