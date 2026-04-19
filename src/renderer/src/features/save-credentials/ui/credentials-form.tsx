import { Button, RadioGroup, TextInput } from '@renderer/shared/ui';
import type { AppEnv, Credentials } from '@shared/contracts';
import { type FormEvent, type ReactElement, useState } from 'react';
import { useSaveCredentials } from '../model/use-save-credentials';

export const CredentialsForm = (): ReactElement => {
  const { save, isPending, error } = useSaveCredentials();
  const [env, setEnv] = useState<AppEnv>('MOCK');
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [accountNo8, setAccountNo8] = useState('');
  const [accountProdCd, setAccountProdCd] = useState('01');

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const value: Credentials = {
      env,
      appKey,
      appSecret,
      accountNo8,
      accountProdCd,
    };
    void save(value);
  };

  return (
    <form onSubmit={onSubmit} className="panel" style={{ maxWidth: '44rem' }}>
      <div className="panel__title">한국투자증권 자격증명</div>
      <div className="panel__body" style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'grid', gap: '0.35rem' }}>
          <span className="muted" style={{ fontSize: '1.1rem' }}>
            환경
          </span>
          <RadioGroup
            name="credentials-env"
            ariaLabel="접속 환경"
            value={env}
            onChange={setEnv}
            dense
            items={[
              {
                value: 'MOCK',
                label: '모의투자',
                description: '주문 없이 흐름과 시세를 점검합니다.',
              },
              {
                value: 'PROD',
                label: '실전',
                description: '실제 계좌로 주문이 체결됩니다.',
              },
            ]}
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
            onChange={(e) => setAccountProdCd(e.target.value.replace(/\D/g, '').slice(0, 2))}
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
