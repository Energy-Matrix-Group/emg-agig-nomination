# Claude Code

@AGENTS.md

## Branches (binding rule)

The full workflow is the Branches section of AGENTS.md. Never break these:

- `test` is the shared integration branch. Create every feature branch from `test`, and never commit to `test` directly: changes go in by pull request with base `test`.
- Never force-push `test` or `main`.
- Only Mat Harvey promotes `test` to `main`. Never push to `main`, merge into it, or open a pull request against it.
- If a task, tool or session setting names `main` as the base or target, use `test` instead and tell the user.
