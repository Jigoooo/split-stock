import { trpc } from '@renderer/shared/api/trpc';
import { Button, EnvironmentRadioGroup, Select, TextInput } from '@renderer/shared/ui';
import {
  ACCOUNT_PROD_CODE_OPTIONS,
  type AccountProdCode,
  type AppEnv,
  type Credentials,
} from '@shared/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactElement, useState } from 'react';

/**
 * 계좌 추가 페이지 — 별도 팝아웃 창(`#popout=add-account`)에서 렌더링된다.
 *
 * `account.add` mutation 호출 → 자격증명 저장 + accounts upsert 수행.
 * 첫 계좌라면 서버 측 자동 활성화, 그 외엔 비활성. 성공 시 query invalidate 후
 * 창을 닫는다.
 */
export const AddAccountPage = (): ReactElement => {
  const qc = useQueryClient();
  const [env, setEnv] = useState<AppEnv>('MOCK');
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [accountNo8, setAccountNo8] = useState('');
  const [accountProdCd, setAccountProdCd] = useState<AccountProdCode>(
    ACCOUNT_PROD_CODE_OPTIONS[0]?.value ?? '01',
  );

  const addMutation = trpc.account.add.useMutation({
    onSuccess: async (data) => {
      await qc.invalidateQueries();
      // 메인 창에 성공 브로드캐스트 — 메인이 listAccounts 재조회 + 토스트.
      window.appShell?.broadcastAccountChanged?.(data.accountId);
      window.close();
    },
  });

  const onCancel = (): void => {
    if (addMutation.isPending) return;
    window.close();
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const value: Credentials = { env, appKey, appSecret, accountNo8, accountProdCd };
    addMutation.mutate(value);
  };

  const canSubmit = appKey.length > 0 && appSecret.length > 0 && accountNo8.length === 8;

  return (
    <div className="add-account-page">
      <form className="add-account-page__form" onSubmit={onSubmit}>
        <div className="add-account-page__body">
          <div className="add-account-page__field">
            <span className="add-account-page__label">환경</span>
            <EnvironmentRadioGroup
              name="add-account-env"
              ariaLabel="추가 계좌 환경"
              value={env}
              onChange={setEnv}
              dense
              mockDescription="주문 없이 흐름과 시세 점검."
              prodDescription="실제 계좌 - 주문이 체결됩니다."
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
              className="add-account-page__control"
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
              className="add-account-page__control"
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
              className="add-account-page__control num"
            />
          </Row>

          <Row label="상품 유형" inputId="add-account-prod-cd">
            <Select
              id="add-account-prod-cd"
              value={accountProdCd}
              onChange={(e) => setAccountProdCd(e.target.value as AccountProdCode)}
              dense
              className="add-account-page__control"
            >
              {ACCOUNT_PROD_CODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </Row>

          {addMutation.error ? (
            <div className="chip chip--down" role="alert">
              {addMutation.error.message}
            </div>
          ) : null}
        </div>

        <div className="add-account-page__actions">
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
  <div className="add-account-page__field">
    <label className="add-account-page__label" htmlFor={inputId}>
      {label}
    </label>
    {children}
  </div>
);
