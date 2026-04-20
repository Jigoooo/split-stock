import { useSymbolMemo } from '@renderer/entities/symbol-memo';
import { type ReactElement, useState } from 'react';
import { useEditMemo } from '../model/use-edit-memo';

export interface SymbolMemoFormProps {
  pdno: string;
}

/**
 * 종목 메모 편집 폼.
 * - get query로 기존 메모 로드
 * - 저장 버튼 클릭 시 set mutation
 * - 자동 저장 X (명시 저장만)
 */
export const SymbolMemoForm = ({ pdno }: SymbolMemoFormProps): ReactElement => {
  const memoQuery = useSymbolMemo({ pdno });
  const { save, isSaving, lastError } = useEditMemo(pdno);

  const [draft, setDraft] = useState<string | null>(null);
  const serverContent = memoQuery.memo?.content ?? '';
  const value = draft ?? serverContent;
  const dirty = draft !== null && draft !== serverContent;

  return (
    <section
      aria-label={`종목 메모 (${pdno})`}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.6rem' }}
    >
      <label
        htmlFor={`symbol-memo-${pdno}`}
        className="muted"
        style={{ fontSize: '1.1rem', fontWeight: 600 }}
      >
        종목 메모
      </label>
      <textarea
        id={`symbol-memo-${pdno}`}
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        rows={8}
        placeholder="종목 관련 메모를 입력하세요"
        style={{
          fontSize: '1.1rem',
          padding: '0.4rem 0.5rem',
          border: '1px solid var(--hts-line, rgba(0,0,0,0.2))',
          borderRadius: 3,
          fontFamily: 'inherit',
          resize: 'vertical',
          minHeight: '8rem',
        }}
      />
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button
          type="button"
          className="hts-btn"
          disabled={!dirty || isSaving}
          onClick={() => {
            save(value);
            setDraft(null);
          }}
        >
          {isSaving ? '저장 중…' : '저장'}
        </button>
        {dirty && (
          <span className="muted" style={{ fontSize: '1.05rem' }}>
            저장되지 않은 변경
          </span>
        )}
        {lastError && (
          <span className="chip chip--down" role="alert">
            {lastError}
          </span>
        )}
      </div>
    </section>
  );
};
