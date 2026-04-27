import { trpc } from '@renderer/shared/api/trpc';
import {
  Button,
  EnvironmentRadioGroup,
  FormSection,
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
import { AlertCircle, Eye, EyeOff, Lock, X } from 'lucide-react';
import { type ReactElement, useState } from 'react';

const BROKER_LABEL: Record<BrokerId, string> = { KIS: '한국투자증권', KIWOOM: '키움증권' };
const ENV_LABEL: Record<AppEnv, string> = { MOCK: '모의(MOCK)', PROD: '실전(PROD)' };

/**
 * 계좌 추가 페이지 — 별도 팝아웃 창(`#popout=add-account`)에서 렌더링된다.
 *
 * 디자인: Minimalism + Swiss style — sticky header(현재 선택 요약 + PROD 위험 배너) +
 *         step-카운터 fieldset 4단(증권사/환경/자격증명/계좌정보) + 별칭은 폼 끝(⑤) +
 *         sticky footer(취소 + 추가) 로 항상 액션 접근 가능.
 *
 * `account.add` mutation 호출 → 자격증명 저장 + accounts upsert 수행.
 * 첫 계좌라면 서버 측 자동 활성화, 그 외엔 비활성. 성공 시 query invalidate 후 창 close.
 */
export const AddAccountPage = (): ReactElement => {
  const [broker, setBroker] = useState<BrokerId>('KIS');
  const [env, setEnv] = useState<AppEnv>('MOCK');
  const [displayName, setDisplayName] = useState('');
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [accountNo8, setAccountNo8] = useState('');
  const [accountProdCd, setAccountProdCd] = useState<AccountProdCode>(
    ACCOUNT_PROD_CODE_OPTIONS[0]?.value ?? '01',
  );
  const [kiwoomAccountNo, setKiwoomAccountNo] = useState('');
  const [pendingProdValue, setPendingProdValue] = useState<
    (Credentials & { displayName?: string }) | null
  >(null);

  const addMutation = trpc.account.add.useMutation({
    onSuccess: (data) => {
      window.appShell?.broadcastAccountChanged?.(
        data.accountId,
        data.envSwitched ? { envSwitchedTo: data.env } : undefined,
      );
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

  const isProd = env === 'PROD';

  return (
    <div
      className="add-account-page"
      style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* sticky header — 현재 선택 요약 + PROD 위험 배너 (스크롤해도 항상 보임). */}
        <div className="form-sticky-header">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '1.1rem' }}>계좌 추가</strong>
              <span className="muted" aria-hidden>
                ·
              </span>
              <span className="muted" style={{ fontSize: '0.95rem' }} title="현재 선택 요약">
                {BROKER_LABEL[broker]} · {ENV_LABEL[env]}
              </span>
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={addMutation.isPending}
              aria-label="닫기"
              title="닫기"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '2.6rem',
                height: '2.6rem',
                background: 'transparent',
                border: 'none',
                borderRadius: '0.3rem',
                cursor: addMutation.isPending ? 'not-allowed' : 'pointer',
                color: 'var(--fg)',
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* 본문 — 스크롤 영역. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            display: 'grid',
            gap: '0.5rem',
            padding: '0.6rem 0.75rem',
          }}
        >
          {addMutation.error ? (
            <div className="form-error-alert" role="alert">
              <span className="form-error-alert__icon" aria-hidden>
                <AlertCircle size={16} />
              </span>
              <span>{addMutation.error.message}</span>
            </div>
          ) : null}

          {/* ① 증권사 + ② 환경 — 같은 위계의 결정 항목이므로 grid 2열 묶음 */}
          <div className="form-grid-2col">
            <FormSection number={1} title="증권사 선택">
              <RadioGroup<BrokerId>
                name="add-account-broker"
                ariaLabel="증권사 선택"
                value={broker}
                onChange={setBroker}
                items={[
                  {
                    value: 'KIS',
                    label: <BrokerLabel code="KIS" name="한국투자증권" bg="#003c7c" />,
                    description: '국내 / 해외 / 모의 / 실전',
                  },
                  {
                    value: 'KIWOOM',
                    label: <BrokerLabel code="KW" name="키움증권" bg="#ff5e00" />,
                    description: '국내 / 모의 / 실전 (NXT·SOR 전용)',
                  },
                ]}
              />
            </FormSection>

            {/* ② 환경 — 라디오 자체 색 위계 외 추가 강조는 두지 않음 (사용자 피드백). */}
            <FormSection number={2} title="환경">
              <EnvironmentRadioGroup
                name="add-account-env"
                ariaLabel="추가 계좌 환경"
                value={env}
                onChange={setEnv}
                dense
                mockDescription="주문 없이 흐름과 시세 점검."
                prodDescription="실전 — 실제 계좌, 주문이 즉시 체결됩니다."
              />
            </FormSection>
          </div>

          {/* ③/④ 자격증명 + 계좌정보 — 넓은 창 2열, 좁은 창 단일 */}
          <div className="form-grid-2col">
            <FormSection number={3} title="자격증명">
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

              <Row
                label={broker === 'KIS' ? 'App Secret' : 'Secret Key'}
                inputId="add-account-app-secret"
              >
                <TextInput
                  id="add-account-app-secret"
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
                      aria-label={showSecret ? 'Secret 숨기기' : 'Secret 보이기'}
                      title={showSecret ? '숨기기' : '보이기'}
                    >
                      {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  }
                />
              </Row>
            </FormSection>

            <FormSection number={4} title="계좌 정보">
              {broker === 'KIS' ? (
                <>
                  <Row label="계좌번호 (앞 8자리)" inputId="add-account-no8">
                    <TextInput
                      id="add-account-no8"
                      value={accountNo8}
                      onChange={(e) => setAccountNo8(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder="12345678"
                      inputMode="numeric"
                      dense
                      className="num"
                      style={{ width: '100%' }}
                    />
                  </Row>

                  {ACCOUNT_PROD_CODE_OPTIONS.length > 1 ? (
                    <Row label="상품 유형" inputId="add-account-prod-cd">
                      <Select
                        id="add-account-prod-cd"
                        value={accountProdCd}
                        onChange={(e) => setAccountProdCd(e.target.value as AccountProdCode)}
                        dense
                        style={{ width: '100%' }}
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
                      <span
                        id="add-account-prod-cd-readonly"
                        className="chip"
                        style={{
                          height: '2.1rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                        }}
                      >
                        <Lock size={12} aria-hidden />
                        <span>{ACCOUNT_PROD_CODE_OPTIONS[0]?.label}</span>
                        <span className="muted" style={{ fontSize: '0.85em' }}>
                          (고정값)
                        </span>
                      </span>
                    </Row>
                  )}
                </>
              ) : (
                <Row label="계좌번호 (10자리)" inputId="add-account-kiwoom-no">
                  <TextInput
                    id="add-account-kiwoom-no"
                    value={kiwoomAccountNo}
                    onChange={(e) =>
                      setKiwoomAccountNo(e.target.value.replace(/\D/g, '').slice(0, 10))
                    }
                    placeholder="1234567890"
                    inputMode="numeric"
                    dense
                    className="num"
                    style={{ width: '100%' }}
                  />
                </Row>
              )}
            </FormSection>
          </div>

          {/* ⑤ 별칭 — 부수 정보, 폼 끝에 배치 */}
          <FormSection number={5} title="별칭" help="선택 입력">
            <Row
              label="목록에서 표시될 이름"
              inputId="add-account-display-name"
              hint="비우면 [브로커] 환경 · 끝4자리 자동 라벨"
            >
              <TextInput
                id="add-account-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value.slice(0, 20))}
                placeholder="예: 메인 KIS 실전"
                maxLength={20}
                autoComplete="off"
                spellCheck={false}
                dense
                style={{ width: '100%' }}
              />
            </Row>
          </FormSection>
        </div>

        {/* sticky footer — 스크롤 후에도 액션 항상 보임. */}
        <div className="form-sticky-action-bar">
          <Button onClick={onCancel} disabled={addMutation.isPending} dense type="button">
            취소
          </Button>
          <Button
            type="submit"
            variant={isProd ? 'destructive' : 'primary'}
            disabled={!canSubmit}
            loading={addMutation.isPending}
            loadingText="추가 중…"
            dense
          >
            {isProd ? '실전 계좌 추가' : '추가'}
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
  hint,
}: {
  label: string;
  inputId: string;
  children: ReactElement;
  hint?: string;
}): ReactElement => (
  <label htmlFor={inputId} style={{ display: 'grid', gap: '0.3rem' }}>
    <span style={{ fontSize: '1rem', color: 'var(--fg)', fontWeight: 600 }}>{label}</span>
    {children}
    {hint ? (
      <span className="muted" style={{ fontSize: '0.85rem' }}>
        {hint}
      </span>
    ) : null}
  </label>
);

/** 증권사 색상 배지 + 한국어명. KIS=KIS-네이비, KIWOOM=KW-오렌지. */
const BrokerLabel = ({
  code,
  name,
  bg,
}: {
  code: string;
  name: string;
  bg: string;
}): ReactElement => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '2rem',
        height: '2rem',
        borderRadius: '0.3rem',
        background: bg,
        color: '#fff',
        fontWeight: 700,
        fontSize: '0.9rem',
        letterSpacing: '0.02em',
      }}
    >
      {code}
    </span>
    <span>{name}</span>
  </span>
);
