"""swecheck.py: run a SWE-bench instance's tests and count FAIL_TO_PASS / PASS_TO_PASS passes.

Usage (in the repo, its venv active): python swecheck.py f2p.txt p2p.txt
Runs pytest -rA once on every test file the two lists name, then prints each list's passed count, e.g.
FAIL_TO_PASS 2/2 passed, PASS_TO_PASS 67/68 passed, and the ids that did not pass.
"""

import re
import subprocess
import sys


def ids(path):
    return [line.strip() for line in open(path) if line.strip()]


f2p, p2p = ids(sys.argv[1]), ids(sys.argv[2])
files = sorted({i.split("::")[0] for i in f2p + p2p})
out = subprocess.run([sys.executable, "-m", "pytest", "-rA", *files],
                     capture_output=True, text=True).stdout
passed = set(re.findall(r"^(?:PASSED|XFAIL|XPASS) (\S.*?)(?: - .*)?$", out, re.M))
passed |= {p.strip() for p in passed}
print(out.strip().splitlines()[-1] if out.strip() else "(no pytest output)")
for name, want in (("FAIL_TO_PASS", f2p), ("PASS_TO_PASS", p2p)):
    # SWE-bench cuts an id at its first space, e.g. "t.py::test_x[a": that one matches by prefix.
    miss = [i for i in want if i not in passed and not ("[" in i and any(p.startswith(i) for p in passed))]
    print(f"{name} {len(want) - len(miss)}/{len(want)} passed")
    for i in miss[:20]:
        print(f"  not passed: {i}")
