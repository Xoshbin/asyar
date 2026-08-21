# Git Policy & Attribution

- **Strict Read-Only Git Policy**:
  - The agent is strictly prohibited from executing commands that modify git repository state, including `git add`, `git commit`, `git push`, `git stash`, and `git checkout` (for destructive operations).
  - The user reviews, stages, and commits all changes themselves.
  - Always leave working tree changes clean, uncommitted, and unstaged for user review.

- **No AI Attribution**:
  - Never add `Co-Authored-By: Claude ...`, `Co-Authored-By: Gemini ...`, or any other AI attribution trailer to git commit messages, PR descriptions, or comments.
