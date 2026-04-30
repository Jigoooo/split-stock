import { StrategyRecommendationProvider } from '@renderer/features/ai-strategy-recommend';
import { SymbolRecommendationProvider } from '@renderer/features/ai-symbol-recommend';
import { CredentialsReentryBanner } from '@renderer/features/backup-restore';
import { SwitchEnvDialog } from '@renderer/features/switch-env';
import { LoginPage } from '@renderer/pages/login';
import { LOADING_MESSAGES } from '@renderer/shared/lib/loading-messages';
import { getPopoutLabel } from '@shared/popout';
import { Navigate, Outlet } from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
import { lazy, type ReactElement, type ReactNode, Suspense, useEffect } from 'react';
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
const PREWARM_POPOUT_ROUTES: PopoutRoute[] = ['stock-picker', 'add-watch-order', 'trade'];

interface AppShellFrameProps {
  children: ReactNode;
  loading?: boolean | undefined;
  popout?: PopoutApi | undefined;
  shell: ReturnType<typeof useAppShell>;
}

interface ShellLoadingProps {
  detail?: string | undefined;
  message?: string | undefined;
}

const ShellLoading = ({
  detail = '계좌와 설정을 불러오고 있습니다.',
  message = LOADING_MESSAGES.INITIALIZING,
}: ShellLoadingProps): ReactElement => (
  <section className="shell-loading" role="status" aria-live="polite" aria-label={message}>
    <div className="shell-loading__surface">
      <div className="shell-loading__icon-ring" aria-hidden>
        <LoaderCircle className="shell-loading__icon" size={28} strokeWidth={2.2} />
      </div>
      <div className="shell-loading__copy">
        <div className="shell-loading__title">{message}</div>
        <div className="shell-loading__detail">{detail}</div>
      </div>
      <div className="shell-loading__progress" aria-hidden>
        <span />
      </div>
    </div>
  </section>
);

export const PopoutBootShell = ({ route }: { route: PopoutRoute }): ReactElement => {
  const label = getPopoutLabel(route);
  return (
    <section
      className="popout-boot-shell"
      role="status"
      aria-live="polite"
      aria-label={`${label} 로드 중`}
    >
      <div className="shell-loading__surface">
        <div className="shell-loading__icon-ring" aria-hidden>
          <LoaderCircle className="shell-loading__icon" size={26} strokeWidth={2.2} />
        </div>
        <div className="shell-loading__copy">
          <div className="shell-loading__title">{label}</div>
          <div className="shell-loading__detail">화면 구성을 불러오고 있습니다.</div>
        </div>
        <div className="shell-loading__progress" aria-hidden>
          <span />
        </div>
      </div>
    </section>
  );
};

const PopoutShellReadyMarker = ({ route }: { route: PopoutRoute }): null => {
  useEffect(() => {
    window.appShell?.markPopoutShellReady?.(route);
  }, [route]);
  return null;
};

function schedulePopoutPrewarm(): () => void {
  let canceled = false;
  const run = (): void => {
    if (canceled) return;
    void import('./ui/popout-page').then((module) => {
      if (canceled) return;
      for (const route of PREWARM_POPOUT_ROUTES) {
        module.prewarmPopoutRoute(route);
      }
    });
  };

  if ('requestIdleCallback' in window) {
    const idleId = window.requestIdleCallback(run, { timeout: 4000 });
    return () => {
      canceled = true;
      window.cancelIdleCallback(idleId);
    };
  }

  const timeoutId = globalThis.setTimeout(run, 1500);
  return () => {
    canceled = true;
    globalThis.clearTimeout(timeoutId);
  };
}

const FullScreenShellLoading = ({
  detail,
  message,
  popout,
  shell,
}: ShellLoadingProps & {
  popout?: PopoutApi;
  shell: ReturnType<typeof useAppShell>;
}): ReactElement => (
  <AppShellFrame shell={shell} popout={popout} loading>
    <ShellLoading message={message} detail={detail} />
  </AppShellFrame>
);

const AppShellFrame = ({
  children,
  loading = false,
  popout,
  shell,
}: AppShellFrameProps): ReactElement => {
  return (
    <div className="app-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {loading ? null : (
        <header className="app-header">
          <AccountBar env={shell.env} />
          {shell.env && popout ? (
            <div className="app-header__section app-header__section--tools">
              <span className="app-header__section-label">메뉴</span>
              <HeaderPopoutButtons popout={popout} />
            </div>
          ) : null}
        </header>
      )}
      <main
        className={loading ? 'app-main app-main--loading' : 'app-main'}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: loading ? 0 : '0.8rem',
          flex: 1,
          minHeight: 0,
          padding: loading ? 0 : '0.8rem',
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
  return <Outlet />;
};

export const IndexRoutePage = (): ReactElement => {
  const shell = useAppShell();

  if (shell.isInitializing) {
    return <FullScreenShellLoading shell={shell} />;
  }

  return <Navigate to={shell.env ? '/main' : '/login'} replace />;
};

export const LoginRoutePage = (): ReactElement => {
  const shell = useAppShell();

  if (shell.isInitializing) {
    return <FullScreenShellLoading shell={shell} />;
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

  useEffect(() => {
    window.appShell?.markRouteReady?.('main');
  }, []);

  useEffect(() => {
    if (shell.isInitializing || !shell.env) return;
    return schedulePopoutPrewarm();
  }, [shell.env, shell.isInitializing]);

  if (shell.isInitializing) {
    return <FullScreenShellLoading shell={shell} popout={popout} />;
  }

  if (!shell.env) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Suspense
      fallback={
        <FullScreenShellLoading
          shell={shell}
          popout={popout}
          message={LOADING_MESSAGES.ROUTE_LOADING}
          detail="화면 구성을 불러오고 있습니다."
        />
      }
    >
      <SymbolRecommendationProvider>
        <StrategyRecommendationProvider>
          <AppShellFrame shell={shell} popout={popout}>
            <CredentialsReentryBanner />
            <PanelWorkspace popout={popout} />
          </AppShellFrame>
        </StrategyRecommendationProvider>
      </SymbolRecommendationProvider>
    </Suspense>
  );
};

export const PopoutRoutePage = ({ route }: { route: string }): ReactElement => {
  const popout = usePopoutState();

  useEffect(() => {
    if (isPopoutRoute(route)) window.appShell?.markRouteReady?.(`popout:${route}`);
  }, [route]);

  if (!isPopoutRoute(route)) {
    return <Navigate to="/" replace />;
  }
  const popoutRoute = route as PopoutRoute;

  return (
    <>
      <PopoutShellReadyMarker route={popoutRoute} />
      <Suspense fallback={<PopoutBootShell route={popoutRoute} />}>
        <PopoutPage route={popoutRoute} popout={popout} />
      </Suspense>
    </>
  );
};
