import { CredentialsReentryBanner } from '@renderer/features/backup-restore';
import { SwitchEnvDialog } from '@renderer/features/switch-env';
import {
  useTradeNotifications,
  useWatchEventNotifications,
} from '@renderer/features/trade-notifications';
import { LoginPage } from '@renderer/pages/login';
import { LOADING_MESSAGES } from '@renderer/shared/lib/loading-messages';
import { Navigate, Outlet } from '@tanstack/react-router';
import { lazy, type ReactElement, type ReactNode, Suspense } from 'react';
import { isPopoutRoute, type PopoutRoute } from './model/popout-route';
import { useAppShell } from './model/use-app-shell';
import { type PopoutApi, usePopoutState } from './model/use-popout-state';
import { AccountBar } from './ui/account-bar';
import { HeaderPopoutButtons } from './ui/header-popout-buttons';

// PanelWorkspace + PopoutPage 는 main / popout 라우트 전용. 정적 import 하면
// LoginRoutePage 진입 시점에도 함께 번들에 들어가므로 React.lazy 로 분리
// → router-layout 초기 chunk 크기 감소 (login 흐름 진입까지의 체감 로딩 단축).
const PanelWorkspace = lazy(() =>
  import('./ui/panel-workspace').then((m) => ({ default: m.PanelWorkspace })),
);
const PopoutPage = lazy(() => import('./ui/popout-page').then((m) => ({ default: m.PopoutPage })));

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

const ShellLoading = (): ReactElement => (
  <div className="muted">{LOADING_MESSAGES.INITIALIZING}</div>
);

const AppShellFrame = ({ children, popout, shell }: AppShellFrameProps): ReactElement => {
  return (
    <div className="app-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header className="app-header">
        <AccountBar env={shell.env} />
        {shell.env && popout ? (
          <div className="app-header__section app-header__section--tools">
            <span className="app-header__section-label">메뉴</span>
            <HeaderPopoutButtons popout={popout} />
          </div>
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
            <div className="env-switch-overlay__label">{LOADING_MESSAGES.SWITCHING_ENV}</div>
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
      <Suspense fallback={<ShellLoading />}>
        <PanelWorkspace popout={popout} />
      </Suspense>
    </AppShellFrame>
  );
};

export const PopoutRoutePage = ({ route }: { route: string }): ReactElement => {
  const popout = usePopoutState();

  if (!isPopoutRoute(route)) {
    return <Navigate to="/" replace />;
  }

  return (
    <Suspense fallback={<div className="muted">{LOADING_MESSAGES.ROUTE_LOADING}</div>}>
      <PopoutPage route={route as PopoutRoute} popout={popout} />
    </Suspense>
  );
};
