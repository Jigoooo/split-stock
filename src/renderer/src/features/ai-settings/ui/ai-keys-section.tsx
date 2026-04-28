import { useDialogFocus } from '@renderer/shared/lib/interaction';
import { Button } from '@renderer/shared/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { Key, Plus } from 'lucide-react';
import { type ReactElement, useRef } from 'react';
import { useAiKeysSection } from '../model/use-ai-keys-section';
import { AiKeyCard } from './ai-key-card';
import { AiKeyRegisterModal } from './ai-key-register-modal';

/**
 * AI API 키 관리 섹션 — settings 페이지의 'AI' 탭 본체.
 *
 * - Provider 별 BYO 키(OpenAI/Anthropic) 등록·수정·삭제·기본 설정·연결 테스트.
 * - 평문 키는 main 프로세스 safeStorage 만 보관. renderer 는 masked 만 본다.
 * - DART/KRX 등 외부 데이터 소스는 빌드 임베드라 본 화면에서 다루지 않는다.
 */
export const AiKeysSection = (): ReactElement | null => {
  const {
    configs,
    isPending,
    listError,
    isCreating,
    isUpdating,
    isConfigLocked,
    isDeletingId,
    isTestingId,
    isSettingDefaultId,
    isModalOpen,
    editingConfig,
    handleOpenRegisterModal,
    handleOpenEditModal,
    handleCloseModal,
    handleDelete,
    handleSetDefault,
    handleTest,
    handleSubmit,
    refetchConfigs,
  } = useAiKeysSection();
  const modalRef = useRef<HTMLDivElement | null>(null);

  useDialogFocus({
    enabled: isModalOpen,
    rootRef: modalRef,
    onEscape: handleCloseModal,
  });

  return (
    <>
      <div style={{ display: 'grid', gap: '1.6rem' }}>
        <div className="panel">
          <div
            className="panel__title"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.8rem',
            }}
          >
            <span>등록된 AI API 키</span>
            <Button
              variant="primary"
              dense
              iconLeading={<Plus size={14} />}
              disabled={isConfigLocked}
              onClick={handleOpenRegisterModal}
              title={
                isConfigLocked
                  ? 'AI 추천 분석 중에는 AI 키 설정을 변경할 수 없습니다.'
                  : 'AI 키 등록'
              }
            >
              키 등록
            </Button>
          </div>
          <div className="panel__body">
            <div className="muted" style={{ fontSize: '1.1rem', marginBottom: '1.2rem' }}>
              OpenAI / Anthropic 키를 등록하고 하나를 기본으로 설정하세요. 평문 키는 OS 키체인에
              암호화 저장되며 화면에는 마스킹된 형태만 표시됩니다.
            </div>
            {isConfigLocked ? (
              <div
                style={{
                  marginBottom: '1.2rem',
                  padding: '0.8rem 1rem',
                  borderRadius: '0.6rem',
                  border: '0.1rem solid rgba(217, 119, 87, 0.45)',
                  backgroundColor: 'rgba(217, 119, 87, 0.08)',
                  color: '#D97757',
                  fontSize: '1.05rem',
                  fontWeight: 600,
                }}
              >
                AI 추천 분석 중입니다. 분석이 끝날 때까지 기본 AI 키 변경, 수정, 삭제를 잠급니다.
              </div>
            ) : null}

            {isPending ? (
              <AiKeysStatus message="AI 키 목록을 불러오는 중입니다." />
            ) : listError ? (
              <AiKeysStatus
                message={`AI 키 목록을 불러오지 못했습니다: ${listError.message}`}
                action={
                  <Button onClick={refetchConfigs} dense>
                    다시 시도
                  </Button>
                }
                tone="error"
              />
            ) : configs.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(28rem, 1fr))',
                  gap: '1.2rem',
                }}
              >
                {configs.map((config, index) => (
                  <motion.div
                    key={config.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05, ease: 'easeOut' }}
                  >
                    <AiKeyCard
                      config={config}
                      isDeletingId={isDeletingId}
                      isTestingId={isTestingId}
                      isSettingDefaultId={isSettingDefaultId}
                      isConfigLocked={isConfigLocked}
                      onDelete={handleDelete}
                      onEdit={handleOpenEditModal}
                      onSetDefault={handleSetDefault}
                      onTest={handleTest}
                    />
                  </motion.div>
                ))}
              </div>
            ) : (
              <EmptyKeysPlaceholder onClick={handleOpenRegisterModal} disabled={isConfigLocked} />
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              backgroundColor: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1.6rem',
            }}
            onClick={handleCloseModal}
          >
            <motion.div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-label={editingConfig ? 'AI API 키 수정' : 'AI API 키 등록'}
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              style={{
                width: '44rem',
                maxWidth: 'calc(100vw - 3.2rem)',
                maxHeight: 'calc(100vh - 3.2rem)',
                overflowY: 'auto',
                backgroundColor: 'var(--bg)',
                border: '0.1rem solid var(--border)',
                borderRadius: '1.2rem',
                boxShadow: '0 24px 64px rgba(0, 0, 0, 0.25)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <AiKeyRegisterModal
                onClose={handleCloseModal}
                onSubmit={handleSubmit}
                editingConfig={editingConfig}
                isSubmitting={isCreating || isUpdating}
                isConfigLocked={isConfigLocked}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
};

function EmptyKeysPlaceholder({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.2rem',
        padding: '3.2rem 1.6rem',
        border: '0.1rem dashed var(--border)',
        borderRadius: '0.8rem',
        backgroundColor: 'var(--bg-2, rgba(0,0,0,0.02))',
      }}
    >
      <Key size={36} color="var(--fg-2)" aria-hidden />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '0.4rem' }}>
          등록된 AI 키가 없습니다
        </div>
        <div className="muted" style={{ fontSize: '1.15rem' }}>
          "키 등록" 버튼을 눌러 OpenAI 또는 Claude 키를 추가하세요.
        </div>
      </div>
      <Button
        variant="primary"
        dense
        iconLeading={<Plus size={14} />}
        disabled={disabled}
        onClick={onClick}
      >
        키 등록
      </Button>
    </div>
  );
}

function AiKeysStatus({
  action,
  message,
  tone = 'muted',
}: {
  action?: ReactElement;
  message: string;
  tone?: 'muted' | 'error';
}): ReactElement {
  return (
    <div
      className={tone === 'error' ? 'chip chip--down' : 'muted'}
      role={tone === 'error' ? 'alert' : 'status'}
      style={{
        alignItems: 'center',
        display: 'flex',
        gap: '0.8rem',
        justifyContent: 'space-between',
        padding: tone === 'error' ? '0.8rem 1rem' : '1.2rem 0',
      }}
    >
      <span>{message}</span>
      {action ?? null}
    </div>
  );
}
