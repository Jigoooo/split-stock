import { useActiveAccountId } from '@renderer/entities/account';
import { useEditLots } from '@renderer/features/edit-lots-manual';
import { trpc } from '@renderer/shared/api/trpc';
import { type Dispatch, type SetStateAction, useState } from 'react';

export interface UseLotsLogEditModeResult {
  accountId: number | null;
  csvOpen: boolean;
  editLots: ReturnType<typeof useEditLots>;
  editPdnoInput: string;
  masterSafetyOn: boolean;
  onEditPdnoInputChange: (value: string) => void;
  onEnterMode: () => Promise<void>;
  setCsvOpen: Dispatch<SetStateAction<boolean>>;
}

export function useLotsLogEditMode(): UseLotsLogEditModeResult {
  const editLots = useEditLots();
  const [csvOpen, setCsvOpen] = useState(false);
  const [editPdnoInput, setEditPdnoInput] = useState('');
  const { accountId } = useActiveAccountId();
  const safetyQuery = trpc.safety.getState.useQuery({}, { enabled: accountId !== null });

  const onEnterMode = async (): Promise<void> => {
    if (accountId === null) return;
    await editLots.enterMode(accountId);
  };

  const onEditPdnoInputChange = (value: string): void => {
    setEditPdnoInput(value);
    if (/^\d{6}$/.test(value)) editLots.setPdno(value);
    else editLots.setPdno(null);
  };

  return {
    accountId,
    csvOpen,
    editLots,
    editPdnoInput,
    masterSafetyOn: safetyQuery.data?.master ?? false,
    onEditPdnoInputChange,
    onEnterMode,
    setCsvOpen,
  };
}
