import { Button } from '@renderer/shared/ui';
import { Sparkles } from 'lucide-react';
import type { ReactElement } from 'react';
import { useSymbolRecommendations } from '../model/use-symbol-recommendations';
import { RecommendModal } from './recommend-modal';

export interface RecommendButtonProps {
  /** 추천 결과 카드 클릭 시 호출 — 외부 폼 prefill 용. */
  onPick?: (pdno: string, name: string) => void;
  /** 라벨 변경. 기본 'AI 매직스플릿 추천'. */
  label?: string;
  dense?: boolean;
}

/**
 * 자동감시 첫 플로우(종목 선택)를 보조하는 AI 추천 트리거.
 * - default AI 키 미설정 시 disabled + 안내 툴팁.
 * - 클릭 시 modal 오픈, mutation 자동 트리거.
 */
export const RecommendButton = ({ onPick, label, dense }: RecommendButtonProps): ReactElement => {
  const {
    view,
    hasDefaultKey,
    isAiListLoading,
    extraPdnos,
    aiOff,
    includeAutoDiscovery,
    open,
    close,
    analyze,
    addExtraPdno,
    removeExtraPdno,
    toggleAiOff,
    toggleAutoDiscovery,
  } = useSymbolRecommendations();

  const disabled = isAiListLoading;
  const title = !hasDefaultKey
    ? 'AI 키 미등록 — 알고리즘 전용 모드로 추천. 설정 → AI 탭에서 키를 등록하면 LLM 활용.'
    : 'AI 또는 알고리즘으로 매직스플릿 적합 종목 추천 (top/strong/moderate/watch/avoid 분포)';

  return (
    <>
      <Button
        variant="ghost"
        dense={dense ?? false}
        iconLeading={<Sparkles size={14} />}
        disabled={disabled}
        onClick={open}
        title={title}
        aria-label="AI 매직스플릿 추천"
        style={{
          color: '#D97757',
          borderColor: '#D97757',
          borderStyle: 'solid',
          borderWidth: '0.1rem',
        }}
      >
        {label ?? 'AI 추천'}
      </Button>
      <RecommendModal
        view={view}
        onClose={close}
        onAnalyze={analyze}
        onPick={(pdno, name) => {
          onPick?.(pdno, name);
          close();
        }}
        extras={extraPdnos}
        onAddExtra={addExtraPdno}
        onRemoveExtra={removeExtraPdno}
        aiOff={aiOff}
        onToggleAiOff={toggleAiOff}
        includeAutoDiscovery={includeAutoDiscovery}
        onToggleAutoDiscovery={toggleAutoDiscovery}
        hasDefaultKey={hasDefaultKey}
      />
    </>
  );
};
