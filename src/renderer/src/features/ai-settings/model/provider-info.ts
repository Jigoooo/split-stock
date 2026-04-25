import type { AiProvider } from './types';

/**
 * Provider 별 브랜드 컬러 — crypto-bot-web 과 동일.
 * - claude(anthropic): #D97757 (Claude orange)
 * - openai: #10A37F (ChatGPT green)
 */
export const PROVIDER_COLORS: Record<AiProvider, string> = {
  anthropic: '#D97757',
  openai: '#10A37F',
} as const;

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
} as const;

export const PROVIDER_MODELS: Record<AiProvider, readonly string[]> = {
  anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6'] as const,
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'] as const,
} as const;

export interface ModelInfo {
  label: string;
  desc: string;
  cost: string;
}

export const MODEL_INFO: Record<string, ModelInfo> = {
  'claude-haiku-4-5-20251001': {
    label: 'Haiku 4.5',
    desc: '가장 빠르고 저렴한 모델. 단순 신호 판단에 적합.',
    cost: 'Input $0.80 / Output $4.00 (1M tokens)',
  },
  'claude-sonnet-4-6': {
    label: 'Sonnet 4.6',
    desc: '속도와 성능의 최적 균형. 표준 트레이딩 신호 분석에 권장.',
    cost: 'Input $3.00 / Output $15.00 (1M tokens)',
  },
  'claude-opus-4-6': {
    label: 'Opus 4.6',
    desc: '최고 성능. 복잡한 시장 분석과 다중 지표 종합 판단.',
    cost: 'Input $15.00 / Output $75.00 (1M tokens)',
  },
  'gpt-4o-mini': {
    label: 'GPT-4o Mini',
    desc: '저비용 고속 모델. 단순 신호 판단에 적합.',
    cost: 'Input $0.15 / Output $0.60 (1M tokens)',
  },
  'gpt-4o': {
    label: 'GPT-4o',
    desc: '멀티모달 표준 모델. 안정적인 트레이딩 분석.',
    cost: 'Input $2.50 / Output $10.00 (1M tokens)',
  },
  'gpt-4.1-mini': {
    label: 'GPT-4.1 Mini',
    desc: '최신 경량 모델. 코딩/분석 성능 향상.',
    cost: 'Input $0.40 / Output $1.60 (1M tokens)',
  },
  'gpt-4.1': {
    label: 'GPT-4.1',
    desc: '최신 표준 모델. 복잡한 지시 따르기와 장문 분석에 강점.',
    cost: 'Input $2.00 / Output $8.00 (1M tokens)',
  },
  'o4-mini': {
    label: 'o4-mini',
    desc: '추론 특화 모델. 논리적 시장 분석에 강점.',
    cost: 'Input $1.10 / Output $4.40 (1M tokens)',
  },
};
