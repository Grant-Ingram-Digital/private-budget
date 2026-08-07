import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { ROUTES, SITE_URL, type RouteMeta } from './src/routeManifest'

/**
 * The single most important security control in this app.
 *
 * `connect-src 'self'` means the page can only open network connections
 * (fetch / XHR / WebSocket / sendBeacon) to its own origin. Because the
 * production origin is a static host with no data endpoints, there is
 * physically nowhere for your financial data to be sent. Anyone can verify
 * this in DevTools → Network.
 *
 * The File API used to read statements is NOT a network operation and is
 * unaffected by this policy.
 */
const CSP = [
  "default-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  // Many React chart/UI libs inject inline <style> tags. Inline styles cannot
  // exfiltrate data, so this is a safe relaxation; scripts stay locked down.
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

// `frame-ancestors` is ignored in a <meta> tag, so it lives only in the HTTP
// header version of the policy (emitted to the Cloudflare Pages `_headers` file).
const CSP_HEADER = `${CSP}; frame-ancestors 'none'`

// Static-host response headers. Cloudflare Pages reads `_headers` from the
// build output. This is the canonical, strongest place to set the policy;
// the <meta> tag mirrors it so the guarantee is also visible in page source.
const HEADERS_FILE = `# Security headers for PrivateBudget (Cloudflare Pages reads this file).
/*
  Content-Security-Policy: ${CSP_HEADER}
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
`

/**
 * Production-only security plugin:
 *  - injects the strict CSP into index.html (visible, self-documenting), and
 *  - emits a `_headers` file so the static host serves the same policy as a
 *    real HTTP header (plus header-only protections like frame-ancestors).
 */
function securityHeaders(): Plugin {
  return {
    name: 'security-headers',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      )
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: HEADERS_FILE })
    },
  }
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Replace exactly one element in the head, or fail the build.
 *
 * Silence is the dangerous failure here: a shell that quietly keeps the
 * homepage's canonical would reintroduce the duplicate-content problem this
 * whole plugin exists to fix, and nothing downstream would notice.
 */
function rewriteHead(html: string, what: string, pattern: RegExp, replacement: string): string {
  const found = html.match(new RegExp(pattern.source, `${pattern.flags}g`)) ?? []
  if (found.length !== 1) {
    throw new Error(
      `route-shells: expected exactly one ${what} in index.html, found ${found.length}. ` +
        'The shell template in index.html has drifted — see the comment in its <head>.',
    )
  }
  return html.replace(pattern, replacement)
}

/** One route's copy of the built shell, with its own SEO head. */
function shellFor(indexHtml: string, route: RouteMeta): string {
  let html = rewriteHead(
    indexHtml,
    '<title>',
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeAttr(route.title)}</title>`,
  )
  html = rewriteHead(
    html,
    'description meta',
    /<meta\s[^>]*name="description"[^>]*>/,
    `<meta name="description" content="${escapeAttr(route.description)}" />`,
  )
  return rewriteHead(
    html,
    'canonical link',
    /<link\s[^>]*rel="canonical"[^>]*>/,
    `<link rel="canonical" href="${SITE_URL}${route.path}" />` +
      // The app surface renders from IndexedDB, so a crawler sees an empty
      // shell identical to every other one. Keep them out of the index.
      (route.indexable ? '' : '\n    <meta name="robots" content="noindex" />'),
  )
}

/**
 * Undo the app-shell tags Vite plugins inject into every HTML entry.
 *
 * VitePWA adds its `registerSW.js` tag and the web-app manifest to 404.html
 * along with the real pages. Neither belongs on an error page: registering (or
 * updating) the service worker from a URL that doesn't exist is at best noise,
 * and the whole point of this file is that it stands alone with no bundled
 * assets to go stale. Done on disk, after the file is written, so it is
 * independent of which plugin injected what and in what order.
 */
function stripAppTags(file: string) {
  // The comment branch comes first and is put back verbatim, so a <script>
  // *mentioned inside a comment* can't start a match that then runs to the
  // next real </script> and takes the page's <style> block with it.
  const cleaned = readFileSync(file, 'utf8').replace(
    /(<!--[\s\S]*?-->)|<script\b[^>]*>[\s\S]*?<\/script>|<link\b[^>]*rel="manifest"[^>]*>/g,
    (_match, comment?: string) => comment ?? '',
  )
  const markup = cleaned.replace(/<!--[\s\S]*?-->/g, '')
  if (/<script\b/.test(markup)) {
    throw new Error(`route-shells: ${file} still contains a <script> after stripping`)
  }
  // The page is nothing but its inline <style> and a bit of markup; if either
  // went missing we just served a blank error page.
  if (!markup.includes('</style>') || !markup.includes('<h1')) {
    throw new Error(`route-shells: stripping damaged ${file} (lost its <style> or <h1>)`)
  }
  writeFileSync(file, cleaned)
}

/**
 * Emit one real HTML file per router path.
 *
 * Without this, Cloudflare Pages only serves `/settings` (and friends) because
 * of its no-such-asset fallback to index.html — the very fallback that turns
 * every typo'd URL into a soft 404 with a 200 status. Adding `404.html` turns
 * that fallback off, so the real routes have to exist as files *in the same
 * deploy*, or they'd start answering 404.
 *
 * Flat `<name>.html` rather than `<name>/index.html`: Pages serves `dist/settings.html`
 * at `/settings` with a straight 200 (the directory form 308-redirects to
 * `/settings/` first), and Workbox's precache `cleanURLs` lookup tries
 * `<url>.html`, so offline navigation to `/settings` hits the precached shell.
 * The directory form only matches offline for URLs with a trailing slash.
 */
function routeShells(): Plugin {
  return {
    name: 'route-shells',
    apply: 'build',
    // writeBundle, not generateBundle: each shell is a copy of the *finished*
    // index.html, hashed asset tags and injected CSP meta included. It runs
    // before VitePWA's closeBundle, so the shells land in the precache manifest.
    writeBundle(options, bundle) {
      const index = bundle['index.html']
      if (!index || index.type !== 'asset') {
        throw new Error('route-shells: no index.html in the bundle to copy')
      }
      const indexHtml = index.source.toString()
      const outDir = options.dir ?? 'dist'
      for (const route of ROUTES) {
        if (route.path === '/') continue // that's index.html itself
        writeFileSync(join(outDir, `${route.path.slice(1)}.html`), shellFor(indexHtml, route))
      }
      stripAppTags(join(outDir, '404.html'))
    },
  }
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        // 404.html is a build input rather than a public/ passthrough so it
        // gets the same CSP <meta> injection as the app shell.
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        notFound: fileURLToPath(new URL('./404.html', import.meta.url)),
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    securityHeaders(),
    routeShells(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // The service worker's default `navigateFallback: 'index.html'` answers
        // ANY navigation with the app shell and a 200 — the same soft 404, moved
        // into the browser, where it would survive the origin-side fix for every
        // returning visitor. Off: real routes are precached as their own shells
        // (so offline navigation still works), and unknown paths reach the
        // origin and get a real 404.
        navigateFallback: undefined,
        // 404.html must not be precached: it isn't a page of the app, and a
        // precached copy would only ever be served for a URL that doesn't exist.
        globIgnores: ['**/node_modules/**/*', '404.html'],
      },
      manifest: {
        name: 'PrivateBudget',
        short_name: 'PrivateBudget',
        description:
          'Private, local-first budgeting. Your data never leaves your device.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.ts'], // unit tests only; e2e/ is Playwright's
  },
})
