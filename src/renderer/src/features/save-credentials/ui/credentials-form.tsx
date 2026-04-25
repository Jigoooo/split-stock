import { Button, EnvironmentRadioGroup, TextInput } from '@renderer/shared/ui';
import type { AccountProdCode, AppEnv, Credentials } from '@shared/contracts';
import { type FormEvent, type ReactElement, useState } from 'react';
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
  const [accountNo8, setAccountNo8] = useState('');
  const [accountProdCd, setAccountProdCd] = useState<AccountProdCode>('01');

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const value: Credentials = {
      env,
      appKey,
      appSecret,
      accountNo8,
      accountProdCd,
    };
    try {
      await save(value);
      toast.success(`${env} 자격증명이 저장되었습니다`);
      onSaved?.();
    } catch (err) {
      toast.error(`저장 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
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
          <TextInput
            id="credentials-app-secret"
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            dense
            style={{ width: '100%' }}
          />
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
          <Button type="submit" variant="primary" disabled={isPending}>
            {isPending ? '저장 중…' : '저장하고 접속'}
          </Button>
        </div>
      </div>
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
