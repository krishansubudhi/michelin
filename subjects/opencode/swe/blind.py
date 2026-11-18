"""blind.py: build a run folder for `michelin compare` whose evidence is only the issue and the program's diff.

Usage: python3 blind.py OUT MODEL CUJDIR...
  OUT     the run folder to write, e.g. /tmp/blind/gemma (replaced if it exists)
  MODEL   the model the run used, e.g. ollama/gemma4:26b-mlx (compare scrubs it from what the judge reads)
  CUJDIR  a finished SWE CUJ folder holding opencode.patch, e.g. .runs/<run>/swe-pytest-7432

A SWE CUJ's own executor.json carries check.sh's output (FAIL_TO_PASS / PASS_TO_PASS counts) and its instruction and
expectations name check.sh, so a judge comparing those runs reads the test results. This folder holds, per CUJ, the
issue text (problem.md) in the task and the saved opencode.patch as the only journey step: no test output, no counts,
no hidden test patch. Run the hidden tests afterwards, outside the judged evidence, on the same patch:
hidden.sh <instance> <patch> <work>.
Test: python3 blind.py /tmp/b ollama/x ../../../.runs/<run>/swe-pytest-7432 && cat /tmp/b/swe-pytest-7432/executor.json
"""

import glob
import json
import os
import shutil
import sys

SWE = os.path.dirname(os.path.abspath(__file__))

EXPECTATIONS = [
    "The change fixes the bug the issue describes, in the project's source code, not only in tests or scratch files.",
    "The change is correct and minimal: it keeps other behaviour working and adds no unrelated edits.",
]


def instance(cuj):
    """The SWE-bench instance folder for a CUJ id, e.g. swe-pytest-7432 -> <SWE>/pytest-dev__pytest-7432."""
    found = glob.glob(os.path.join(SWE, "*__" + cuj.removeprefix("swe-")))
    if len(found) != 1:
        sys.exit(f"blind.py: no single instance folder for {cuj} in {SWE}")
    return found[0]


def env(folder):
    """env.sh's NAME=value lines as a dict, e.g. {"REPO": "pytest-dev/pytest", "BASE": "e6e300e7..."}."""
    pairs = (line.strip().split("=", 1) for line in open(os.path.join(folder, "env.sh")) if "=" in line)
    return dict(pairs)


def task(folder):
    """The blind instruction: the repo, the message the program got, and the issue. No word about tests."""
    e = env(folder)
    problem = open(os.path.join(folder, "problem.md")).read().strip()
    return (
        f"A bug-fix task in the {e['REPO']} repository, checked out at commit {e['BASE'][:12]}. The program, an AI "
        "coding agent, was started in that checkout with the message \"Fix this issue in the repo.\" followed by the "
        "issue below. Its evidence is its whole change to the repo (git diff), nothing else. Judge which change "
        f"better fixes the issue.\n\nIssue:\n{problem}\n"
    )


def main(out, model, cujdirs):
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    defs = {}
    for d in cujdirs:
        cuj = os.path.basename(os.path.normpath(d))
        folder = instance(cuj)
        patch = open(os.path.join(d, "opencode.patch")).read()
        defs[cuj] = {"instruction": task(folder)}
        os.makedirs(os.path.join(out, cuj))
        step = {"input": "git diff (the program's whole change to the repo)", "got": patch or "(empty: no change)"}
        executor = {"ok": True, "data": {"steps": [step], "reply": "The program's change is the diff above."}}
        json.dump(executor, open(os.path.join(out, cuj, "executor.json"), "w"), indent=2)
        json.dump([{"expectation": x} for x in EXPECTATIONS], open(os.path.join(out, cuj, "verdict.json"), "w"))
        shutil.copy(os.path.join(d, "opencode.patch"), os.path.join(out, cuj, "opencode.patch"))
    run = {"subject": "subjects/opencode", "settings": {"executor": {"model": model}}, "defs": defs}
    json.dump(run, open(os.path.join(out, "run.json"), "w"), indent=2)
    json.dump({"data": {"notes": f"MODEL={model}"}}, open(os.path.join(out, "constructor.json"), "w"))
    print(f"blind run: {out} ({len(defs)} CUJs, model {model})")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
