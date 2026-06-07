# Spike: tmux control mode as Deck terminal transport

Validation spike for ADR-0012 / PRD #55, slice 1. Run `node spike.mjs`
(spawns a throwaway tmux server on socket `deckspike` with the real
`resources/deck.conf`). `transcript.txt` is a recorded raw control-mode
stdout capture — keep it as a test fixture for `TmuxControlClient`.

Environment: tmux 3.6b, macOS (darwin 25), node 24.

## Findings

| # | Question | Result |
|---|---|---|
| Q0 | Does `tmux -C` need a tty? | **No.** Full protocol over plain pipes; `child_process.spawn` suffices. node-pty is droppable. (`-CC` DOES need a tty: `tcgetattr` failure — so `-C` is the forced choice.) |
| Q1 | Do all 1000 lines of `seq 1 1000` arrive via `%output`? | **Yes, missing=0.** Control mode fixes QA F6's lossy-scrollback root cause. |
| Q2 | `send-keys -H` size limit? | **8192 hex args OK; 16384 fails** with `parse error: yacc stack overflow` (tmux command parser arg limit). Failure mode: clean `%error` reply, nothing reaches the pane. **Chunk pastes at ≤4096 bytes per send-keys command.** |
| Q2b | UTF-8 / emoji through `-H`? | **Byte-exact round-trip** (`héllo wörld 日本語 🚀🎉`). |
| Q3 | Raw SGR mouse bytes via `-H` reach the pane app? | **Yes, byte-exact** (`\x1b[<0;10;10M` press/release). No `send-keys -M` fallback needed. |

## Implementation notes for TmuxControlClient

- `%output` payload: bytes < 0x20 and `\` arrive octal-escaped (`\015`,
  `\134`); decode escapes into a byte buffer first, THEN UTF-8-decode
  (see `decodeOctalEscapes` in spike.mjs — promote + test).
- Shell/title escapes (`\033kseq\033\\`) appear inline in `%output` —
  the decoder must not strip them; they're real pane bytes for xterm.
- Error replies are `%begin … <message> … %error` blocks — the message
  line (`parse error: …`) is INSIDE the block, not on the `%error` line.
- A failed `send-keys` delivers nothing (atomic): safe to retry/chunk
  without partial-input worries.
