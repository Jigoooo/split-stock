import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';
import { installLegacyPopoutHashBridge } from './app/model/popout-route';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

installLegacyPopoutHashBridge();

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
