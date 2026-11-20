import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import './styles/index.css';
import HomePage from './pages/public/HomePage';
import CollectionPage from './pages/public/CollectionPage';
import { PublicMessage } from './pages/public/PublicMessage';

const AdminApp = lazy(() => import('./pages/admin/AdminApp'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 15_000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/g/:token" element={<CollectionPage />} />
          <Route
            path="/admin/*"
            element={
              <Suspense fallback={<div className="min-h-svh bg-canvas" />}>
                <AdminApp />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={
              <PublicMessage
                title="Page not found"
                body="This address doesn’t lead anywhere."
                action={{ href: '/', label: 'Return to the studio' }}
              />
            }
          />
        </Routes>
      </BrowserRouter>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            borderRadius: 6,
            border: '1px solid #E6E4DD',
            fontFamily: "'Schibsted Grotesk', system-ui, sans-serif",
            fontSize: 13,
          },
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
);
