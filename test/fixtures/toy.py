import os
import sys

DEFAULT_ANSWER = "USA"
def main (argv):
    question = argv[1]
    memory = os.environ.get("TOY_MEMORY", "")  # a file setup seeded from a CUJ's given, if any
    known = f" (I remember: {open(memory).read().strip()})" if os.path.isfile(memory) else ""
    print(f"answer to question {question} = {DEFAULT_ANSWER}{known}")
if __name__ == "__main__":
    main(sys.argv)
