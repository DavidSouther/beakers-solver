# Beakers — water sort solver

A deterministic solver for water-sort / beaker puzzle games. Paste a
screenshot of the board (or pick a photo), and it reads the beakers straight
from the pixels — no model call — then finds the shortest pour sequence,
splicing in an "unlock" step for any locked/purchasable beaker only if the
level can't be solved without it.

Installable as a home-screen app on iPhone and Android (it's a PWA — offline
shell via a service worker, standalone display, app icon).

## Develop

```sh
npm install
npm run dev
```

## Build

```sh
npm run build   # outputs to dist/
npm run preview # serve dist/ locally to sanity-check the production build
```

## Deploy — GitHub Pages

`.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub Pages on
every push to `main` (or manually via **Actions → Deploy to GitHub
Pages → Run workflow**). It uses the standard `actions/upload-pages-artifact`
+ `actions/deploy-pages` flow, so no `gh-pages` branch or deploy token is
needed — just the built-in `GITHUB_TOKEN`.

One-time repo setup:

1. **Settings → Pages → Build and deployment → Source**: set to **GitHub
   Actions** (not "Deploy from a branch").
2. **Settings → Pages → Custom domain**: enter `beakers.davidsouther.com` and
   save. (The repo already ships `public/CNAME` with that value, so the file
   in the deployed `dist/` matches what GitHub expects — this field mostly
   confirms it and kicks off certificate provisioning.)
3. Once GitHub shows the domain as verified with an active certificate, check
   **Enforce HTTPS**.

### DNS changes needed

At whatever provider hosts `davidsouther.com`'s DNS, add:

| Type  | Name      | Value                    |
|-------|-----------|--------------------------|
| CNAME | `beakers` | `davidsouther.github.io.` |

That's it — a single CNAME record for the `beakers` subdomain pointing at
your GitHub Pages hostname (`<owner>.github.io`, lowercased). No A/ALIAS
records at the apex are needed since this isn't an apex domain. DNS
propagation plus GitHub's certificate issuance can take anywhere from a few
minutes to a few hours; the Pages settings page will show "DNS check
successful" once it's live, and HTTPS enforcement becomes available shortly
after.

## PWA / "Add to Home Screen"

- **Android (Chrome)**: visiting the site shows an install prompt/banner
  automatically once the manifest + service worker + icons pass Chrome's
  installability check (all present here). Otherwise: menu → *Install app*.
- **iPhone (Safari)**: Share sheet → *Add to Home Screen*. iOS doesn't use
  the web app manifest for this, so the icon and standalone/full-screen
  behavior come from the `apple-touch-icon` link and
  `apple-mobile-web-app-*` meta tags in `index.html`.
- Icons live in `public/` (`icon-192.png`, `icon-512.png`,
  `icon-512-maskable.png`, `apple-touch-icon.png`, `favicon-32.png`).

### Paste screenshot, on mobile

The **Paste screenshot** button calls the async Clipboard API
(`navigator.clipboard.read()`) directly, which is what lets a phone paste an
image with a single tap after copying a screenshot. Browsers that refuse
programmatic clipboard reads (older iOS Safari) fall back to a real
`contentEditable` paste target the browser shows a native **Paste** button
for. A plain `Cmd/Ctrl+V` anywhere on the page also works on desktop.

This requires a **secure context** (HTTPS, which GitHub Pages provides) —
the Clipboard API is unavailable on plain HTTP.

## Project layout

- `src/WaterSortSolver.jsx` — the whole app: board model, solver (BFS
  shortest-path with a DFS fallback), the deterministic screenshot reader
  (connected-component blob detection + modal-color sampling, no ML), and
  the UI.
- `vite.config.js` — Vite + Tailwind v4 + `vite-plugin-pwa` (manifest +
  service worker generation).
- `public/CNAME` — custom domain for GitHub Pages.
- `public/icon-*.png`, `apple-touch-icon.png`, `favicon-32.png` — app icons.
