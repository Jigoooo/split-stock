import type { ReactElement, ReactNode } from 'react';

export interface FormSectionProps {
  /** 섹션 타이틀 — fieldset 의 legend 로 렌더. */
  title: ReactNode;
  /** Step 카운터 (예: 1, 2, 3) — 표시 시 좌측 원형 배지로 렌더. */
  number?: number;
  /** 좌측 leading 아이콘 — number 와 함께 쓰면 number 가 우선. */
  icon?: ReactNode;
  /** 보조 설명 — legend 우측에 muted 텍스트로 노출. */
  help?: ReactNode;
  /** 위험 강조 (PROD 같은 케이스) — 외곽 색을 --up 으로 전환. */
  tone?: 'default' | 'danger';
  children: ReactNode;
}

/**
 * 인증/계좌 등 폼 영역을 시각적으로 그룹화하는 wrapper.
 *
 * - `<fieldset>` + `<legend>` 시맨틱 → 스크린리더에 그룹 의미 전달
 * - 좌측 step 카운터로 진행 위계를 명확히 (Minimalism + Swiss style)
 * - tone='danger' 면 PROD 같은 위험 섹션을 외곽선으로 강조
 */
export const FormSection = ({
  title,
  number,
  icon,
  help,
  tone = 'default',
  children,
}: FormSectionProps): ReactElement => (
  <fieldset
    className={['form-section', tone === 'danger' ? 'form-section--danger' : '']
      .filter(Boolean)
      .join(' ')}
  >
    <legend className="form-section__legend">
      {number !== undefined ? (
        <span className="form-step-number" aria-hidden>
          {number}
        </span>
      ) : icon ? (
        <span className="form-section__icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="form-section__title">{title}</span>
      {help ? <span className="form-section__help">{help}</span> : null}
    </legend>
    <div className="form-section__body">{children}</div>
  </fieldset>
);
