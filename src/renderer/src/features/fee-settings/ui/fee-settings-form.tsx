import { useState } from 'react';
import type { FeeEnv } from '../../../entities/fee-settings';
import { useFeeSettingsForm } from '../model/use-fee-settings-form';

export function FeeSettingsForm() {
  const { formData, isLoading, error, isSaving, handleFieldChange, handleSave } =
    useFeeSettingsForm();
  const [savingEnv, setSavingEnv] = useState<FeeEnv | null>(null);

  const handleSubmit = (env: FeeEnv) => {
    setSavingEnv(env);
    handleSave(env);
  };

  if (isLoading) {
    return <div className="p-4 text-gray-500">수수료 설정 로드 중...</div>;
  }

  if (error) {
    return (
      <div className="p-4 text-red-600">
        오류: {error instanceof Error ? error.message : '알 수 없는 오류'}
      </div>
    );
  }

  const renderFeeSection = (env: FeeEnv, label: string) => (
    <div key={env} className="border rounded-lg p-4 mb-4">
      <h3 className="text-lg font-semibold mb-4">{label}</h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">매입 수수료 (%)</label>
          <input
            type="number"
            step="0.001"
            min="0"
            value={formData[env].buy}
            onChange={(e) => handleFieldChange(env, 'buy', parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isSaving}
          />
          <p className="text-xs text-gray-500 mt-1">예: 0.015 (= 0.015%), 0.35 (= 0.35%)</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">매도 수수료 (%)</label>
          <input
            type="number"
            step="0.001"
            min="0"
            value={formData[env].sell}
            onChange={(e) => handleFieldChange(env, 'sell', parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isSaving}
          />
          <p className="text-xs text-gray-500 mt-1">예: 0.015 (= 0.015%), 0.35 (= 0.35%)</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">제세금 (%)</label>
          <input
            type="number"
            step="0.001"
            min="0"
            value={formData[env].tax}
            onChange={(e) => handleFieldChange(env, 'tax', parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isSaving}
          />
          <p className="text-xs text-gray-500 mt-1">예: 0.20 (= 0.20%)</p>
        </div>
      </div>

      <button
        onClick={() => handleSubmit(env)}
        disabled={isSaving || savingEnv === env}
        className="mt-4 w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
      >
        {savingEnv === env ? '저장 중...' : '저장'}
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-6">수수료 설정</h2>
        <p className="text-gray-600 mb-4">
          실 계좌와 모의 계좌의 수수료 및 제세금 설정을 관리합니다.
        </p>
      </div>

      {renderFeeSection('real', '실 계좌')}
      {renderFeeSection('mock', '모의 계좌')}
    </div>
  );
}
