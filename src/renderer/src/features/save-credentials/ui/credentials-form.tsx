import { Button, EnvironmentRadioGroup, ProdConfirmModal, TextInput } from '@renderer/shared/ui';
import type { AccountProdCode, AppEnv, Credentials } from '@shared/contracts';
import { type FormEvent, type ReactElement, useEffect, useState } from 'react';
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
  const [pendingProdValue, setPendingProdValue] = useState<Credentials | null>(null);
  const canSubmit =
    appKey.length > 0 && appSecret.length > 0 && accountNo8.length === 8 && !isPending;
  useEffect(() => {
    document.getElementById('credentials-app-key')?.focus();
  }, []);

  const performSave = async (value: Credentials): Promise<void> => {
    try {
      await save(value);
      toast.success(`${value.env} 자격증명이 저장되었습니다`);
      onSaved?.();
    } catch (err) {
      toast.error(`저장 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const value: Credentials = {
      env,
      broker: 'KIS',
      appKey,
      appSecret,
      accountNo8,
      accountProdCd,
    };
    if (value.env === 'PROD') {
      setPendingProdValue(value);
      return;
    }
    await performSave(value);
  };

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className="panel"
      style={{ maxWidth: '44rem' }}
    >
      <div className="panel__title">한국투자증권 자격증명</div>
      <div className="panel__body" style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'grid', gap: '0.35rem' }}>
          <span className="muted" style={{ fontSize: '1.1rem' }}>
            환경
          </span>
          <EnvironmentRadioGroup
            name="credentials-env"
            ariaLabel="접속 환경"
            value={env}
            onChange={setEnv}
            dense
          />
        </div>

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
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'stretch' }}>
            <TextInput
              id="credentials-app-secret"
              type={showSecret ? 'text' : 'password'}
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              dense
              style={{ width: '100%' }}
            />
            <Button
              type="button"
              dense
              onClick={() => setShowSecret((prev) => !prev)}
              aria-pressed={showSecret}
              aria-label={showSecret ? 'App Secret 숨기기' : 'App Secret 보이기'}
            >
              {showSecret ? '숨김' : '표시'}
            </Button>
          </div>
        </Row>

        <Row label="계좌 (앞 8자리)" inputId="credentials-account-no8">
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

        <Row label="상품코드 (뒤 2자리)" inputId="credentials-account-prod-cd">
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

        {error && (
          <div className="chip chip--down" role="alert">
            {error.message}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <Button
            type="submit"
            variant={env === 'PROD' ? 'danger' : 'primary'}
            disabled={!canSubmit}
          >
            {isPending ? '저장 중…' : env === 'PROD' ? '실전 자격증명 저장' : '저장하고 접속'}
          </Button>
        </div>
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
}: {
  label: string;
  inputId: string;
  children: ReactElement;
}): ReactElement => (
  <label htmlFor={inputId} style={{ display: 'grid', gap: '0.35rem' }}>
    <span className="muted" style={{ fontSize: '1.1rem' }}>
      {label}
    </span>
    {children}
  </label>
);
