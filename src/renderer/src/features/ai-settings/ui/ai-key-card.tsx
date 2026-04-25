import { Button } from '@renderer/shared/ui';
import { motion } from 'framer-motion';
import { KeyRound, Pencil, Trash2, Zap } from 'lucide-react';
import type { ReactElement } from 'react';
import { PROVIDER_COLORS, PROVIDER_LABELS } from '../model/provider-info';
import type { AiProviderConfigView } from '../model/types';

export interface AiKeyCardProps {
  config: AiProviderConfigView;
  isDeletingId: number | null;
  isTestingId: number | null;
  isSettingDefaultId: number | null;
  onDelete: (id: number, label: string) => void;
  onEdit: (config: AiProviderConfigView) => void;
  onSetDefault: (id: number, label: string) => void;
  onTest: (id: number, label: string) => void;
}

export const AiKeyCard = ({
  config,
  isDeletingId,
  isTestingId,
  isSettingDefaultId,
  onDelete,
  onEdit,
  onSetDefault,
  onTest,
}: AiKeyCardProps): ReactElement => {
  const providerColor = PROVIDER_COLORS[config.provider];
  const providerLabel = PROVIDER_LABELS[config.provider];
  const isDeleting = isDeletingId === config.id;
  const isTesting = isTestingId === config.id;
  const isSettingDefault = isSettingDefaultId === config.id;
  const isAnyLoading = isDeleting || isTesting || isSettingDefault;
  const label = `${providerLabel} / ${config.model}`;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      style={{ height: '100%' }}
    >
      <div
        className="panel"
        style={{
          padding: '1.6rem',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: '100%',
          boxSizing: 'border-box',
          borderTop: `0.3rem solid ${providerColor}`,
          borderTopLeftRadius: '0.6rem',
          borderTopRightRadius: '0.6rem',
        }}
      >
        <div style={{ marginBottom: '1.2rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '1.2rem',
              gap: '0.6rem',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: 'inline-block',
                  backgroundColor: `${providerColor}1F`,
                  color: providerColor,
                  border: `0.1rem solid ${providerColor}`,
                  padding: '0.2rem 0.8rem',
                  borderRadius: '1.2rem',
                  fontSize: '1.05rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  marginBottom: '0.6rem',
                }}
              >
                {providerLabel}
              </div>
              <h3
                style={{
                  fontSize: '1.35rem',
                  fontWeight: 700,
                  margin: 0,
                  color: 'var(--fg)',
                  wordBreak: 'break-all',
                  fontFamily: 'monospace',
                }}
              >
                {config.model}
              </h3>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                flexShrink: 0,
              }}
            >
              {config.isDefault ? (
                <span
                  className="chip chip--live"
                  style={{
                    height: '2.4rem',
                    padding: '0 0.8rem',
                    fontSize: '1.05rem',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  기본
                </span>
              ) : (
                <Button
                  variant="ghost"
                  iconOnly
                  dense
                  iconLeading={<KeyRound size={14} />}
                  disabled={isAnyLoading}
                  onClick={() => onSetDefault(config.id, label)}
                  aria-label="기본 키 설정"
                  title="기본 키 설정"
                />
              )}
              <Button
                variant="ghost"
                iconOnly
                dense
                iconLeading={<Pencil size={14} />}
                disabled={isAnyLoading}
                onClick={() => onEdit(config)}
                aria-label="수정"
                title="수정"
              />
              <Button
                variant="ghost-danger"
                iconOnly
                dense
                iconLeading={<Trash2 size={14} />}
                disabled={isDeleting}
                onClick={() => onDelete(config.id, label)}
                aria-label="삭제"
                title="삭제"
              />
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-2, rgba(0,0,0,0.03))',
              border: '0.1rem solid var(--border)',
              padding: '0.7rem 0.9rem',
              borderRadius: '0.4rem',
              marginBottom: '1rem',
            }}
          >
            <div
              style={{
                fontSize: '1.05rem',
                color: 'var(--fg-2)',
                marginBottom: '0.3rem',
              }}
            >
              API Key
            </div>
            <div
              style={{
                fontSize: '1.2rem',
                fontFamily: 'monospace',
                color: 'var(--fg)',
                wordBreak: 'break-all',
              }}
            >
              {config.apiKeyMasked}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            <div>
              <div style={{ fontSize: '1.05rem', color: 'var(--fg-2)', marginBottom: '0.2rem' }}>
                생성
              </div>
              <div style={{ fontSize: '1.1rem', color: 'var(--fg)' }}>
                {config.createdAt.toLocaleDateString('ko-KR')}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '1.05rem', color: 'var(--fg-2)', marginBottom: '0.2rem' }}>
                수정
              </div>
              <div style={{ fontSize: '1.1rem', color: 'var(--fg)' }}>
                {config.updatedAt.toLocaleDateString('ko-KR')}
              </div>
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          dense
          iconLeading={<Zap size={14} />}
          disabled={isAnyLoading}
          onClick={() => onTest(config.id, label)}
          aria-label="연결 테스트"
          style={{
            width: '100%',
            color: providerColor,
            borderColor: providerColor,
            borderStyle: 'solid',
            borderWidth: '0.1rem',
          }}
        >
          {isTesting ? '테스트 중...' : '연결 테스트'}
        </Button>
      </div>
    </motion.div>
  );
};
