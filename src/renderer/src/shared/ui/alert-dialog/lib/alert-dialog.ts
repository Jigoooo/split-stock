import { dialog } from '../../dialog/model/dialog-store';
import {
  DialogType,
  type DialogTypePayload,
  type DialogTypeValue,
} from '../../dialog/model/dialog-types';

type AlertDialogPayload = DialogTypePayload & {
  type?: DialogTypeValue;
};

export const alertDialog = {
  alert: (payload: AlertDialogPayload): Promise<boolean> =>
    dialog.openAsync({
      ...payload,
      type: payload.type ?? DialogType.INFO,
    }),
  confirm: (payload: AlertDialogPayload): Promise<boolean> =>
    dialog.openAsync({
      ...payload,
      isCancelWith: payload.isCancelWith ?? true,
      type: payload.type ?? DialogType.WARNING,
    }),
};
