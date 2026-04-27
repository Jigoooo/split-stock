import { CredentialsForm } from '@renderer/features/save-credentials';
import type { ReactElement } from 'react';

export const LoginPage = (): ReactElement => {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: '3.2rem 2.4rem' }}>
      <div style={{ display: 'grid', gap: '1.4rem', width: '100%', maxWidth: '52rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', margin: 0 }}>접속 정보 설정</h2>
          <p style={{ marginTop: '0.4rem', color: 'var(--fg)', lineHeight: 1.55 }}>
            한국투자증권 API 를 사용하려면 먼저{' '}
            <a
              href="https://apiportal.koreainvestment.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent)', textDecoration: 'underline' }}
            >
              KIS Developers 포털
            </a>
            에서 계정을 등록하고 앱 키(App Key) · 앱 시크릿(App Secret) 을 발급받으세요.
          </p>
          <p className="muted" style={{ marginTop: '0.4rem', fontSize: '0.95rem' }}>
            저장된 값은 OS 보안 저장소(키체인) 에 암호화되어 보관됩니다.
          </p>
        </div>
        <CredentialsForm />
      </div>
    </div>
  );
};
