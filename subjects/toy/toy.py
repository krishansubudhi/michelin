import os
import sys

# Two versions of the agent under test, for an A/B (README, docs/compare.md): TOY_VARIANT=v1 (the default) answers,
# TOY_VARIANT=v2 is a broken build that never gives the answer.
ANSWERS = {"v1": "USA", "v2": "I am not sure"}
def main (argv):
    question = argv[1]
    answer = ANSWERS.get(os.environ.get("TOY_VARIANT", "v1"), ANSWERS["v1"])
    print(f"answer to question {question} = {answer}")
if __name__ == "__main__":
    main(sys.argv)
