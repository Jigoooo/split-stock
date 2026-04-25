import { trpc } from '@renderer/shared/api/trpc';
import { dialog } from '@renderer/shared/ui/dialog';
import { useState } from 'react';
import { toast } from 'sonner';
import type { AiKeySubmitInput, AiProviderConfigView } from './types';

/**
 * AI 키 관리 섹션 hook — list/create/update/delete/setDefault/test 의 모든 mutation 통합.
 *
 * 보안 불변식:
 *   - 평문 키는 server 응답에 포함 X. masked 만 listConfigs 반환.
 *   - 빈 apiKey 로 mutation 호출 시 main 의 update 가 기존 키 유지.
 */
export function useAiKeysSection() {
  const utils = trpc.useUtils();
  const list = trpc.ai.listConfigs.useQuery();

  const [isModalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<AiProviderConfigView | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<number | null>(null);
  const [isTestingId, setIsTestingId] = useState<number | null>(null);
  const [isSettingDefaultId, setIsSettingDefaultId] = useState<number | null>(null);

  const create = trpc.ai.createConfig.useMutation({
    onSuccess: () => {
      void utils.ai.listConfigs.invalidate();
      toast.success('AI 키가 등록되었습니다');
      setModalOpen(false);
      setEditingConfig(null);
    },
    onError: (err) => {
      toast.error(`AI 키 등록 실패: ${err.message}`);
    },
  });
  const update = trpc.ai.updateConfig.useMutation({
    onSuccess: () => {
      void utils.ai.listConfigs.invalidate();
      toast.success('AI 키가 수정되었습니다');
      setModalOpen(false);
      setEditingConfig(null);
    },
    onError: (err) => {
      toast.error(`AI 키 수정 실패: ${err.message}`);
    },
  });
  const remove = trpc.ai.deleteConfig.useMutation({
    onSettled: () => {
      setIsDeletingId(null);
    },
    onSuccess: () => {
      void utils.ai.listConfigs.invalidate();
      toast.success('AI 키가 삭제되었습니다');
    },
    onError: (err) => {
      toast.error(`AI 키 삭제 실패: ${err.message}`);
    },
  });
  const setDefault = trpc.ai.setDefault.useMutation({
    onSettled: () => {
      setIsSettingDefaultId(null);
    },
    onSuccess: () => {
      void utils.ai.listConfigs.invalidate();
      toast.success('기본 AI 키로 설정되었습니다');
    },
    onError: (err) => {
      toast.error(`기본 키 설정 실패: ${err.message}`);
    },
  });
  const test = trpc.ai.testConnection.useMutation({
    onSettled: () => {
      setIsTestingId(null);
    },
  });

  const handleOpenRegisterModal = (): void => {
    setEditingConfig(null);
    setModalOpen(true);
  };
  const handleOpenEditModal = (config: AiProviderConfigView): void => {
    setEditingConfig(config);
    setModalOpen(true);
  };
  const handleCloseModal = (): void => {
    if (create.isPending || update.isPending) return;
    setModalOpen(false);
    setEditingConfig(null);
  };

  const handleSubmit = (input: AiKeySubmitInput): void => {
    if (editingConfig) {
      update.mutate({
        id: editingConfig.id,
        provider: input.provider,
        model: input.model,
        ...(input.apiKey.length > 0 ? { apiKey: input.apiKey } : {}),
        isDefault: input.isDefault,
      });
    } else {
      create.mutate({
        provider: input.provider,
        model: input.model,
        apiKey: input.apiKey,
        isDefault: input.isDefault,
      });
    }
  };

  const handleDelete = async (id: number, label: string): Promise<void> => {
    const confirmed = await dialog.openAsync({
      type: 'WARNING',
      title: 'AI 키 삭제',
      confirmText: '삭제',
      cancelText: '취소',
      isCancelWith: true,
      message: (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <div>
            <strong>{label}</strong> AI 키를 삭제합니다.
          </div>
          <div className="muted">이후 사용하려면 다시 등록이 필요합니다.</div>
        </div>
      ),
    });
    if (!confirmed) return;
    setIsDeletingId(id);
    remove.mutate({ id });
  };

  const handleSetDefault = (id: number, _label: string): void => {
    setIsSettingDefaultId(id);
    setDefault.mutate({ id });
  };

  const handleTest = (id: number, label: string): void => {
    setIsTestingId(id);
    test.mutate(
      { id },
      {
        onSuccess: (res) => {
          if (res.ok) {
            toast.success(`${label} 연결 OK`);
          } else {
            toast.error(`${label} 연결 실패: ${res.message ?? '원인 불명'}`);
          }
        },
        onError: (err) => {
          toast.error(`${label} 연결 실패: ${err.message}`);
        },
      },
    );
  };

  return {
    configs: (list.data?.configs ?? []) as AiProviderConfigView[],
    isPending: list.isLoading,
    isCreating: create.isPending,
    isUpdating: update.isPending,
    isDeletingId,
    isTestingId,
    isSettingDefaultId,
    isModalOpen,
    editingConfig,
    handleOpenRegisterModal,
    handleOpenEditModal,
    handleCloseModal,
    handleSubmit,
    handleDelete,
    handleSetDefault,
    handleTest,
  };
}
