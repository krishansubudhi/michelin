Keep your own subjects in a repo of their own and point `MICHELIN_SUBJECTS` at it (colon-separated, like `PATH`). A subject, CUJ or settings path that doesn't exist as given is looked up there:

```sh
export MICHELIN_SUBJECTS=~/my-subjects
michelin run my-app my-app/cujs/smoke/ --settings settings/my-app.json
```
