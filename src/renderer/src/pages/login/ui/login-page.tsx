import { CredentialsForm } from '@renderer/features/save-credentials';
import { ExternalLink, Lock, TrendingUp } from 'lucide-react';
import type { ReactElement } from 'react';

/**
 * 첫 진입 화면 — 신뢰 신호 (브랜드 + KIS Developers 외부링크 + OS 키체인) 를 폼 위에 배치.
 *
 * 디자인 원칙: Minimalism + Swiss style — 큰 H1 위계, 명확한 CTA 라인, 하단 신뢰 푸터로
 * "이 앱이 안전하다" 는 심리적 안정감 부여.
 */
export const LoginPage = (): ReactElement => {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: '2.4rem 2rem' }}>
      <div style={{ display: 'grid', gap: '1.4rem', width: '100%', maxWidth: '52rem' }}>
        {/* 브랜드 헤더 — 우측 상단 작은 식별자. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            color: 'var(--accent)',
            fontWeight: 700,
            fontSize: '0.95rem',
            letterSpacing: '0.02em',
          }}
        >
          <TrendingUp size={16} aria-hidden />
          <span>split-stock</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            · 매직스플릿 · 한국투자증권
          </span>
        </div>

        {/* H1 + lead text + 액션 라인 (Trust & Authority 패턴). */}
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <h1 style={{ fontSize: '1.6rem', margin: 0, fontWeight: 700, letterSpacing: '-0.01em' }}>
            접속 정보 설정
          </h1>
          <p style={{ margin: 0, color: 'var(--fg)', lineHeight: 1.55, fontSize: '1rem' }}>
            처음이신가요? KIS Developers 포털에서 5분이면 앱 키 발급이 끝납니다.
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.85rem',
              flexWrap: 'wrap',
              fontSize: '0.95rem',
            }}
          >
            <a
              href="https://apiportal.koreainvestment.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                color: 'var(--accent)',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              <ExternalLink size={13} aria-hidden />
              KIS Developers 포털 열기
            </a>
            <span className="muted" aria-hidden>
              ·
            </span>
            <span className="muted">앱 키 (App Key) · 앱 시크릿 (App Secret) 발급 필요</span>
          </div>
        </div>

        {/* 폼 본체 — 내부에서 step-카운터 fieldset 3개 + sticky error 처리. */}
        <CredentialsForm />

        {/* 신뢰 푸터 — Lock 아이콘 + OS 보안 저장소 안내. */}
        <div className="form-trust-footer">
          <span className="form-trust-footer__icon" aria-hidden>
            <Lock size={14} />
          </span>
          <span>
            저장된 값은 OS 보안 저장소(키체인) 에 암호화되어 보관됩니다 — 앱 외부에서 접근할 수
            없습니다.
          </span>
        </div>
      </div>
    </div>
  );
};
