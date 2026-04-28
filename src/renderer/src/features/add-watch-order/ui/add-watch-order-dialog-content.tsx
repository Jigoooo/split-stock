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
  const chromePadding = isPageLayout ? '0.9rem 1.1rem' : '0.35rem 0.6rem';
  const bodyPadding = isPageLayout ? '1rem 1.1rem' : '0.4rem 0.6rem';
  const bodyGap = isPageLayout ? '1rem 1.5rem' : '0.5rem 0.8rem';
  useDialogFocus({
    enabled: !isPageLayout,
    rootRef: modalRef,
    onEscape: controller.isPending ? undefined : onClose,
  });

  const content = (
    <div
      ref={modalRef}
      className={`panel${layout === 'page' ? ' add-watch-order-page' : ' modal'}`}
      tabIndex={isPageLayout ? undefined : -1}
      style={
        isPageLayout
          ? {
              width: '100%',
              borderRadius: 0,
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
            }
          : { minWidth: 'min(600px, 92vw)', maxWidth: '720px', width: 'min(600px, 92vw)' }
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
            fontSize: '1rem',
          }}
        >
          <span>{titleText}</span>
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
          gridTemplateColumns: '1fr 1fr',
          gap: bodyGap,
          alignItems: 'start',
          flex: 1,
          minHeight: 0,
          padding: bodyPadding,
        }}
      >
        <WatchConditionsSection
          pdno={controller.pdno}
          pdName={controller.pdName}
          targetPriceRaw={controller.targetPriceRaw}
          expiresAtIso={controller.expiresAtIso}
          todayIso={controller.todayIso}
          isPageLayout={isPageLayout}
          isDense={isDense}
          isPending={controller.isPending}
          errors={controller.errors}
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
