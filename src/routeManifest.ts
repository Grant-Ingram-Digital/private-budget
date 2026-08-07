/**
 * Single source of truth for the app's URL space.
 *
 * Two very different consumers read this list:
 *
 *  - `src/router.tsx` builds the client-side routes from it, and
 *  - `vite.config.ts` emits one prerendered shell (`dist/<name>.html`) per
 *    entry at build time.
 *
 * Keeping them on one list is not cosmetic. The build also emits a `404.html`,
 * which makes Cloudflare Pages answer every path that has no matching file
 * with a real HTTP 404 instead of quietly serving the app shell (a "soft
 * 404"). So a route that exists here but not in the router renders nothing,
 * and a route in the router but not here **404s in production**. Add paths in
 * one place only.
 */

/** Production origin, used to build the per-route <link rel="canonical">. */
export const SITE_URL = 'https://privatebudget.org'

export type RouteMeta = {
  /** Router path, root-absolute and without a trailing slash. */
  path: string
  /** <title> for the prerendered shell. */
  title: string
  /** <meta name="description"> for the prerendered shell. */
  description: string
  /**
   * False for the app surface: those routes render from IndexedDB, so a
   * crawler (which has no data) sees an identical empty shell on every one of
   * them. Their shells get <meta name="robots" content="noindex"> so they
   * aren't indexed as near-duplicates. Only `indexable` routes belong in
   * public/sitemap.xml — src/routeManifest.test.ts enforces that.
   */
  indexable: boolean
}

export const ROUTES = [
  {
    path: '/',
    title: 'PrivateBudget — your money, only on your device',
    description:
      'Private, local-first budgeting. Import your bank statements and see where the money goes — your financial data never leaves your device.',
    indexable: true,
  },
  {
    path: '/privacy',
    title: 'How your data stays private — PrivateBudget',
    description:
      'PrivateBudget is built so your financial data physically cannot leave your device: no accounts, no servers, no tracking — and here is how to verify it yourself.',
    indexable: true,
  },
  {
    path: '/import',
    title: 'Import statements — PrivateBudget',
    description: 'Import a bank-statement CSV. Parsing happens on your device.',
    indexable: false,
  },
  {
    path: '/transactions',
    title: 'Transactions — PrivateBudget',
    description: 'Browse, search and categorise your imported transactions.',
    indexable: false,
  },
  {
    path: '/reports',
    title: 'Reports — PrivateBudget',
    description: 'Spending by category and over time, computed on your device.',
    indexable: false,
  },
  {
    path: '/categories',
    title: 'Categories — PrivateBudget',
    description: 'Manage categories and the rules that assign them.',
    indexable: false,
  },
  {
    path: '/accounts',
    title: 'Accounts — PrivateBudget',
    description: 'Manage the accounts your statements are imported into.',
    indexable: false,
  },
  {
    path: '/settings',
    title: 'Settings — PrivateBudget',
    description: 'Theme, data export and erasing everything stored on device.',
    indexable: false,
  },
] as const satisfies readonly RouteMeta[]

/** Union of every real path — lets TypeScript check the router covers them all. */
export type RoutePath = (typeof ROUTES)[number]['path']
