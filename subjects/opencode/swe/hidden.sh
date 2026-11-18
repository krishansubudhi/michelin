#!/bin/bash
# hidden.sh <instance> <patch> <work>: score a saved program diff on the instance's hidden tests, outside any judged
# evidence. Clones a clean base checkout with prep.sh into <work>, applies <patch>, then runs check.sh (which adds the
# hidden test patch and counts FAIL_TO_PASS / PASS_TO_PASS passes). An empty patch is scored on the untouched base.
# Test: bash hidden.sh pytest-dev__pytest-7432 /path/to/opencode.patch /tmp/h7432
D=$(cd "$(dirname "$0")" && pwd)
P=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
bash "$D/prep.sh" "$1" "$3" || exit 1
if [ -s "$P" ]; then
  git -C "$3/repo" apply "$P" || { echo "hidden failed: patch does not apply"; exit 1; }
fi
echo "patch: $(wc -c <"$P" | tr -d ' ') bytes"
bash "$D/check.sh" "$1" "$3"
