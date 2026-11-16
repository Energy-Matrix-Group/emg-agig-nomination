# Versioning

Each repository has a `VERSION` file, `major.minor.patch`. The help desk shows the `emg-ticketing` number. That number is read from the file at startup. It is not typed into the ticketing source.

## What a push to `main` does

`main` changes only when Mat Harvey promotes `test` to it (see `AGENTS.md`), so this runs once per promotion, over every commit promoted together.

1. GitHub Actions reads `VERSION` from the latest `main` and the messages of every commit in the push.
2. The patch number goes up by one. A line `Version: minor` or `Version: major` in any of those messages resets the lower numbers and steps that part instead. When several commits ask, the largest step wins.
3. It commits the new `VERSION` on top of the latest `main`, pushes, and tags `vX.Y.Z`. That commit message contains `[skip version]`, so it does not bump again.
4. Publishing the note into Documentation is paused (`if: false` on the "Write the patch note" step in every repository). Version bumps and tags still run. Remove that condition to publish notes again.

Without `Version:` in a message, every push to `main` is a patch.

Runs are queued one at a time (`concurrency: release-main`), so two quick pushes get consecutive numbers. GitHub keeps only the newest waiting run: if three pushes land while one is running, the middle one is skipped, and its commits are not listed in any note.

## Patch notes

The note is a page in the **Patch notes** space (`slug` `patch-notes`). The title is the repository and the version, for example `emg-ticketing 1.0.2`. A repeat of the same version updates that page.

The model is Azure OpenAI when `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, and `AZURE_OPENAI_DEPLOYMENT` are set, otherwise OpenAI when `OPENAI_API_KEY` is set. If neither is set, the page still records the commit subjects and the file list, and says an AI summary was not available.

## Secrets

Set these on each GitHub repository:

| Secret | Value |
| --- | --- |
| `DOCS_API_ORIGIN` | The address of the `emg-documentation` service, such as its test address `https://documentation-test.apps.energymatrix.com.au` (the production address is not recorded here). Must be `https` (plain `http` is refused except for `localhost`). |
| `RELEASE_NOTES_TOKEN` | Same long random string as `RELEASE_NOTES_TOKEN` on the `emg-documentation` service. |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint, optional. |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI key, optional. |
| `AZURE_OPENAI_DEPLOYMENT` | Deployment name, optional. |
| `OPENAI_API_KEY` | Used only when the Azure trio is unset. |

`RELEASE_NOTES_TOKEN` is also a setting that `emg-documentation` reads (see its `.env.example`). The release route, `POST /api/docs/releases`, accepts that bearer token, or a signed-in user who can edit the Patch notes space. Every repository has the same workflow and its own `VERSION`. Its notes use its own name as the title prefix.
