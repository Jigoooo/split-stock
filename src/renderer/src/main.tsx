import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';
import { installChartDisposalErrorFilter } from './app/model/install-chart-disposal-error-filter';
import { installLegacyPopoutHashBridge } from './app/model/popout-route';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

installLegacyPopoutHashBridge();
installChartDisposalErrorFilter();

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
