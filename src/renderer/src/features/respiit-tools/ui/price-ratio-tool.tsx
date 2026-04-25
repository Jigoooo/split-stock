import { trpc } from '@renderer/shared/api/trpc';
import { Button, NumberInput, TextInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { usePriceRatioTool } from '../model/use-price-ratio-tool';
import { PriceRatioConfirmModal } from './price-ratio-confirm-modal';
import { PriceRatioPreviewTable } from './price-ratio-preview-table';
import { PriceRatioStagesPicker } from './price-ratio-stages-picker';

interface PriceRatioToolProps {
  isOpen: boolean;
  onClose: () => void;
  onApplySuccess?: () => void;
}

/**
 * 리스플릿 매입단가 % 일괄 증감 UI
 * - 종목 선택 / 차수 multi-select / 비율(%) 입력 / 미리보기 테이블 / 적용 확인 모달
 *   섹션은 각각 별도 컴포넌트로 분리 — 본 파일은 폼 조립과 mutation 호출만 담당.
 */
export const PriceRatioTool = (props: PriceRatioToolProps): ReactElement | null => {
  const tool = usePriceRatioTool();
  const [isConfirming, setIsConfirming] = useState(false);
  const [showAllStages, setShowAllStages] = useState(true);

  const activeStrategy = trpc.strategy.getActive.useQuery(
    { pdno: tool.pdno },
    { enabled: !!tool.pdno },
  );
  const plan = activeStrategy.data?.profile?.respiitPlan;
  const stageOptions = plan
    ? plan.entries.map((e) => ({ nth: e.nth, buyPrice: e.buyPrice, qty: e.qty }))
    : [];

  const handleGeneratePreview = (): void => {
    tool.generatePreview(plan ?? null);
  };

  const handleApplyClick = (): void => {
    if (tool.preview) {
      setIsConfirming(true);
    }
  };

  const handleConfirmApply = async (): Promise<void> => {
    try {
      await tool.apply();
      setIsConfirming(false);
      props.onApplySuccess?.();
    } catch {
      // error는 tool에서 관리
    }
  };

  const handleStagesAllToggle = (next: boolean): void => {
    setShowAllStages(next);
    if (next) {
      tool.setStages('all');
    }
  };

  if (!props.isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="리스플릿 매입단가 % 일괄 증감"
    >
      <div className="modal panel">
        <div className="panel__title">리스플릿 매입단가 % 일괄 증감</div>
        <div className="panel__body" style={{ display: 'grid', gap: '1rem', padding: '1rem' }}>
          <div>
            <label htmlFor="prr-pdno" style={{ display: 'grid', gap: '0.3rem' }}>
              <span className="muted">종목 (6자리)</span>
              <TextInput
                id="prr-pdno"
                value={tool.pdno ?? ''}
                onChange={(e) => tool.setPdno(e.target.value || null)}
                placeholder="005930"
                maxLength={6}
                dense
              />
            </label>
          </div>

          <PriceRatioStagesPicker
            options={stageOptions}
            showAll={showAllStages}
            selected={tool.stages}
            onToggleAll={handleStagesAllToggle}
            onChangeSelected={tool.setStages}
          />

          <div>
            <label htmlFor="prr-ratio" style={{ display: 'grid', gap: '0.3rem' }}>
              <span className="muted">증감율 (%)</span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <NumberInput
                  id="prr-ratio"
                  value={String(tool.ratioPct)}
                  onValueChange={(v) => tool.setRatioPct(Number(v) || 0)}
                  allowDecimal
                  min="-100"
                  max="100"
                  dense
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                  {tool.ratioPct > 0 ? '+' : ''} {tool.ratioPct}%
                </span>
              </div>
            </label>
          </div>

          {tool.error && (
            <div className="chip chip--down" role="alert">
              {tool.error}
            </div>
          )}

          {tool.preview && (
            <PriceRatioPreviewTable entries={tool.preview.entries} originals={plan?.entries} />
          )}

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button onClick={props.onClose} dense>
              닫기
            </Button>
            <Button onClick={handleGeneratePreview} disabled={!tool.pdno || tool.isLoading} dense>
              미리보기
            </Button>
            <Button
              onClick={handleApplyClick}
              disabled={!tool.preview || tool.isLoading}
              variant="primary"
              dense
            >
              적용
            </Button>
          </div>
        </div>
      </div>

      {isConfirming && tool.preview && (
        <PriceRatioConfirmModal
          count={tool.preview.entries.length}
          ratioPct={tool.ratioPct}
          onCancel={() => setIsConfirming(false)}
          onConfirm={handleConfirmApply}
        />
      )}
    </div>
  );
};
