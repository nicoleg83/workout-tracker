# Testing

100% test coverage is the key to great vibe coding. Tests let you move fast,
trust your instincts, and ship with confidence — without them, vibe coding is
just yolo coding. With tests, it's a superpower.

## Framework

[Vitest](https://vitest.dev) v4. No build step, no jsdom — this app has no
bundler (plain `<script src="...">` tags, no `export`s), so tests load the
classic scripts into an isolated `vm` context per test (see
`test/helpers/load-app.js`) instead of `import`ing them directly.

## Running tests

```bash
npm install
npm test
```

## Test layers

- **Unit/logic tests** (`test/*.test.js`): load the app's scripts via
  `loadApp()` from `test/helpers/load-app.js`, which returns a fresh
  `{ state, DB, Supabase, buildSetRow, loadProgressData, ... }` for that test
  only — no bleed between tests. Stub `app.DB.getAll` / `app.Supabase.*`
  directly on the returned object to control what "the database" returns.
- **No browser/e2e tests here.** Interactive/visual QA (swipe gestures, CSS
  rendering, mobile keyboards) is covered by gstack's `/qa` browser-based
  testing, not vitest — see `.gstack/qa-reports/`.

## Conventions

- One `describe` block per function/feature area, `it` per behavior.
- Regression tests get a comment block: what broke, when `/qa` found it, and
  a link to the report in `.gstack/qa-reports/`.
- New logic in `app.js` that doesn't touch the DOM/network directly is the
  easiest to test — prefer testing it as data-in/data-out against `state`.
