#!/bin/bash
# check.sh <instance> <work>: apply the instance's hidden test patch to <work>/repo and count FAIL_TO_PASS and
# PASS_TO_PASS passes with swecheck.py in <work>/venv. Prints pytest's summary, both counts and the misses.
# Test: bash check.sh pytest-dev__pytest-7373 /tmp/x (after prep.sh)
D=$(cd "$(dirname "$0")" && pwd)
I=$D/$1
W=$2
cd "$W/repo" || { echo "check failed: no $W/repo"; exit 1; }
git apply --reject "$I/test.patch" 2>&1 | tail -3
# A fresh TMPDIR per check: a stale pytest-of-$USER basetemp that old pytest cannot delete otherwise errors every
# tmpdir test (pytest 5.x on 6116: 70 errors, PASS_TO_PASS 1/69 even on the untouched base).
T=$(mktemp -d "${TMPDIR:-/tmp}/swecheck.XXXXXX")
TMPDIR=$T "$W/venv/bin/python" "$D/swecheck.py" "$I/f2p.txt" "$I/p2p.txt"
rc=$?
rm -rf "$T"
exit $rc
