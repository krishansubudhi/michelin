1. Check that `python3 --version` works.
2. Check that `test/fixtures/toy.py` exists.

If either check fails, stop and report that setup failed.

Seed given: the toy's only memory is a text file it reads when TOY_MEMORY names it. Write each entry of the given's `memory` list as one line to memory.txt in the run's scratch folder, and put `TOY_MEMORY=<that file's full path>` and `given memory: seeded` on their own lines in your notes. Any other given key: `given <key>: FAIL the toy has no such state`.
