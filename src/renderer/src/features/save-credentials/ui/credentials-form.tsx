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
      <div className="panel__body" style={{ display: 'grid', gap: '0.8rem' }}>
        <label style={{ display: 'flex', gap: '1.2rem', alignItems: 'center' }}>
          <span className="muted" style={{ width: '8rem' }}>
            환경
          </span>
          <label>
            <input type="radio" checked={env === 'MOCK'} onChange={() => setEnv('MOCK')} /> 모의투자
          </label>
          <label>
            <input type="radio" checked={env === 'PROD'} onChange={() => setEnv('PROD')} /> 실전
          </label>
        </label>

        <Row label="App Key">
          <input
            className="hts-input"
            value={appKey}
            onChange={(e) => setAppKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            style={{ width: '100%' }}
          />
        </Row>

        <Row label="App Secret">
          <input
            className="hts-input"
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            style={{ width: '100%' }}
          />
        </Row>

        <Row label="계좌 (앞 8자리)">
          <input
            className="hts-input num"
            value={accountNo8}
            onChange={(e) => setAccountNo8(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="12345678"
            inputMode="numeric"
            style={{ width: '16rem' }}
          />
        </Row>

        <Row label="상품코드 (뒤 2자리)">
          <input
            className="hts-input num"
            value={accountProdCd}
            onChange={(e) => setAccountProdCd(e.target.value.replace(/\D/g, '').slice(0, 2))}
            placeholder="01"
            inputMode="numeric"
            style={{ width: '8rem' }}
          />
        </Row>

        {error && (
          <div className="chip chip--down" role="alert">
            {error.message}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button type="submit" className="hts-btn hts-btn--primary" disabled={isPending}>
            {isPending ? '저장 중…' : '저장하고 접속'}
          </button>
        </div>
      </div>
    </form>
  );
};

const Row = ({ label, children }: { label: string; children: ReactElement }): ReactElement => (
  <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'center' }}>
    <span className="muted" style={{ width: '14rem' }}>
      {label}
    </span>
    {children}
  </div>
);
