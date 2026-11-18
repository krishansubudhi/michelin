`subjects/opencode` evaluates [OpenCode](https://opencode.ai), the open-source AI coding agent for the terminal, on three CUJs: make a failing unit test pass, answer a question about a two-file repo without editing it (OpenCode's read-only `plan` agent), and a must-fail control. It lives in the source repo, not the npm package. Install OpenCode at user level and give it a model of its own; an Ollama model that supports tool calls works, free and local:

```sh
npm install -g opencode-ai
export OPENCODE_MODEL=ollama/<model>   # an Ollama model with tool calls; the recorded run used Gemma 4 26B
node src/run/runner.ts subjects/opencode subjects/opencode/cujs/opencode/
```

A healthy run ends `total: 2/3 CUJs passed`; the one FAIL is `opencode-fail_control`. Scores from a real run are in [`subjects/opencode/RESULTS.md`](../subjects/opencode/RESULTS.md).
