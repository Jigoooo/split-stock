import { DashboardPage } from '@renderer/pages/dashboard';
import { LoginPage } from '@renderer/pages/login';
import { trpc } from '@renderer/shared/api/trpc';
import type { ReactElement } from 'react';
import { AppProviders } from './providers';
import './app.css';

const AppShell = (): ReactElement => {
  const envQuery = trpc.auth.getEnv.useQuery();
  const env = envQuery.data?.env ?? null;

  return (
    <div className="app-root">
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
      </header>
      <main className="app-main">
        {envQuery.isPending ? (
          <div className="muted">초기화 중…</div>
        ) : env ? (
          <DashboardPage />
        ) : (
          <LoginPage />
        )}
      </main>
    </div>
  );
};

export const App = (): ReactElement => (
  <AppProviders>
    <AppShell />
  </AppProviders>
);
