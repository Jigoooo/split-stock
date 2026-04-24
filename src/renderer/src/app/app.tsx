import { CredentialsReentryBanner } from '@renderer/features/backup-restore';
import { SwitchEnvDialog } from '@renderer/features/switch-env';
import {
  useTradeNotifications,
  useWatchEventNotifications,
} from '@renderer/features/trade-notifications';
import { LoginPage } from '@renderer/pages/login';
import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { readPopoutRoute } from './model/popout-route';
import { useAppShell } from './model/use-app-shell';
import { type PopoutApi, usePopoutState } from './model/use-popout-state';
import { AppProviders } from './providers';
import { AccountBar } from './ui/account-bar';
import { ConnectionStatusDot } from './ui/connection-status-dot';
import { HeaderPopoutButtons } from './ui/header-popout-buttons';
import { PanelWorkspace } from './ui/panel-workspace';
import { PopoutPage } from './ui/popout-page';
import './app.css';

const AppShell = ({ popout }: { popout: PopoutApi }): ReactElement => {
  const shell = useAppShell();

  return (
    <div className="app-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header className="app-header">
        <AccountBar env={shell.env} />
        {shell.env ? (
          <>
            <ConnectionStatusDot />
            <div
              style={{
                display: 'flex',
                gap: '0.6rem',
                marginLeft: '1.2rem',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
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
              <Button onClick={() => shell.logout(false)} disabled={shell.isLoggingOut} dense>
                로그아웃
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
      {shell.isSwitchingEnv ? (
        <div
          className="env-switch-overlay"
          role="status"
          aria-live="polite"
          aria-label="환경 전환 중"
        >
          <div className="env-switch-overlay__panel">
            <div className="env-switch-overlay__spinner" aria-hidden />
            <div className="env-switch-overlay__label">환경 전환 중…</div>
            <div className="env-switch-overlay__hint muted">잠시만 기다려주세요.</div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const AppNotifications = (): null => {
  useWatchEventNotifications();
  useTradeNotifications();
  return null;
};

export const App = (): ReactElement => {
  const popout = usePopoutState();
  const popoutRoute = readPopoutRoute();
  return (
    <AppProviders>
      <AppNotifications />
      {popoutRoute ? (
        <PopoutPage route={popoutRoute} popout={popout} />
      ) : (
        <AppShell popout={popout} />
      )}
    </AppProviders>
  );
};
