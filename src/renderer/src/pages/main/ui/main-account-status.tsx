import type { ReactElement } from 'react';

export const MainAccountLoading = (): ReactElement => (
  <div
    className="muted"
    style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '1.1rem',
    }}
  >
    계좌 확인 중…
  </div>
);

export const MainNoAccount = (): ReactElement => (
  <div
    className="muted"
    style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.6rem',
      fontSize: '1.1rem',
      padding: '1rem',
      textAlign: 'center',
    }}
    role="status"
  >
    <div>활성 계좌가 없습니다.</div>
    <div style={{ fontSize: '0.95rem' }}>
      상단 계좌 바에서 계좌를 추가하거나 선택하면 메인 화면이 표시됩니다.
    </div>
  </div>
);
