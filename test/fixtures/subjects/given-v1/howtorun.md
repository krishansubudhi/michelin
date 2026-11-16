The subject is a command-line program. Ask it one question per call:

    python3 test/fixtures/toy.py "<question>"

Run it from the michelin folder (the prompt gives its path). If setup's output names TOY_MEMORY=<file>, run every call as `TOY_MEMORY=<file> python3 test/fixtures/toy.py "<question>"`.

Whatever it prints is its reply.
