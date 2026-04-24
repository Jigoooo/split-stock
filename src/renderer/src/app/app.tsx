import type { ReactElement } from 'react';
import { AppProviders } from './providers';
import { AppRouterProvider } from './router';
import './app.css';

export const App = (): ReactElement => {
  return (
    <AppProviders>
      <AppRouterProvider />
    </AppProviders>
  );
};
