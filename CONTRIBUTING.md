## Run from source

Needs Node 22.18+ (runs `.ts` directly, no build step), `python3`, and the [`claude` CLI](https://docs.anthropic.com/en/docs/claude-code) logged in. Live runs make real model calls.

```sh
npm install        # one runtime dependency (yaml), plus the lint tools
git config core.hooksPath hooks   # turn on the pre-commit hook
npm test           # unit tests: no LLM, about 1 s
npm run lint       # tsc + eslint + prettier
node src/run/runner.ts subjects/toy subjects/toy/cujs/toy/
```

Optional: `npm link` puts `michelin` on your PATH (set `npm config set prefix ~/.local` first).

## Layout

`src/run/` runner, settings, `init` and CUJ loading · `src/llm/` claude calls and judges · `src/report/` the HTML report · `bin/michelin.js` the npm entry (Node won't strip TypeScript types under `node_modules`, so it does that itself) · `defaults/settings.json` the built-in models per role.

## Sending a change

The pre-commit hook runs lint, unit tests, then a `claude -p` review of the diff (`SKIP_REVIEW=1` skips the review; `RUN_INTEGRATION=1` adds integration tests). Don't bypass it with `--no-verify`. Code rules: `CLAUDE.md`.
