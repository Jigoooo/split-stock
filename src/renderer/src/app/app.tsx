import { CredentialsReentryBanner } from '@renderer/features/backup-restore';
import { SafetySwitchHeader } from '@renderer/features/safety-switch';
import { SwitchEnvDialog } from '@renderer/features/switch-env';
import { LoginPage } from '@renderer/pages/login';
import { Button, Select } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { readPopoutRoute } from './model/popout-route';
import { useAppShell } from './model/use-app-shell';
import { type PopoutApi, usePopoutState } from './model/use-popout-state';
import { AppProviders } from './providers';
import { HeaderPopoutButtons } from './ui/header-popout-buttons';
import { PanelWorkspace } from './ui/panel-workspace';
import { PopoutPage } from './ui/popout-page';
import './app.css';

const AppShell = ({ popout }: { popout: PopoutApi }): ReactElement => {
  const shell = useAppShell();

  return (
    <div className="app-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header className="app-header">
        <h1>Split Stock</h1>
        {shell.env ? (
          <span
            className={
              shell.env === 'PROD' ? 'env-badge env-badge--prod' : 'env-badge env-badge--mock'
            }
          >
            {shell.env}
          </span>
        ) : (
          <span className="chip">연결 안 됨</span>
        )}
        {shell.env ? (
          <>
            <div
              style={{
                display: 'flex',
                gap: '0.6rem',
                marginLeft: '1.2rem',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <SafetySwitchHeader />
              <span
                aria-hidden
                style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }}
              />
              <HeaderPopoutButtons popout={popout} />
            </div>
            <nav
              style={{
                display: 'flex',
                gap: '0.6rem',
                marginLeft: 'auto',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              {shell.stored.length > 1 ? (
                <Select
                  value={shell.env}
                  onChange={(e) => shell.requestEnvSwitch(e.target.value as 'MOCK' | 'PROD')}
                  disabled={shell.isSwitchingEnv}
                  aria-label="환경 전환"
                  dense
                  style={{ width: 'auto' }}
                >
                  {shell.stored.map((s) => (
                    <option key={s.env} value={s.env}>
                      {s.env} · {s.accountNo8.slice(-4)}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Button onClick={() => shell.logout(false)} disabled={shell.isLoggingOut} dense>
                로그아웃
              </Button>
              <Button
                onClick={() => shell.logout(true)}
                disabled={shell.isLoggingOut}
                title="저장된 자격증명까지 삭제"
                dense
              >
                자격증명 삭제
              </Button>
            </nav>
          </>
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
        {shell.isInitializing ? (
          <div className="muted">초기화 중…</div>
        ) : shell.env ? (
          <>
            <CredentialsReentryBanner />
            <PanelWorkspace popout={popout} />
          </>
        ) : (
          <LoginPage />
        )}
      </main>
      <SwitchEnvDialog
        open={shell.pendingEnv !== null}
        target={shell.pendingEnv ?? 'MOCK'}
        pending={shell.isSwitchingEnv}
        onConfirm={shell.confirmEnvSwitch}
        onCancel={shell.cancelEnvSwitch}
      />
    </div>
  );
};

export const App = (): ReactElement => {
  const popout = usePopoutState();
  const popoutRoute = readPopoutRoute();
  return (
    <AppProviders>
      {popoutRoute ? (
        <PopoutPage route={popoutRoute} popout={popout} />
      ) : (
        <AppShell popout={popout} />
      )}
    </AppProviders>
  );
};
