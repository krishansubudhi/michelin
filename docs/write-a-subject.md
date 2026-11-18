1. Make `subjects/<name>/` with `setup.md`, `howtorun.md` and `teardown.md`. Have setup print the handles later steps need and keep everything it creates in the scratch folder it is given.
2. Write CUJs in `subjects/<name>/cujs/`. Make each expectation something a judge can check from recorded output alone.
3. Add a must-fail control (see [concepts](concepts.md#the-must-fail-control)).
4. `michelin run subjects/<name> subjects/<name>/cujs/`, or set `subject` and `cujs` in `michelin.json` and run `michelin run`.

`michelin init` copies the toy subject to `subjects/toy` as a starting point: a few lines of Python that answer every question with "USA". Its run ends with:

```
PASS  toy-country  passed 2/2  (done)
FAIL  toy-name     passed 0/1  (done)
total: 1/2 CUJs passed
```

`toy-name` expects "Alice", so the judges must fail it: that is the must-fail control.

A CUJ yaml has `instruction` (what the executor does, as a user would), `timeout_s` (a positive number) and `expectations` (a non-empty list, each judged alone from the evidence); `story` (a note for humans) and `given` (state seeded before the CUJ, see [concepts](concepts.md)) are optional. Any other key is an error.

```yaml
story: A first-time user checks the default country.
instruction: |
  Ask "What is my country?"
timeout_s: 60
expectations:
  - The reply says USA.
  - The reply came within 10 seconds.
```
