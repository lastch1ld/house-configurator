# House Configurator

Browser-based 3D house configurator (React, Three.js, Zustand). Live demo: https://lastch1ld.github.io/house-configurator/

The UI comes from `@lastch1ld/ui`, a **private** package. The source here is public, but `npm install` only
works with read access to `github.com/lastch1ld/ui`; the live demo is the way to try it without that.

```bash
npm install   # builds @lastch1ld/ui from its git repo on install
npm run dev   # http://localhost:5173
npm test
npm run build
```

## Deploy

Every push to `main` builds and publishes to GitHub Pages (`.github/workflows/pages.yml`). The build reads the
private UI repo with a read-only deploy key stored as the `UI_DEPLOY_KEY` secret.
