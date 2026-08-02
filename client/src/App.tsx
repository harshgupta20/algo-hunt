import { Suspense, lazy, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { LiveAlerts } from './pages/LiveAlerts';
import { AlertHistory } from './pages/AlertHistory';
import { Analytics } from './pages/Analytics';
import { Configuration } from './pages/Configuration';
import { Strategies } from './pages/Strategies';
import { Settings } from './pages/Settings';
import { KiteRedirect } from './pages/KiteRedirect';
import { Spinner } from './components/ui';

// Lazy-loaded so the charting library + xlsx exporter stay out of the initial bundle.
const StrategyAnalyzer = lazy(() =>
  import('./pages/StrategyAnalyzer').then((m) => ({ default: m.StrategyAnalyzer })),
);
const StrategyBuilder = lazy(() => import('./pages/StrategyBuilder').then((m) => ({ default: m.StrategyBuilder })));
const StrategyLibrary = lazy(() => import('./pages/StrategyLibrary').then((m) => ({ default: m.StrategyLibrary })));
const StrategyDashboard = lazy(() => import('./pages/StrategyDashboard').then((m) => ({ default: m.StrategyDashboard })));

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Spinner label="Loading…" />}>{children}</Suspense>;
}

export function App() {
  return (
    <Routes>
      {/* Kite OAuth redirect landing (matches the Kite app's Redirect URL). */}
      <Route path="/zerodhaRedirection" element={<KiteRedirect />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/alerts" element={<LiveAlerts />} />
        <Route path="/analyzer" element={<Lazy><StrategyAnalyzer /></Lazy>} />
        <Route path="/builder" element={<Lazy><StrategyBuilder /></Lazy>} />
        <Route path="/builder/:id" element={<Lazy><StrategyBuilder /></Lazy>} />
        <Route path="/library" element={<Lazy><StrategyLibrary /></Lazy>} />
        <Route path="/strategy/:id" element={<Lazy><StrategyDashboard /></Lazy>} />
        <Route path="/history" element={<AlertHistory />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/configuration" element={<Configuration />} />
        <Route path="/strategies" element={<Strategies />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
