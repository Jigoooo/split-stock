import { CredentialsForm } from '@renderer/features/save-credentials';
import type { ReactElement } from 'react';

export const LoginPage = (): ReactElement => {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: '3.2rem 2.4rem' }}>
      <div style={{ display: 'grid', gap: '1.4rem', width: '100%', maxWidth: '52rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', margin: 0 }}>접속 정보 설정</h2>
          <p className="muted" style={{ marginTop: '0.4rem' }}>
            한국투자증권 KIS Developers에서 발급받은 App Key와 App Secret을 입력하세요. 저장된 값은
            OS 키체인으로 암호화됩니다.
          </p>
        </div>
        <CredentialsForm />
      </div>
    </div>
  );
};
