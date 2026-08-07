import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTES, SITE_URL } from './routeManifest'

/**
 * These guard the soft-404 fix. The build emits one HTML shell per entry in
 * ROUTES plus a 404.html for everything else, so anything that drifts out of
 * sync here becomes a 404 (or a duplicate indexed shell) in production —
 * failures the app's own tests would never see.
 */

// Relative to the project root — vitest runs from there.
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('route manifest', () => {
  it('has unique, root-absolute paths with no trailing slash', () => {
    const paths = ROUTES.map((r) => r.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const path of paths) {
      expect(path.startsWith('/')).toBe(true)
      expect(path === '/' || !path.endsWith('/')).toBe(true)
    }
  })

  it('gives every route a title and a description', () => {
    for (const route of ROUTES) {
      expect(route.title.length, route.path).toBeGreaterThan(0)
      expect(route.description.length, route.path).toBeGreaterThan(0)
    }
  })
})

describe('index.html shell template', () => {
  const html = read('index.html')

  // routeShells() in vite.config.ts rewrites exactly these three elements per
  // route and throws if it finds anything other than one of each. Assert the
  // same shapes here so drift fails in `npm test`, not only in `npm run build`.
  it.each([
    ['title', /<title>[\s\S]*?<\/title>/g],
    ['description', /<meta\s[^>]*name="description"[^>]*>/g],
    ['canonical', /<link\s[^>]*rel="canonical"[^>]*>/g],
  ])('has exactly one %s element for the build to rewrite', (_name, pattern) => {
    expect(html.match(pattern) ?? []).toHaveLength(1)
  })

  it('matches the manifest entry for /', () => {
    const home = ROUTES.find((r) => r.path === '/')!
    expect(html).toContain(`<title>${home.title}</title>`)
    expect(html).toContain(home.description)
    expect(html).toContain(`href="${SITE_URL}/"`)
  })
})

describe('sitemap.xml', () => {
  it('lists exactly the indexable routes', () => {
    const locs = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    const expected = ROUTES.filter((r) => r.indexable).map((r) => `${SITE_URL}${r.path}`)
    expect(locs.sort()).toEqual(expected.sort())
  })
})

describe('404.html', () => {
  const html = read('404.html')

  it('is noindex and canonicalises to the homepage', () => {
    expect(html).toMatch(/<meta\s[^>]*name="robots"[^>]*content="noindex"/)
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/" />`)
  })

  // The CSP is script-src 'self', so an inline script would be blocked and the
  // page would silently lose whatever it was doing.
  it('contains no script tags', () => {
    const markup = html.replace(/<!--[\s\S]*?-->/g, '')
    expect(markup).not.toMatch(/<script/i)
  })
})
