// Loads the app's plain classic scripts (no bundler, no exports) into a fresh
// vm context per call, so each test gets an isolated `state` with no bleed
// between tests. Exposes only what tests need to reach — internals stay
// closed over their original scope exactly as they run in production.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// Mirrors index.html's <script> load order, minus the CDN-hosted Sortable.min.js
// (drag reordering isn't exercised by these tests; stubbed as a no-op below).
const SCRIPT_FILES = ['exercises.js', 'illustrations.js', 'db.js', 'supabase.js', 'app.js'];

export function loadApp() {
  const context = {
    window: undefined, // filled in below once `context` itself is the global
    navigator: { onLine: true, serviceWorker: undefined },
    localStorage: makeMemoryStorage(),
    indexedDB: undefined, // untouched by these tests; DB.getAll etc. get stubbed instead
    document: makeStubDocument(),
    fetch: async () => { throw new Error('unstubbed fetch called in test'); },
    AbortController: globalThis.AbortController,
    setTimeout,
    clearTimeout,
    console,
    Sortable: function () { return { destroy() {} }; }, // stub for the CDN drag-reorder lib
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  for (const file of SCRIPT_FILES) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(src, context, { filename: file });
  }

  // Top-level `function` declarations attach to the context object automatically
  // (classic-script semantics), but `const`/`let` bindings (state, DB, Supabase,
  // EXERCISES, ILLUSTRATIONS) live in the context's global lexical scope only —
  // pull them onto the context object itself so callers can reach them.
  vm.runInContext(
    'Object.assign(globalThis, { state, DB, Supabase, EXERCISES, ILLUSTRATIONS, IMAGE_KEYS });',
    context
  );

  return context;
}

function makeMemoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

// app.js only touches `document` inside functions that these tests don't call
// (rendering/DOMContentLoaded init) — this stub exists so referencing
// `document.addEventListener('DOMContentLoaded', init)` at load time doesn't throw.
function makeStubDocument() {
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
  };
}
