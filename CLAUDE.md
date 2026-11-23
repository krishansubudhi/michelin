Contributor guidance for michelin.

1. Keep code minimal. Use few dependencies and prefer Node built-ins (e.g. util.parseArgs, node:test).
2. Give each concern its own file. For example, settings are parsed in settings.ts, never inside runner.ts.
3. Write small functions, each doing one job. main only wires the steps together and reads like the spec.
4. Put a docstring on every function and type: what it does, each @param with its meaning and an example, plus @returns and @throws.
5. Every file starts with a header comment saying what it is and how to run or test it.
6. Make code easy to test: keep pure functions apart from I/O and LLM calls, and export them.
7. Each module gets its own test file (settings.ts → settings.test.ts). npm test runs them all, uses no LLM and takes about 1 s.
8. Validate input at the boundary (CLI, settings, CUJ files) and fail early with a message that names the file and the field.
9. Use a real argument parser with --help. Don't index into process.argv.
10. Docs and subject files are plain markdown. No # title line, because the filename already says what it is.
11. Run npm run lint and npm test before sending a change, and say what was and wasn't run live.
12. Turn on the pre-commit hook (git config core.hooksPath hooks); don't bypass it with --no-verify.
13. Writing or running a subject or a CUJ? Follow skills/michelin/SKILL.md: it defines $RUNDIR and michelin-sandboxed.
