import { Button, SegmentedToggle, TextInput } from '@renderer/shared/ui';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Info, X } from 'lucide-react';
import { type ReactElement, useId, useState } from 'react';
import {
  MODEL_INFO,
  PROVIDER_COLORS,
  PROVIDER_LABELS,
  PROVIDER_MODELS,
} from '../model/provider-info';
import type { AiKeySubmitInput, AiProvider, AiProviderConfigView } from '../model/types';

export interface AiKeyRegisterModalProps {
  onClose: () => void;
  onSubmit: (data: AiKeySubmitInput) => void;
  editingConfig: AiProviderConfigView | null;
  isSubmitting?: boolean;
}

export const AiKeyRegisterModal = ({
  onClose,
  onSubmit,
  editingConfig,
  isSubmitting = false,
}: AiKeyRegisterModalProps): ReactElement => {
  const isEditMode = editingConfig !== null;

  const [provider, setProvider] = useState<AiProvider>(editingConfig?.provider ?? 'anthropic');
  const initialModels = PROVIDER_MODELS[provider];
  const [model, setModel] = useState<string>(
    editingConfig?.model ?? initialModels[0] ?? 'claude-haiku-4-5-20251001',
  );
  const [apiKey, setApiKey] = useState('');
  const [isDefault, setIsDefault] = useState(editingConfig?.isDefault ?? false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [hoveredModel, setHoveredModel] = useState<string | null>(null);
  const apiKeyInputId = useId();
  const defaultCheckId = useId();

  const handleSubmit = (): void => {
    if (!isEditMode && apiKey.trim().length < 8) {
      return;
    }
    onSubmit({
      provider,
      model,
      apiKey: apiKey.trim(),
      isDefault,
    });
  };

  const providerColor = PROVIDER_COLORS[provider];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2rem',
        width: '100%',
        padding: '2rem',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ textAlign: 'center', position: 'relative' }}>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0.4rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--fg-2)',
            borderRadius: '0.4rem',
          }}
        >
          <X size={20} />
        </button>
        <h2
          style={{
            margin: '0 0 0.6rem 0',
            fontSize: '1.7rem',
            fontWeight: 700,
            color: 'var(--fg)',
          }}
        >
          AI API 키 {isEditMode ? '수정' : '등록'}
        </h2>
        <p style={{ margin: 0, fontSize: '1.2rem', color: 'var(--fg-2)' }}>
          {isEditMode
            ? 'AI API 키 정보를 수정합니다.'
            : 'split-stock 의 AI 추천 기능에 사용할 키를 등록하세요.'}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
        <div>
          <div
            style={{
              fontSize: '1.15rem',
              fontWeight: 600,
              marginBottom: '0.6rem',
              color: 'var(--fg)',
            }}
          >
            프로바이더
          </div>
          <SegmentedToggle
            value={provider}
            onChange={(p: AiProvider) => {
              setProvider(p);
              const models = PROVIDER_MODELS[p];
              const targetModel =
                editingConfig?.model && models.includes(editingConfig.model)
                  ? editingConfig.model
                  : (models[0] ?? '');
              setModel(targetModel);
            }}
            ariaLabel="AI 프로바이더"
            items={(['anthropic', 'openai'] as const).map((p) => ({
              value: p,
              label: PROVIDER_LABELS[p],
            }))}
          />
        </div>

        <div>
          <div
            style={{
              fontSize: '1.15rem',
              fontWeight: 600,
              marginBottom: '0.6rem',
              color: 'var(--fg)',
            }}
          >
            모델
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {PROVIDER_MODELS[provider].map((m) => {
              const isSelected = model === m;
              const info = MODEL_INFO[m];
              const isCurrentModel = isEditMode && editingConfig?.model === m;
              return (
                <motion.button
                  key={m}
                  type="button"
                  onClick={() => setModel(m)}
                  initial={false}
                  animate={{
                    backgroundColor: isSelected
                      ? `${providerColor}14`
                      : 'var(--bg-2, rgba(0,0,0,0.02))',
                    borderColor: isSelected ? providerColor : 'var(--border)',
                    color: isSelected ? providerColor : 'var(--fg)',
                  }}
                  whileHover={{ backgroundColor: `${providerColor}10` }}
                  transition={{ duration: 0.15 }}
                  style={{
                    padding: '0.7rem 1rem',
                    border: '0.1rem solid',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                    fontWeight: isSelected ? 600 : 400,
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.6rem',
                    position: 'relative',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'monospace',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>{info?.label ?? m}</span>
                    {isCurrentModel ? (
                      <span
                        style={{
                          fontSize: '0.95rem',
                          fontWeight: 700,
                          color: '#fff',
                          backgroundColor: providerColor,
                          padding: '0.1rem 0.45rem',
                          borderRadius: '0.3rem',
                          lineHeight: 1.4,
                          flexShrink: 0,
                        }}
                      >
                        현재
                      </span>
                    ) : null}
                    <span
                      style={{
                        fontSize: '1rem',
                        fontWeight: 400,
                        color: 'var(--fg-2)',
                        fontFamily: 'inherit',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {m}
                    </span>
                  </span>
                  {info ? (
                    // biome-ignore lint/a11y/noStaticElementInteractions: tooltip hover wrapper, info already in title
                    <span
                      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
                      title={`${info.desc}\n${info.cost}`}
                      onMouseEnter={() => setHoveredModel(m)}
                      onMouseLeave={() => setHoveredModel(null)}
                    >
                      <Info
                        size={14}
                        style={{
                          color: hoveredModel === m ? providerColor : 'var(--fg-2)',
                          transition: 'color 0.15s',
                        }}
                      />
                      {hoveredModel === m ? (
                        <div
                          style={{
                            position: 'absolute',
                            right: '100%',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            marginRight: '0.6rem',
                            padding: '0.8rem 1rem',
                            borderRadius: '0.6rem',
                            backgroundColor: 'var(--bg)',
                            border: `0.1rem solid var(--border)`,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                            zIndex: 100,
                            width: '22rem',
                            pointerEvents: 'none',
                          }}
                        >
                          <p
                            style={{
                              margin: '0 0 0.5rem 0',
                              fontSize: '1.1rem',
                              color: 'var(--fg)',
                              lineHeight: 1.5,
                            }}
                          >
                            {info.desc}
                          </p>
                          <p
                            style={{
                              margin: 0,
                              fontSize: '1rem',
                              color: providerColor,
                              fontWeight: 600,
                              fontFamily: 'monospace',
                            }}
                          >
                            {info.cost}
                          </p>
                        </div>
                      ) : null}
                    </span>
                  ) : null}
                </motion.button>
              );
            })}
          </div>
        </div>

        <div>
          <label
            htmlFor={apiKeyInputId}
            style={{
              display: 'block',
              fontSize: '1.15rem',
              fontWeight: 600,
              marginBottom: '0.6rem',
              color: 'var(--fg)',
            }}
          >
            API Key
            {isEditMode ? (
              <span style={{ color: 'var(--fg-2)', fontWeight: 400 }}> (변경 시에만 입력)</span>
            ) : null}
          </label>
          <div style={{ position: 'relative' }}>
            <TextInput
              id={apiKeyInputId}
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
              placeholder={isEditMode ? '변경할 API 키 입력 (선택)' : 'API 키 입력'}
              autoComplete="off"
              style={{ paddingRight: '3.4rem' }}
            />
            <button
              type="button"
              onClick={() => setShowApiKey((s) => !s)}
              aria-label={showApiKey ? 'API 키 숨기기' : 'API 키 표시'}
              style={{
                position: 'absolute',
                top: '50%',
                right: '0.4rem',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0.4rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--fg-2)',
                borderRadius: '0.3rem',
              }}
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <label
          htmlFor={defaultCheckId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            id={defaultCheckId}
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.currentTarget.checked)}
            style={{ width: '1.6rem', height: '1.6rem', accentColor: providerColor }}
          />
          <span style={{ fontSize: '1.2rem', color: 'var(--fg)' }}>기본 AI 키로 설정</span>
        </label>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={isSubmitting || (!isEditMode && apiKey.trim().length < 8)}
        variant="primary"
        style={{
          width: '100%',
          backgroundColor: providerColor,
          borderColor: providerColor,
        }}
      >
        {isSubmitting ? (isEditMode ? '수정 중...' : '등록 중...') : isEditMode ? '수정' : '등록'}
      </Button>
    </div>
  );
};
