import { useDialogFocus } from '@renderer/shared/lib/interaction';
import { Button } from '@renderer/shared/ui';
import { X } from 'lucide-react';
import { type ReactElement, useRef } from 'react';
import type { AddWatchOrderFormController } from '../model/use-add-watch-order-form-controller';
import {
  ExecutionConditionsSection,
  WatchConditionsSection,
} from './add-watch-order-dialog-sections';

interface AddWatchOrderDialogContentProps {
  controller: AddWatchOrderFormController;
  layout: 'modal' | 'page';
  onClose: () => void;
}

export const AddWatchOrderDialogContent = ({
  controller,
  layout,
  onClose,
}: AddWatchOrderDialogContentProps): ReactElement => {
  const isPageLayout = layout === 'page';
  const modalRef = useRef<HTMLDivElement | null>(null);
  const isDense = !isPageLayout;
  const titleText = controller.isEdit ? '자동감시 수정' : '자동감시 추가';
  const chromePadding = isPageLayout ? '1rem 1.2rem' : '0.75rem 0.9rem';
  const bodyPadding = isPageLayout ? '1.1rem 1.2rem' : '0.9rem';
  const bodyGap = isPageLayout ? '1.15rem' : '0.85rem';
  useDialogFocus({
    enabled: !isPageLayout,
    rootRef: modalRef,
    onEscape: controller.isPending ? undefined : onClose,
  });

  const content = (
    <div
      ref={modalRef}
      className={`panel add-watch-order-dialog${layout === 'page' ? ' add-watch-order-page' : ' modal'}`}
      tabIndex={isPageLayout ? undefined : -1}
      style={
        isPageLayout
          ? {
              width: '100%',
              borderRadius: 0,
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
              background: 'var(--bg)',
            }
          : {
              width: 'min(1180px, 96vw)',
              maxHeight: 'min(88vh, 820px)',
              overflow: 'auto',
              borderRadius: '0.65rem',
              background: 'var(--bg)',
              border: '0.1rem solid var(--border)',
              boxShadow: '0 1.2rem 3rem rgba(15, 23, 42, 0.18)',
            }
      }
    >
      {isPageLayout ? null : (
        <div
          className="panel__title"
          style={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            gap: '0.6rem',
            padding: chromePadding,
            fontSize: '0.95rem',
            borderBottom: '0.1rem solid var(--border)',
            background: 'var(--bg)',
          }}
        >
          <span style={{ fontWeight: 800 }}>{titleText}</span>
          <Button
            variant="ghost"
            iconOnly
            dense
            iconLeading={<X size={14} />}
            onClick={onClose}
            disabled={controller.isPending}
            aria-label="닫기"
            title="닫기"
          />
        </div>
      )}
      <div
        className="panel__body"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(30rem, 100%), 1fr))',
          gap: bodyGap,
          alignItems: 'start',
          flex: 1,
          minHeight: 0,
          padding: bodyPadding,
        }}
      >
        <WatchConditionsSection
          draft={controller.draft}
          draftError={controller.draftError}
          pdno={controller.pdno}
          pdName={controller.pdName}
          targetPriceRaw={controller.targetPriceRaw}
          targetPriceDistancePct={controller.targetPriceDistancePct}
          targetPriceImmediateWarning={controller.targetPriceImmediateWarning}
          expiresAtIso={controller.expiresAtIso}
          todayIso={controller.todayIso}
          isPageLayout={isPageLayout}
          isDraftLoading={controller.isDraftLoading}
          isDense={isDense}
          isPending={controller.isPending}
          errors={controller.errors}
          selectedPriceCandidateId={controller.selectedPriceCandidateId}
          onApplyPriceCandidate={controller.applyPriceCandidate}
          setTargetPriceRaw={controller.setTargetPriceRaw}
          setExpiresAtIso={controller.setExpiresAtIso}
          onPickStock={controller.onPickStock}
          onPickExpiry={controller.onPickExpiry}
        />
        <ExecutionConditionsSection
          orderType={controller.orderType}
          qtyMode={controller.qtyMode}
          qtyRaw={controller.qtyRaw}
          amountKrwRaw={controller.amountKrwRaw}
          targetPriceRaw={controller.targetPriceRaw}
          currentPrice={controller.currentPrice}
          pdName={controller.pdName}
          pdno={controller.pdno}
          targetPriceDistancePct={controller.targetPriceDistancePct}
          isPageLayout={isPageLayout}
          isDense={isDense}
          isPending={controller.isPending}
          errors={controller.errors}
          setOrderType={controller.setOrderType}
          setQtyMode={controller.setQtyMode}
          setQtyRaw={controller.setQtyRaw}
          setAmountKrwRaw={controller.setAmountKrwRaw}
          onAmountQuick={controller.onAmountQuick}
          onAmountReset={controller.onAmountReset}
        />
      </div>
      <AddWatchOrderDialogMessage
        error={controller.error}
        isEdit={controller.isEdit}
        isPageLayout={isPageLayout}
        padding={chromePadding}
      />
      <div
        className="panel__body"
        style={{
          display: 'flex',
          gap: isPageLayout ? '0.6rem' : '0.5rem',
          justifyContent: 'flex-end',
          padding: chromePadding,
        }}
      >
        <Button onClick={onClose} disabled={controller.isPending} dense={isDense}>
          취소
        </Button>
        <Button
          onClick={() => {
            void controller.onSubmit();
          }}
          disabled={controller.isPending}
          variant="primary"
          dense={isDense}
        >
          {controller.isPending ? '저장 중…' : controller.isEdit ? '수정' : '추가'}
        </Button>
      </div>
    </div>
  );

  if (layout === 'page') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titleText}
        style={{ width: '100%', overflow: 'auto' }}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={titleText}
      onClick={(event) => {
        if (event.target !== event.currentTarget || controller.isPending) return;
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || controller.isPending) return;
        event.preventDefault();
        onClose();
      }}
    >
      {content}
    </div>
  );
};

function AddWatchOrderDialogMessage({
  error,
  isEdit,
  isPageLayout,
  padding,
}: {
  error: string | null;
  isEdit: boolean;
  isPageLayout: boolean;
  padding: string;
}): ReactElement | null {
  if (!isEdit && !error) return null;

  return (
    <div
      className="panel__body"
      style={{ display: 'grid', gap: isPageLayout ? '0.45rem' : '0.3rem', padding }}
    >
      {isEdit ? (
        <div className="muted" style={{ fontSize: isPageLayout ? '0.9rem' : '0.8rem' }}>
          ※ 수정 시 예약매수 조건만 갱신되며, 감시 이력은 유지됩니다.
        </div>
      ) : null}
      {error ? (
        <div className="chip chip--down" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
