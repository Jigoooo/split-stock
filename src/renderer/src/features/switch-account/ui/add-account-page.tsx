import { trpc } from '@renderer/shared/api/trpc';
import {
  Button,
  EnvironmentRadioGroup,
  ProdConfirmModal,
  RadioGroup,
  Select,
  TextInput,
} from '@renderer/shared/ui';
import {
  ACCOUNT_PROD_CODE_OPTIONS,
  type AccountProdCode,
  type AppEnv,
  type BrokerId,
  type Credentials,
} from '@shared/contracts';
import { type ReactElement, useState } from 'react';

/**
 * 계좌 추가 페이지 — 별도 팝아웃 창(`#popout=add-account`)에서 렌더링된다.
 *
 * `account.add` mutation 호출 → 자격증명 저장 + accounts upsert 수행.
 * 첫 계좌라면 서버 측 자동 활성화, 그 외엔 비활성. 성공 시 query invalidate 후
 * 창을 닫는다.
 */
export const AddAccountPage = (): ReactElement => {
  const [broker, setBroker] = useState<BrokerId>('KIS');
  const [env, setEnv] = useState<AppEnv>('MOCK');
  const [displayName, setDisplayName] = useState('');
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [accountNo8, setAccountNo8] = useState('');
  const [accountProdCd, setAccountProdCd] = useState<AccountProdCode>(
    ACCOUNT_PROD_CODE_OPTIONS[0]?.value ?? '01',
  );
  /** Kiwoom 계좌번호 10자리 — accountNo8(앞 8) + accountProdCd(뒤 2) 로 합쳐 저장. */
  const [kiwoomAccountNo, setKiwoomAccountNo] = useState('');
  const [pendingProdValue, setPendingProdValue] = useState<
    (Credentials & { displayName?: string }) | null
  >(null);

  const addMutation = trpc.account.add.useMutation({
    // 팝아웃의 query client 는 곧 close 되므로 자체 invalidate 는 의미 없음 — broadcast 만 하고
    // 메인 창의 onAccountChanged 리스너가 자기 query client 를 무효화한다.
    onSuccess: (data) => {
      window.appShell?.broadcastAccountChanged?.(data.accountId);
      window.close();
    },
  });

  const onCancel = (): void => {
    if (addMutation.isPending) return;
    window.close();
  };

  const onSubmit = (e: { preventDefault: () => void }): void => {
    e.preventDefault();
    const acntNo8 = broker === 'KIS' ? accountNo8 : kiwoomAccountNo.slice(0, 8);
    const acntProdCd: AccountProdCode = broker === 'KIS' ? accountProdCd : '01';
    const trimmedName = displayName.trim();
    const value: Credentials & { displayName?: string } = {
      env,
      broker,
      appKey,
      appSecret,
      accountNo8: acntNo8,
      accountProdCd: acntProdCd,
      ...(trimmedName.length > 0 ? { displayName: trimmedName } : {}),
    };
    if (value.env === 'PROD') {
      setPendingProdValue(value);
      return;
    }
    addMutation.mutate(value);
  };

  const canSubmit =
    appKey.length > 0 &&
    appSecret.length > 0 &&
    (broker === 'KIS' ? accountNo8.length === 8 : kiwoomAccountNo.length === 10);

  return (
    <div className="add-account-page">
      <form className="add-account-page__form" onSubmit={onSubmit}>
        <div className="add-account-page__body">
          <div className="add-account-page__field">
            <span className="add-account-page__label">증권사</span>
            <RadioGroup<BrokerId>
              name="add-account-broker"
              ariaLabel="증권사 선택"
              value={broker}
              onChange={setBroker}
              items={[
                {
                  value: 'KIS',
                  label: '한국투자증권 (KIS)',
                  description: '국내 / 해외 / 모의 / 실전',
                },
                {
                  value: 'KIWOOM',
                  label: '키움증권 (Kiwoom)',
                  description: '국내 / 모의 / 실전 (NXT/SOR PROD 전용)',
                },
              ]}
            />
          </div>

          <Row label="별칭 (선택)" inputId="add-account-display-name">
            <TextInput
              id="add-account-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, 20))}
              placeholder="예: 메인 KIS 실전"
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              dense
              className="add-account-page__control"
            />
          </Row>

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

          <Row
            label={broker === 'KIS' ? 'App Secret' : 'Secret Key'}
            inputId="add-account-app-secret"
          >
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

          {broker === 'KIS' ? (
            <>
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

              {ACCOUNT_PROD_CODE_OPTIONS.length > 1 ? (
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
              ) : (
                <Row label="상품 유형" inputId="add-account-prod-cd-readonly">
                  <span id="add-account-prod-cd-readonly" className="chip">
                    {ACCOUNT_PROD_CODE_OPTIONS[0]?.label}
                  </span>
                </Row>
              )}
            </>
          ) : (
            <Row label="계좌번호 (10자리)" inputId="add-account-kiwoom-no">
              <TextInput
                id="add-account-kiwoom-no"
                value={kiwoomAccountNo}
                onChange={(e) => setKiwoomAccountNo(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="1234567890"
                inputMode="numeric"
                dense
                className="add-account-page__control num"
              />
            </Row>
          )}

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
            variant={env === 'PROD' ? 'danger' : 'primary'}
            disabled={!canSubmit || addMutation.isPending}
            dense
          >
            {addMutation.isPending ? '추가 중…' : env === 'PROD' ? '실전 계좌 추가' : '추가'}
          </Button>
        </div>
      </form>
      <ProdConfirmModal
        open={pendingProdValue !== null}
        pending={addMutation.isPending}
        title="실전(PROD) 계좌 추가"
        message={
          <strong>
            실전(PROD) 계좌의 자격증명을 OS 키체인에 저장합니다. 첫 계좌라면 자동 활성화됩니다.
          </strong>
        }
        confirmText="실전 계좌 추가"
        onConfirm={() => {
          if (!pendingProdValue) return;
          const value = pendingProdValue;
          setPendingProdValue(null);
          addMutation.mutate(value);
        }}
        onCancel={() => setPendingProdValue(null)}
      />
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
