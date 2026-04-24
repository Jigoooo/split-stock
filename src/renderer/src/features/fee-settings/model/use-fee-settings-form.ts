import type { FeeEnv, FeeSettings } from '@renderer/entities/fee-settings';
import { useGetAllFeeSettings, useUpdateFeeSettings } from '@renderer/entities/fee-settings';
import { useEffect, useState } from 'react';

const DEFAULT_FEES = {
  real: { buy: 0.015, sell: 0.015, tax: 0.2 },
  mock: { buy: 0.35, sell: 0.35, tax: 0.2 },
};

export function useFeeSettingsForm() {
  const { data: allSettings, isPending: isLoading, error } = useGetAllFeeSettings();
  const updateMutation = useUpdateFeeSettings();

  const [formData, setFormData] = useState<{
    real: FeeSettings;
    mock: FeeSettings;
  }>(DEFAULT_FEES);

  // allSettings 변경 시 formData 동기화
  useEffect(() => {
    if (allSettings) {
      setFormData(allSettings);
    }
  }, [allSettings]);

  const handleFieldChange = (env: FeeEnv, field: keyof FeeSettings, value: number) => {
    setFormData((prev) => ({
      ...prev,
      [env]: {
        ...prev[env],
        [field]: value,
      },
    }));
  };

  const handleSave = (env: FeeEnv) => {
    updateMutation.mutate({
      env,
      buy: formData[env].buy,
      sell: formData[env].sell,
      tax: formData[env].tax,
    });
  };

  return {
    formData,
    isLoading,
    error,
    isSaving: updateMutation.isPending,
    handleFieldChange,
    handleSave,
  };
}
