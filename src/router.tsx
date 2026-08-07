import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './routes/Dashboard'
import { Import } from './routes/Import'
import { Transactions } from './routes/Transactions'
import { Categories } from './routes/Categories'
import { Accounts } from './routes/Accounts'
import { Settings } from './routes/Settings'
import { Privacy } from './routes/Privacy'
import { ROUTES, type RoutePath } from './routeManifest'

// Reports pulls in the charting library; load it only when visited (same-origin
// chunk fetch, allowed by the strict CSP).
const Reports = lazy(() =>
  import('./routes/Reports').then((m) => ({ default: m.Reports })),
)

const loading = <div className="p-6 text-sm text-slate-400 dark:text-slate-500">Loading…</div>

// Paths live in src/routeManifest.ts because the build reads them too (it emits
// one prerendered shell per route, and a 404.html for everything else). The
// Record type means a path added there fails the typecheck until it has an
// element here — the two can't drift.
const ELEMENTS: Record<RoutePath, ReactNode> = {
  '/': <Dashboard />,
  '/import': <Import />,
  '/transactions': <Transactions />,
  '/reports': <Suspense fallback={loading}>{<Reports />}</Suspense>,
  '/categories': <Categories />,
  '/accounts': <Accounts />,
  '/settings': <Settings />,
  '/privacy': <Privacy />,
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: ROUTES.map(({ path }): RouteObject =>
      path === '/'
        ? { index: true, element: ELEMENTS[path] }
        : { path: path.slice(1), element: ELEMENTS[path] },
    ),
  },
])
