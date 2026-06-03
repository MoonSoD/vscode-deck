# Deck (VS Code)

A VS Code extension that hosts a unified
**Projects & Worktrees** tree in the Activity Bar, switches worktrees in
one window without reload, and restores per-worktree tab snapshots.

## Behavioural guidelines

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables your changes orphaned. Leave pre-existing dead code alone unless asked.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals. State plans as numbered steps with explicit verify checks.

## Architecture biases

- **Small interfaces, deep modules.** Each module exposes a narrow API; complexity hides behind it.
- **Validate at boundaries.** Reject invalid input at extension entry points; trust internal calls.
- **Domain naming.** Use the vocabulary in [CONTEXT.md](./CONTEXT.md). Avoid "workspace" — it's overloaded.
- **Co-locate what changes together.** A feature's tree node, command, and behavior live near each other.

## Testing biases

- New behavior ships with tests.
- Test observable behavior (what the extension does to `vscode.window.tabGroups`, not how it does it).
- Prefer the fastest test that gives confidence; use `@vscode/test-electron` for integration cases.

## Companion documents

- **[CONTEXT.md](./CONTEXT.md)** — domain glossary
- **[docs/adr/](./docs/adr/)** — architectural decisions
- **[docs/references.md](./docs/references.md)** — reference repos cloned under `references/`
- **[.sandcastle/CODING_STANDARDS.md](./.sandcastle/CODING_STANDARDS.md)** — enforced at review
