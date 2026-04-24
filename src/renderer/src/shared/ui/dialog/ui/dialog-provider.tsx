import type { ReactElement } from 'react';
import { AlertDialogRenderer } from '../../alert-dialog';
import { useDialogStore } from '../model/dialog-store';

/**
 * 함수형 dialog의 단일 mount 지점.
 * AppProviders 트리에 한 번만 배치한다.
 */
export const DialogProvider = (): ReactElement => {
  const config = useDialogStore((state) => state.dialogConfig);
  return <AlertDialogRenderer config={config} />;
};
