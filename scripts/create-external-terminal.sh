#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: $0 WORKTREE_PATH [COMMAND...]" >&2
  exit 2
fi

worktree_path=$1
shift

if [ ! -d "$worktree_path" ]; then
  echo "worktree path is not an existing directory: $worktree_path" >&2
  exit 1
fi

safe_worktree=$(printf '%s' "$worktree_path" | sed 's#[.:/]#_#g')
prefix="wt-${safe_worktree}__term-"
sessions=$(tmux -L deck list-sessions -F '#{session_name}' 2>/dev/null || true)
max=0

while IFS= read -r session; do
  case "$session" in
    "$prefix"*)
      n=${session#"$prefix"}
      case "$n" in
        ''|*[!0-9]*) ;;
        *)
          if [ "$n" -gt "$max" ]; then
            max=$n
          fi
          ;;
      esac
      ;;
  esac
done <<EOF
$sessions
EOF

term=$((max + 1))
session="${prefix}${term}"

tmux -L deck new-session -d -s "$session" -e "DECK_SESSION=$session" -c "$worktree_path"

if [ "$#" -gt 0 ]; then
  command=$*
  tmux -L deck send-keys -t "=$session" -l -- "$command"
  tmux -L deck send-keys -t "=$session" Enter
fi

printf '%s\n' "$session"
