import { Button, Switch } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useSafetySwitch } from '../model/use-safety-switch';

/**
 * 헤더용 인라인 주문 허용 스위치 — 주문 가능/차단 버튼 + 에러 잠금 인디케이터.
 * panel 래퍼 없이 버튼/칩만 렌더해 헤더 공간을 차지하지 않음.
 */
export const SafetySwitchHeader = (): ReactElement => {
  const { clearErrorLock, clearPending, error, isPending, setMaster, setMasterPending, snapshot } =
    useSafetySwitch();

  if (isPending) {
    return (
      <div className="header-toggle-control header-toggle-control--order">
        <span className="header-toggle-control__label">주문</span>
        <span className="chip" role="status">
          확인중…
        </span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="header-toggle-control header-toggle-control--order">
        <span className="header-toggle-control__label">주문</span>
        <span className="chip chip--down" role="alert" title={error.message}>
          상태 오류
        </span>
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="header-toggle-control header-toggle-control--order">
        <span className="header-toggle-control__label">주문</span>
        <span className="chip chip--down" role="alert">
          상태 미수신
        </span>
      </div>
    );
  }
  const snap = snapshot;
  const errorLocked = snap.errorLock.active;

  const killHotkey = navigator.platform.includes('Mac') ? '⌘⇧K' : 'Ctrl+Shift+K';

  return (
    <div className="header-toggle-control header-toggle-control--order">
      <span className="header-toggle-control__label">주문</span>
      <Switch
        checked={snap.master}
        disabled={errorLocked || setMasterPending}
        onChange={setMaster}
        aria-label={`주문 ${snap.master ? '가능' : '차단'} (즉시 중지: ${killHotkey})`}
        title={`즉시 중지: ${killHotkey}`}
        tone={snap.master ? 'success' : 'danger'}
      />
      <span
        className={
          snap.master
            ? 'header-toggle-control__state'
            : 'header-toggle-control__state header-toggle-control__state--danger'
        }
      >
        {snap.master ? '가능' : '차단'}
      </span>
      <kbd
        title="즉시 중지 단축키"
        style={{
          fontFamily: 'inherit',
          fontSize: '0.85em',
          padding: '0.1rem 0.4rem',
          border: '1px solid var(--border)',
          borderRadius: '0.3rem',
          color: 'var(--fg-2)',
          background: 'var(--bg-2)',
        }}
      >
        {killHotkey}
      </kbd>
      {errorLocked ? (
        <>
          <span className="chip chip--down" role="status">
            에러: {snap.errorLock.reason ?? '원인 불명'}
          </span>
          <Button disabled={clearPending} onClick={clearErrorLock} dense>
            잠금 해제
          </Button>
        </>
      ) : null}
    </div>
  );
};
