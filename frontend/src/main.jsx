import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import { FlashProvider } from './context/FlashContext';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <FlashProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </FlashProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
