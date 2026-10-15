import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DesktopI18nProvider } from './i18n';
import { GlobalErrorBoundary } from './components/common/GlobalErrorBoundary';
import './index.css';

// Safety net for unhandled async exceptions and rejections
window.addEventListener('error', (event) => {
  console.error('[metis:global-error]', event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[metis:unhandled-rejection]', event.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <DesktopI18nProvider>
        <App />
      </DesktopI18nProvider>
    </GlobalErrorBoundary>
  </React.StrictMode>
);

