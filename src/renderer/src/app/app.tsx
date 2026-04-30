import type { ReactElement } from 'react';
import { AppProviders, type AppWindowKind } from './providers';
import { AppRouterProvider } from './router';
import './app.css';

function resolveWindowKind(): AppWindowKind {
  return window.location.hash.startsWith('#/popout/') ? 'popout' : 'main';
}

export const App = (): ReactElement => {
  const windowKind = resolveWindowKind();
  return (
    <AppProviders windowKind={windowKind}>
      <AppRouterProvider />
    </AppProviders>
  );
};
