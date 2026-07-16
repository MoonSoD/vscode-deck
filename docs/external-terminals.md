# External Terminals

External tools can create Deck Terminals directly in tmux. Deck discovers
matching sessions while the VS Code window is focused, and refreshes again when
the window regains focus.

## Contract

Create sessions on Deck's tmux socket:

```sh
tmux -L deck ...
```

The session name must use Deck's grammar:

```text
wt-<worktree path with :, ., / replaced by _>__term-<N>
```

Choose `N` as max existing terminal number for that worktree plus one. Example:

```text
/work/repo:feature.branch -> wt-_work_repo_feature_branch__term-1
```

A fully conforming Terminal is created with:

```sh
tmux -L deck new-session -d \
  -s "$session" \
  -e "DECK_SESSION=$session" \
  -c "$worktree_path"
```

Do not pass a manual tmux window name. Deck relies on tmux automatic rename so
agent labels can follow the foreground command.

## Degradation

If the session name matches Deck's grammar, the row appears in the tree. If
`DECK_SESSION` or the cwd flag is missing, it appears as a plain Terminal:
agent hooks, AgentStatus, notifications, and TerminalSnapshot resume may not
work.

## Reference Script

Use the script instead of reimplementing the naming rules:

```sh
scripts/create-external-terminal.sh /path/to/worktree
scripts/create-external-terminal.sh /path/to/worktree claude
```

The script lists live Deck sessions, allocates the next terminal number,
creates the session with `DECK_SESSION` and cwd, prints the session name, and
sends the optional command if one is provided.
