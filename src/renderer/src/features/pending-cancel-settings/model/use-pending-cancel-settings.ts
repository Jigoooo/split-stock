import { trpc } from '@renderer/shared/api/trpc';
import { useState } from 'react';

export type ReorderMode = 'NONE' | 'MARKET' | 'LIMIT_AT_LAST_PRICE';

export interface PendingCancelFormState {
  enabled: boolean;
  timeoutMinutes: number;
  maxCancels: number;
  reorderMode: ReorderMode;
}

export interface UsePendingCancelSettingsResult {
  isPending: boolean;
  isSaving: boolean;
  error: { message: string } | null;
  form: PendingCancelFormState;
  isDirty: boolean;
  setEnabled: (v: boolean) => void;
  setTimeoutMinutes: (v: number) => void;
  setMaxCancels: (v: number) => void;
  setReorderMode: (v: ReorderMode) => void;
  save: () => void;
  reset: () => void;
}

const DEFAULT_FORM: PendingCancelFormState = {
  enabled: true,
  timeoutMinutes: 10,
  maxCancels: 5,
  reorderMode: 'NONE',
};

function settingsToForm(data: {
  enabled: boolean;
  timeoutMinutes: number;
  maxCancels: number;
  reorderMode: string;
}): PendingCancelFormState {
  return {
    enabled: data.enabled,
    timeoutMinutes: data.timeoutMinutes,
    maxCancels: data.maxCancels,
    reorderMode: data.reorderMode as ReorderMode,
  };
}

export function usePendingCancelSettings(): UsePendingCancelSettingsResult {
  const query = trpc.pendingCancel.getSettings.useQuery();
  const utils = trpc.useUtils();

  const serverForm: PendingCancelFormState = query.data ? settingsToForm(query.data) : DEFAULT_FORM;

  const [localForm, setLocalForm] = useState<PendingCancelFormState | null>(null);
  const form = localForm ?? serverForm;

  const updateMutation = trpc.pendingCancel.updateSettings.useMutation({
    onSuccess: () => {
      void utils.pendingCancel.getSettings.invalidate();
      setLocalForm(null);
    },
  });

  const isDirty = localForm !== null && JSON.stringify(localForm) !== JSON.stringify(serverForm);

  const patch = (partial: Partial<PendingCancelFormState>): void => {
    setLocalForm((prev) => ({ ...(prev ?? serverForm), ...partial }));
  };

  return {
    isPending: query.isPending,
    isSaving: updateMutation.isPending,
    error: query.error
      ? { message: query.error.message }
      : updateMutation.error
        ? { message: updateMutation.error.message }
        : null,
    form,
    isDirty,
    setEnabled: (v) => patch({ enabled: v }),
    setTimeoutMinutes: (v) => patch({ timeoutMinutes: v }),
    setMaxCancels: (v) => patch({ maxCancels: v }),
    setReorderMode: (v) => patch({ reorderMode: v }),
    save: () => {
      updateMutation.mutate(form);
    },
    reset: () => setLocalForm(null),
  };
}
