import { trpc } from '@renderer/shared/api/trpc';
import { Button, RadioGroup, TextInput } from '@renderer/shared/ui';
import type { AppEnv, Credentials } from '@shared/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactElement, useState } from 'react';

export interface AddAccountDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 신규 계좌 추가 다이얼로그 — `account.add` mutation 호출.
 *
 * `auth.setCredentials` 와 동일하게 (env, appKey, appSecret, accountNo8, accountProdCd)
 * 를 받아 자격증명 저장 + accounts upsert 를 수행한다. 활성 계좌는 변경하지 않는다 (UX
 * 일관성: 계좌 전환은 명시적 selector 클릭으로만).
 *
 * 첫 계좌라면 서버 측에서 자동 활성화. 성공 시 listAccounts 만 invalidate.
 */
export const AddAccountDialog = (props: AddAccountDialogProps): ReactElement | null => {
  const { open, onClose } = props;
  const qc = useQueryClient();
  const [env, setEnv] = useState<AppEnv>('MOCK');
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [accountNo8, setAccountNo8] = useState('');
  const [accountProdCd, setAccountProdCd] = useState('01');

  const addMutation = trpc.account.add.useMutation({
    onSuccess: async () => {
      // listAccounts 만 invalidate — 활성 계좌는 그대로이므로 전역 invalidate 불필요.
      await qc.invalidateQueries();
      reset();
      onClose();
    },
  });

  const reset = (): void => {
    setEnv('MOCK');
    setAppKey('');
    setAppSecret('');
    setAccountNo8('');
    setAccountProdCd('01');
  };

  const onCancel = (): void => {
    if (addMutation.isPending) return;
    reset();
    onClose();
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const value: Credentials = { env, appKey, appSecret, accountNo8, accountProdCd };
    addMutation.mutate(value);
  };

  if (!open) return null;

  const canSubmit =
    appKey.length > 0 &&
    appSecret.length > 0 &&
    accountNo8.length === 8 &&
    accountProdCd.length > 0;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="계좌 추가">
      <div className="modal panel" style={{ maxWidth: '44rem' }}>
        <div className="panel__title">계좌 추가</div>
        <form onSubmit={onSubmit}>
          <div className="panel__body" style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'grid', gap: '0.35rem' }}>
              <span className="muted" style={{ fontSize: '1.1rem' }}>
                환경
              </span>
              <RadioGroup
                name="add-account-env"
                ariaLabel="추가 계좌 환경"
                value={env}
                onChange={setEnv}
                dense
                items={[
                  { value: 'MOCK', label: '모의투자', description: '주문 없이 흐름과 시세 점검.' },
                  { value: 'PROD', label: '실전', description: '실제 계좌 — 주문이 체결됩니다.' },
                ]}
              />
            </div>

            <Row label="App Key" inputId="add-account-app-key">
              <TextInput
                id="add-account-app-key"
                value={appKey}
                onChange={(e) => setAppKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                dense
                style={{ width: '100%' }}
              />
            </Row>

            <Row label="App Secret" inputId="add-account-app-secret">
              <TextInput
                id="add-account-app-secret"
                type="password"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                dense
                style={{ width: '100%' }}
              />
            </Row>

            <Row label="계좌 (앞 8자리)" inputId="add-account-no8">
              <TextInput
                id="add-account-no8"
                value={accountNo8}
                onChange={(e) => setAccountNo8(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="12345678"
                inputMode="numeric"
                dense
                className="num"
                style={{ width: '16rem' }}
              />
            </Row>

            <Row label="상품코드 (뒤 2자리)" inputId="add-account-prod-cd">
              <TextInput
                id="add-account-prod-cd"
                value={accountProdCd}
                onChange={(e) => setAccountProdCd(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="01"
                inputMode="numeric"
                dense
                className="num"
                style={{ width: '8rem' }}
              />
            </Row>

            {addMutation.error ? (
              <div className="chip chip--down" role="alert">
                {addMutation.error.message}
              </div>
            ) : null}
          </div>

          <div
            className="panel__body"
            style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}
          >
            <Button onClick={onCancel} disabled={addMutation.isPending} dense type="button">
              취소
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!canSubmit || addMutation.isPending}
              dense
            >
              {addMutation.isPending ? '추가 중…' : '추가'}
            </Button>
          </div>
        </form>
      </div>
    </div>
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
