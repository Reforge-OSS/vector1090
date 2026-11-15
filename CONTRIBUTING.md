# Contributing

Use Node.js 22 and npm. Install dependencies with `npm ci`, then start the
dashboard with `npm run dev`. Public feeds and photos require internet access;
the test suite runs offline.

Before opening a pull request, run:

```sh
npm run format
npm run lint
npm run typecheck
npm run format:check
npm test
npm run build
```

Keep changes focused and include regression tests for behavior changes. Tests
live in `tests/*.test.ts`; use Testing Library for hooks and mock external
requests rather than calling live services. Include screenshots for UI changes.

Do not commit local environment files, build output or the copied MapLibre
worker. The worker is prepared automatically before development and builds.
Report security issues privately to the maintainers rather than publishing
receiver addresses or other sensitive details in an issue.
