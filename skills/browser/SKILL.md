---
name: browser
description: Drive a headless browser with playwright-cli to open pages, read them, fill inputs, click, press keys and take screenshots. Use when a test step needs a web page, such as chatting with a web app, checking what a page shows, or waiting for a slow reply.
---

# Browser

## Quick start

Run every command from the michelin folder. Pick one unique session name per run (e.g. the run id) and pass `-s=<name>` on EVERY command. The browser stays open between commands until you close it, and each command prints the page state after it runs.

```bash
npx playwright-cli -s=run42 open http://localhost:3000   # run42 = this run's unique session name
npx playwright-cli -s=run42 snapshot                     # page as text; each element gets a ref like e12
npx playwright-cli -s=run42 fill e12 'hello' --submit    # type into the input and press Enter
npx playwright-cli -s=run42 snapshot                     # read the result
npx playwright-cli -s=run42 close                        # end the session
```

## Commands

| Command                               | What it does                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `open <url>`                          | Start the browser on a page                                                            |
| `goto <url>` / `reload`               | Navigate or reload                                                                     |
| `snapshot`                            | Page as text, with refs. Add `--filename=/tmp/s.md` for long pages, then grep the file |
| `fill <target> <text>`                | Set an input. Target is a ref or a unique CSS selector. Add `--submit` to press Enter  |
| `type <text>`                         | Type into the focused element                                                          |
| `press <key>`                         | Press a key, e.g. `Enter`                                                              |
| `click <target>`                      | Click a ref or a unique selector                                                       |
| `find <text>`                         | Locate text on the page                                                                |
| `eval <js>`                           | Run JavaScript in the page                                                             |
| `screenshot --filename=/tmp/page.png` | Save a picture. Add `--full-page` for the whole page                                   |
| `close`                               | End the session                                                                        |

For everything else, run `npx playwright-cli --help`.

## Waiting for async replies

A page that answers later (a chat, a spinner, streaming text) is not ready right after you send input.

1. Send the input with `fill ... --submit`.
2. Run `snapshot` and read it. If it's not done, `sleep 3` and snapshot again.
3. Stop when the placeholder ("thinking", a spinner) is gone and the last message is the answer.
4. Give up only after the time the test allows. A slow reply is not a failure.

## Gotchas

- Never use the unnamed `default` session. Without `-s=`, every browser on the machine shares `default`, so another run's `open` silently replaces your browser and your next command fails with "The browser 'default' is not open". Shell variables don't persist between tool calls, so write the literal `-s=<name>` each time.
- Refs go stale after the page changes. Take a fresh `snapshot` before using a ref again.
- Prefer refs from the latest snapshot over guessed CSS selectors.
- Always `close` your own session when done (never `close-all`), so the next run starts clean.
