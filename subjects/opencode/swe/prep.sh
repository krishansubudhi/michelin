#!/bin/bash
# prep.sh <instance> <work>: clone a SWE-bench instance's repo at its base commit into <work>/repo, with a venv in
# <work>/venv holding the repo (editable) and its test deps. Data: <this folder>/<instance>/env.sh (REPO, BASE,
# VER, PY, and PIP: one requirement per line). Test: bash prep.sh pytest-dev__pytest-7373 /tmp/x
set -e
D=$(cd "$(dirname "$0")" && pwd)/$1
W=$2
[ -f "$D/env.sh" ] || { echo "prep failed: no instance $1 in $(dirname "$D")"; exit 1; }
. "$D/env.sh"
command -v "$PY" >/dev/null || PY=python3
git clone -q --filter=blob:none "https://github.com/$REPO" "$W/repo"
git -C "$W/repo" checkout -q "$BASE"
"$PY" -m venv "$W/venv"
export SETUPTOOLS_SCM_PRETEND_VERSION=$VER.0
"$W/venv/bin/pip" -q install -U "pip<25" >/dev/null 2>&1
"$W/venv/bin/pip" -q install -r "$D/requirements.txt" >/dev/null 2>&1
(cd "$W/repo" && "$W/venv/bin/pip" -q install -e . >/dev/null 2>&1)
echo "prep ok: $REPO at $BASE in $W/repo, venv $W/venv ($("$W/venv/bin/python" --version))"
