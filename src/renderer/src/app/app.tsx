import { CredentialsReentryBanner } from '@renderer/features/backup-restore';
import { SafetySwitchPanel, useKillSwitchHotkey } from '@renderer/features/safety-switch';
import { SwitchEnvDialog } from '@renderer/features/switch-env';
import { LoginPage } from '@renderer/pages/login';
import { trpc } from '@renderer/shared/api/trpc';
import { PanelWorkspace, PopoutPage, readPopoutRoute } from '@renderer/widgets/panel-workspace';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { AppProviders } from './providers';
import './app.css';

type EnvValue = 'MOCK' | 'PROD';

const AppShell = (): ReactElement => {
  const utils = trpc.useUtils();
  const envQuery = trpc.auth.getEnv.useQuery();
  const storedQuery = trpc.auth.listStored.useQuery();
  const env = envQuery.data?.env ?? null;
  useKillSwitchHotkey();

  const setEnv = trpc.auth.setEnv.useMutation({
    onSuccess: async () => {
      await utils.auth.getEnv.invalidate();
      await utils.account.getBalance.invalidate();
    },
  });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.auth.getEnv.invalidate();
      await utils.auth.listStored.invalidate();
    },
  });

  const [pendingEnv, setPendingEnv] = useState<EnvValue | null>(null);
  const onSwitchEnv = (next: EnvValue): void => {
    if (next === env) return;
    setPendingEnv(next);
  };
  const onDialogConfirm = (target: EnvValue): void => {
    setEnv.mutate(target, {
      onSettled: () => setPendingEnv(null),
    });
  };

  const onLogout = (clearStored: boolean): void => {
    const msg = clearStored
      ? '저장된 자격증명까지 삭제합니다. 다음에 재로그인 시 App Key/Secret을 다시 입력해야 합니다. 계속할까요?'
      : '현재 환경을 로그아웃합니다. 자격증명은 유지되어 다음에 빠르게 재전환 가능합니다.';
    if (!window.confirm(msg)) return;
    logout.mutate({ clearStored });
  };

  const stored = storedQuery.data?.entries ?? [];

  return (
    <div className="app-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header className="app-header">
        <h1>split-stock</h1>
        {env ? (
          <span
            className={env === 'PROD' ? 'env-badge env-badge--prod' : 'env-badge env-badge--mock'}
          >
            {env}
          </span>
        ) : (
          <span className="chip">연결 안 됨</span>
        )}
        {env ? (
          <nav
            style={{
              display: 'flex',
              gap: '0.6rem',
              marginLeft: '1.6rem',
              alignItems: 'center',
              flex: 1,
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            {stored.length > 1 ? (
              <select
                value={env}
                onChange={(e) => onSwitchEnv(e.target.value as EnvValue)}
                disabled={setEnv.isPending}
                aria-label="환경 전환"
              >
                {stored.map((s) => (
                  <option key={s.env} value={s.env}>
                    {s.env} · {s.accountNo8.slice(-4)}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              className="hts-btn"
              onClick={() => onLogout(false)}
              disabled={logout.isPending}
            >
              로그아웃
            </button>
            <button
              type="button"
              className="hts-btn"
              onClick={() => onLogout(true)}
              disabled={logout.isPending}
              title="저장된 자격증명까지 삭제"
            >
              자격증명 삭제
            </button>
          </nav>
        ) : null}
      </header>
      <main
        className="app-main"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.8rem',
          flex: 1,
          minHeight: 0,
          padding: '0.8rem',
        }}
      >
        {envQuery.isPending ? (
          <div className="muted">초기화 중…</div>
        ) : env ? (
          <>
            <CredentialsReentryBanner />
            <SafetySwitchPanel />
            <PanelWorkspace />
          </>
        ) : (
          <LoginPage />
        )}
      </main>
      <SwitchEnvDialog
        open={pendingEnv !== null}
        target={pendingEnv ?? 'MOCK'}
        pending={setEnv.isPending}
        onConfirm={onDialogConfirm}
        onCancel={() => setPendingEnv(null)}
      />
    </div>
  );
};

export const App = (): ReactElement => {
  const popoutRoute = readPopoutRoute();
  return (
    <AppProviders>
      {popoutRoute ? <PopoutPage route={popoutRoute} /> : <AppShell />}
    </AppProviders>
  );
};
