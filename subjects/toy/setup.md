1. Check that `python3 --version` works.
2. Check that `subjects/toy/toy.py` exists.
3. Print `TOY_VARIANT=<value>`, the value of the `TOY_VARIANT` environment variable, or `v1` if it is unset. It picks which version of the toy answers: `v1` answers, `v2` is a broken build that never does.

If either check fails, stop and report that setup failed.
