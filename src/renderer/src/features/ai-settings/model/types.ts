/**
 * AI 키 관리 feature 타입 — main 의 ai-router 응답 view 와 호환되는 renderer-side 좁힘.
 */

export type AiProvider = 'openai' | 'anthropic';

export interface AiProviderConfigView {
  id: number;
  provider: AiProvider;
  model: string;
  apiKeyMasked: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiKeySubmitInput {
  provider: AiProvider;
  model: string;
  /** 등록 시 필수, 수정 시 빈 문자열이면 기존 키 유지. */
  apiKey: string;
  isDefault: boolean;
}
