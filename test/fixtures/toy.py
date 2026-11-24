import sys

DEFAULT_ANSWER = "USA"
def main (argv):
    question = argv[1]
    print(f"answer to question {question} = {DEFAULT_ANSWER}")
if __name__ == "__main__":
    main(sys.argv)
