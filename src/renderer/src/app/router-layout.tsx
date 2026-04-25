import { CredentialsReentryBanner } from '@renderer/features/backup-restore';
import { SwitchEnvDialog } from '@renderer/features/switch-env';
import {
  useTradeNotifications,
  useWatchEventNotifications,
} from '@renderer/features/trade-notifications';
import { LoginPage } from '@renderer/pages/login';
import { Button } from '@renderer/shared/ui';
import { Navigate, Outlet } from '@tanstack/react-router';
import type { ReactElement, ReactNode } from 'react';
import { isPopoutRoute, type PopoutRoute } from './model/popout-route';
import { useAppShell } from './model/use-app-shell';
import { type PopoutApi, usePopoutState } from './model/use-popout-state';
import { AccountBar } from './ui/account-bar';
import { ConnectionStatusDot } from './ui/connection-status-dot';
import { HeaderPopoutButtons } from './ui/header-popout-buttons';
import { PanelWorkspace } from './ui/panel-workspace';
import { PopoutPage } from './ui/popout-page';

interface AppShellFrameProps {
  children: ReactNode;
  popout?: PopoutApi;
  shell: ReturnType<typeof useAppShell>;
}

const AppNotifications = (): null => {
  useWatchEventNotifications();
  useTradeNotifications();
  return null;
};

const ShellLoading = (): ReactElement => <div className="muted">초기화 중…</div>;

const AppShellFrame = ({ children, popout, shell }: AppShellFrameProps): ReactElement => {
  return (
    <div className="app-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header className="app-header">
        <AccountBar env={shell.env} />
        {shell.env && popout ? (
          <>
            <div className="app-header__section app-header__section--connection">
              <ConnectionStatusDot />
            </div>
            <div className="app-header__section app-header__section--tools">
              <span className="app-header__section-label">메뉴</span>
              <HeaderPopoutButtons popout={popout} />
            </div>
            <nav className="app-header__section app-header__section--session">
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
        {children}
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

export const RootRouteLayout = (): ReactElement => {
  return (
    <>
      <AppNotifications />
      <Outlet />
    </>
  );
};

export const IndexRoutePage = (): ReactElement => {
  const shell = useAppShell();

  if (shell.isInitializing) {
    return (
      <AppShellFrame shell={shell}>
        <ShellLoading />
      </AppShellFrame>
    );
  }

  return <Navigate to={shell.env ? '/main' : '/login'} replace />;
};

export const LoginRoutePage = (): ReactElement => {
  const shell = useAppShell();

  if (shell.isInitializing) {
    return (
      <AppShellFrame shell={shell}>
        <ShellLoading />
      </AppShellFrame>
    );
  }

  if (shell.env) {
    return <Navigate to="/main" replace />;
  }

  return (
    <AppShellFrame shell={shell}>
      <LoginPage />
    </AppShellFrame>
  );
};

export const MainRoutePage = (): ReactElement => {
  const shell = useAppShell();
  const popout = usePopoutState();

  if (shell.isInitializing) {
    return (
      <AppShellFrame shell={shell} popout={popout}>
        <ShellLoading />
      </AppShellFrame>
    );
  }

  if (!shell.env) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AppShellFrame shell={shell} popout={popout}>
      <CredentialsReentryBanner />
      <PanelWorkspace popout={popout} />
    </AppShellFrame>
  );
};

export const PopoutRoutePage = ({ route }: { route: string }): ReactElement => {
  const popout = usePopoutState();

  if (!isPopoutRoute(route)) {
    return <Navigate to="/" replace />;
  }

  return <PopoutPage route={route as PopoutRoute} popout={popout} />;
};
