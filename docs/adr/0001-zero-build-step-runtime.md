# Zero build step: plain ES modules, no framework, no runtime dependencies

The browser loads `index.html` → `src/ui/app.js` directly as plain ES modules; there is no bundler, no UI framework and no runtime dependency (devDependencies only, for lint). We chose this so the same `src/core/` modules run unchanged in the browser and in plain-Node tests, the app deploys as static files, and there is no toolchain to break or upgrade.

## Consequences

- The UI is written with the small `dom.js` template helpers instead of a framework; it renders what the core returns and never computes damage.
- All heavy work happens offline in `tools/` (the dataset and the meta are compiled ahead of time), so the runtime only loads JSON.
