// ---------------------------------------------------------------------------
// Global build-time constants defined via esbuild's `--define` flag.
//
// In `package.json`:
//   "dev": "... --define:DEV=true ..."
//   "build": "... --define:DEV=false ..."
//
// esbuild replaces `DEV` at bundle time with a literal boolean. When `DEV` is
// false (in production builds), dead-code elimination / tree-shaking drops any
// code guarded by `if (DEV) { ... }`, ensuring developer tools and cheats are
// completely excluded from production releases.
// ---------------------------------------------------------------------------

declare const DEV: boolean;
