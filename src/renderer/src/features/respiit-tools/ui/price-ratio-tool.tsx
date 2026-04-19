import { trpc } from '@renderer/shared/api/trpc';
import { Button, Dialog, NumberInput, TextInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { usePriceRatioTool } from '../model/use-price-ratio-tool';

interface PriceRatioToolProps {
  isOpen: boolean;
  onClose: () => void;
  onApplySuccess?: () => void;
}

/**
 * 리스플릿 매입단가 % 일괄 증감 UI
 * - 종목 선택 (현재 활성 전략에서)
 * - 차수 multi-select (또는 "전체")
 * - 비율(%) 입력
 * - 미리보기 테이블
 * - 적용 버튼 → 확인 모달
 */
export const PriceRatioTool = (props: PriceRatioToolProps): ReactElement => {
  const tool = usePriceRatioTool();
  const [isConfirming, setIsConfirming] = useState(false);
  const [showAllStages, setShowAllStages] = useState(true);

  // 활성 전략 조회 (pdno 리스트 및 respiitPlan 확인용)
  const activeStrategy = trpc.strategy.getActive.useQuery(
    { pdno: tool.pdno },
    { enabled: !!tool.pdno },
  );

  const plan = activeStrategy.data?.profile?.respiitPlan;

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

  const stageOptions = plan
    ? plan.entries.map((e) => ({
        nth: e.nth,
        buyPrice: e.buyPrice,
        qty: e.qty,
      }))
    : [];

  return (
    <Dialog isOpen={props.isOpen} onClose={props.onClose} title="리스플릿 매입단가 % 일괄 증감">
      <div style={{ display: 'grid', gap: '1rem', padding: '1rem' }}>
        {/* 종목 선택 */}
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

        {/* 차수 선택 */}
        {stageOptions.length > 0 && (
          <div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span className="muted">적용 차수</span>
              <label
                style={{
                  display: 'flex',
                  gap: '0.3rem',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={showAllStages}
                  onChange={(e) => {
                    setShowAllStages(e.target.checked);
                    if (e.target.checked) {
                      tool.setStages('all');
                    }
                  }}
                />
                <span style={{ fontSize: '0.9rem' }}>전체</span>
              </label>
            </div>
            {!showAllStages && (
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
                {stageOptions.map((stage) => (
                  <label
                    key={stage.nth}
                    style={{
                      display: 'flex',
                      gap: '0.3rem',
                      alignItems: 'center',
                      cursor: 'pointer',
                      padding: '0.3rem 0.5rem',
                      borderRadius: '0.2rem',
                      backgroundColor: 'var(--color-input-bg)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={(tool.stages !== 'all' && tool.stages.includes(stage.nth)) ?? false}
                      onChange={(e) => {
                        if (tool.stages === 'all') return;
                        const updated = e.target.checked
                          ? [...tool.stages, stage.nth]
                          : tool.stages.filter((s) => s !== stage.nth);
                        tool.setStages(updated.sort((a, b) => a - b));
                      }}
                    />
                    <span style={{ fontSize: '0.9rem' }}>
                      {stage.nth}차 ({stage.qty.toLocaleString()}주 @
                      {stage.buyPrice.toLocaleString()}원)
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 비율 입력 */}
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

        {/* 에러 표시 */}
        {tool.error && (
          <div className="chip chip--down" role="alert">
            {tool.error}
          </div>
        )}

        {/* 미리보기 테이블 */}
        {tool.preview && (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                fontSize: '0.9rem',
                borderCollapse: 'collapse',
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>차수</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>변경 전</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>변경 후</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>수량</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>소계</th>
                </tr>
              </thead>
              <tbody>
                {tool.preview.entries.map((entry, idx) => {
                  const original = plan?.entries[idx];
                  return (
                    <tr
                      key={entry.nth}
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        backgroundColor:
                          original?.buyPrice !== entry.buyPrice ? 'var(--color-highlight-bg)' : '',
                      }}
                    >
                      <td style={{ textAlign: 'left', padding: '0.5rem' }}>{entry.nth}차</td>
                      <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                        {original?.buyPrice.toLocaleString()}원
                      </td>
                      <td style={{ textAlign: 'right', padding: '0.5rem', fontWeight: 'bold' }}>
                        {entry.buyPrice.toLocaleString()}원
                      </td>
                      <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                        {entry.qty.toLocaleString()}주
                      </td>
                      <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                        {entry.amountKrw.toLocaleString()}원
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 버튼 */}
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

      {/* 확인 모달 */}
      {isConfirming && tool.preview && (
        <Dialog isOpen={isConfirming} onClose={() => setIsConfirming(false)} title="적용 확인">
          <div style={{ padding: '1rem', display: 'grid', gap: '1rem' }}>
            <p>
              <strong>{tool.preview.entries.length}</strong>개 차수의 매입단가를{' '}
              <strong>
                {tool.ratioPct > 0 ? '+' : ''}
                {tool.ratioPct}%
              </strong>{' '}
              변경하시겠습니까?
            </p>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
              - 자동매매는 자동으로 OFF됩니다
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <Button onClick={() => setIsConfirming(false)} dense>
                취소
              </Button>
              <Button onClick={handleConfirmApply} variant="primary" dense>
                확인
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
};
