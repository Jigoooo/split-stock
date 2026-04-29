import {
  Button,
  EnvironmentRadioGroup,
  FormSection,
  ProdConfirmModal,
  TextInput,
} from '@renderer/shared/ui';
import type { AccountProdCode, AppEnv, Credentials } from '@shared/contracts';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSaveCredentials } from '../model/use-save-credentials';

export interface CredentialsFormProps {
  /** 저장 성공 직후 호출. 다이얼로그 닫기 등에 사용. */
  onSaved?: () => void;
}

export const CredentialsForm = ({ onSaved }: CredentialsFormProps = {}): ReactElement => {
  const { save, isPending, error } = useSaveCredentials();
  const [env, setEnv] = useState<AppEnv>('MOCK');
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [accountNo8, setAccountNo8] = useState('');
  const [accountProdCd, setAccountProdCd] = useState<AccountProdCode>('01');
  const [htsId, setHtsId] = useState('');
  const [pendingProdValue, setPendingProdValue] = useState<Credentials | null>(null);
  const canSubmit =
    appKey.length > 0 && appSecret.length > 0 && accountNo8.length === 8 && !isPending;

  useEffect(() => {
    document.getElementById('credentials-app-key')?.focus();
  }, []);
  // 8자리 입력이 끝나면 자동으로 다음 필드(상품코드)로 포커스 이동.
  useEffect(() => {
    if (accountNo8.length !== 8) return;
    const next = document.getElementById('credentials-account-prod-cd');
    if (
      next instanceof HTMLInputElement &&
      document.activeElement?.id === 'credentials-account-no8'
    ) {
      next.focus();
      next.select();
    }
  }, [accountNo8]);

  const performSave = async (value: Credentials): Promise<void> => {
    try {
      await save(value);
      toast.success(`${value.env} 자격증명이 저장되었습니다`);
      onSaved?.();
    } catch (err) {
      toast.error(`저장 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onSubmit = async (e: { preventDefault: () => void }): Promise<void> => {
    e.preventDefault();
    const value: Credentials = {
      env,
      broker: 'KIS',
      appKey,
      appSecret,
      accountNo8,
      accountProdCd,
      ...(htsId.trim().length > 0 ? { htsId: htsId.trim() } : {}),
    };
    if (value.env === 'PROD') {
      setPendingProdValue(value);
      return;
    }
    await performSave(value);
  };

  const isProd = env === 'PROD';

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      style={{ display: 'grid', gap: '0.85rem' }}
    >
      {/* 에러는 폼 상단 sticky 로 띄움 — 입력 위치에서 즉시 보임. */}
      {error ? (
        <div className="form-error-alert" role="alert">
          <span className="form-error-alert__icon" aria-hidden>
            <AlertCircle size={16} />
          </span>
          <span>{error.message}</span>
        </div>
      ) : null}

      {/* ① 환경 — 라디오 자체 색 위계 외 추가 강조는 두지 않음 (사용자 피드백). */}
      <FormSection number={1} title="환경 선택">
        <EnvironmentRadioGroup
          name="credentials-env"
          ariaLabel="접속 환경"
          value={env}
          onChange={setEnv}
          dense
          mockDescription="모의투자 — 가상 자금으로 흐름 점검."
          prodDescription="실전 — 실제 계좌, 주문이 즉시 체결됩니다."
        />
      </FormSection>

      {/* ② API 자격증명 */}
      <FormSection number={2} title="API 자격증명">
        <Row label="App Key" inputId="credentials-app-key">
          <TextInput
            id="credentials-app-key"
            value={appKey}
            onChange={(e) => setAppKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            dense
            style={{ width: '100%' }}
          />
        </Row>

        <Row label="App Secret" inputId="credentials-app-secret">
          <TextInput
            id="credentials-app-secret"
            type={showSecret ? 'text' : 'password'}
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            dense
            style={{ width: '100%' }}
            suffix={
              <button
                type="button"
                onClick={() => setShowSecret((prev) => !prev)}
                aria-pressed={showSecret}
                aria-label={showSecret ? 'App Secret 숨기기' : 'App Secret 보이기'}
                title={showSecret ? '숨기기' : '보이기'}
              >
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            }
          />
        </Row>
      </FormSection>

      {/* ③ 계좌 정보 */}
      <FormSection number={3} title="계좌 정보">
        <Row
          label="계좌번호 앞 8자리"
          inputId="credentials-account-no8"
          hint="계좌번호 10자리 중 앞쪽 8자리"
        >
          <TextInput
            id="credentials-account-no8"
            value={accountNo8}
            onChange={(e) => setAccountNo8(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="12345678"
            inputMode="numeric"
            dense
            className="num"
            style={{ width: '16rem' }}
          />
        </Row>

        <Row
          label="상품코드 (계좌번호 끝 2자리)"
          inputId="credentials-account-prod-cd"
          hint="대부분 01 — 종합매매계좌 기준"
        >
          <TextInput
            id="credentials-account-prod-cd"
            value={accountProdCd}
            onChange={(e) =>
              setAccountProdCd(
                (e.target.value.replace(/\D/g, '').slice(0, 2) || '01') as AccountProdCode,
              )
            }
            placeholder="01"
            inputMode="numeric"
            dense
            className="num"
            style={{ width: '8rem' }}
          />
        </Row>

        <Row label="HTS ID" inputId="credentials-hts-id">
          <TextInput
            id="credentials-hts-id"
            value={htsId}
            onChange={(e) => setHtsId(e.target.value.trim().slice(0, 32))}
            autoComplete="off"
            spellCheck={false}
            dense
            style={{ width: '16rem' }}
          />
        </Row>
      </FormSection>

      {/* 액션 — submit 버튼은 PROD 면 destructive(진한 빨강) 위계로 차등. */}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Button
          type="submit"
          variant={isProd ? 'destructive' : 'primary'}
          disabled={!canSubmit}
          loading={isPending}
          loadingText="저장 중…"
          style={{ whiteSpace: 'nowrap' }}
        >
          {isProd ? '실전 자격증명 저장' : '저장하고 접속'}
        </Button>
      </div>

      <ProdConfirmModal
        open={pendingProdValue !== null}
        pending={isPending}
        title="실전(PROD) 자격증명 저장"
        message={
          <strong>실전(PROD) 환경의 App Key/Secret 을 OS 키체인에 저장하고 활성화합니다.</strong>
        }
        confirmText="실전 자격증명 저장"
        onConfirm={() => {
          if (!pendingProdValue) return;
          const value = pendingProdValue;
          setPendingProdValue(null);
          void performSave(value);
        }}
        onCancel={() => setPendingProdValue(null)}
      />
    </form>
  );
};

const Row = ({
  label,
  inputId,
  children,
  hint,
}: {
  label: string;
  inputId: string;
  children: ReactElement;
  hint?: string;
}): ReactElement => (
  <label htmlFor={inputId} style={{ display: 'grid', gap: '0.35rem' }}>
    <span style={{ fontSize: '1rem', color: 'var(--fg)', fontWeight: 600 }}>{label}</span>
    {children}
    {hint ? (
      <span className="muted" style={{ fontSize: '0.9rem' }}>
        {hint}
      </span>
    ) : null}
  </label>
);
