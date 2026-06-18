# ADR-0047: Custom icon font for the tree terminal-row glyph

## Context

A Terminal's sidebar row shows a left icon that varies by what's running:
agent rows use padded raster assets (PNG identity / animated GIF working), and
non-agent rows show a plain terminal glyph. The rasters are deliberately padded
to a shared geometry (the icon padding standard — see
`docs/icon-guidelines.md`) so every icon in that column aligns on one optical
midline. A non-agent glyph that *can't* be padded lands a few pixels off its
agent siblings, and the column reads as ragged.

Getting a paddable **and** theme-tintable **and** dimming glyph forces a
three-way trade-off, none of it obvious from the code:

- **Built-in `terminal` codicon** — free, theme-tinted, dims when unfocused, but
  locked to a fixed 16px box. No padding control, so it can't be aligned with
  the padded agent rasters.
- **SVG `iconPath`** — full geometry control, but VS Code renders custom tree
  SVGs **uncolorable** (microsoft/vscode#311339, the same constraint behind
  ADR-0025) — no theme tint, no unfocus dim.
- **Custom font glyph** — tintable and dimming like a codicon, paddable like an
  SVG. Wins on capability at the cost of a font asset, a build step, a licensing
  question, and two non-obvious gotchas.

## Decision

Ship a one-glyph font, `resources/deck-icons.woff` (`U+E001`), contributed via
`package.json` → `contributes.icons.deck-terminal` and used as
`new vscode.ThemeIcon('deck-terminal')` for the non-agent Terminal **sidebar
row**.

1. **The glyph is the codicon `terminal` glyph**, scaled to ink 0.70 and
   centered per the icon padding standard, so it sits on the same optical
   midline as the padded agent rasters. (0.70, not the default 0.80: a filled
   terminal square reads heavier than a detailed logo at equal box.)

2. **Licensing: embed with attribution.** Codicons are MIT; the repo ships the
   MIT license + copyright notice (`resources/deck-icons.LICENSE` or a `NOTICE`
   entry). Authoring an original glyph was rejected — it would spend design
   effort to reproduce the very VS Code terminal mark we want to stay consistent
   with.

3. **The editor tab does *not* use the font.** A tab has no indent guide and no
   sibling-alignment constraint, so it uses the built-in `terminal` codicon
   directly (full size, theme-tinted, dims when unfocused like VS Code's own
   terminal tab). The font exists *solely* to align the sidebar row.

4. **The glyph is generated, not hand-tuned.** `scripts/generate-tree-icons.py`
   produces `deck-icons.woff` (and every padded raster) deterministically from
   the padding standard's constants — the single source of truth (see
   `docs/icon-guidelines.md`). Hand-made assets are prohibited; regenerate and
   commit.

## Distinguished from ADR-0025

ADR-0025 keeps the agent **identity/working** marks as rasters because custom
tree SVGs render black (microsoft/vscode#311339) and animated GIFs are the only
sanctioned animated tree icon. This ADR addresses the *non-agent* glyph, where
there's no animation requirement — so a font glyph (which #311339 does **not**
affect: font glyphs tint and dim normally) is available and preferred over both
an uncolorable SVG and an unpaddable codicon.

## Consequences

- `contributes.icons` loads **only on a window reload**, not on a tree refresh —
  the glyph won't appear in the Extension Development Host until
  *Developer: Reload Window*.
- The generator must set the glyph's `hmtx` **left-side-bearing = `xMin`** after
  transforming it, or VS Code renders it flush-left (ignoring the intended left
  margin). This cost real debugging time; it lives as a comment in the
  generator.
- The repo gains a binary font asset + a Python (Pillow + fontTools) generation
  script. The script is checked in and the assets are committed; Python is **not**
  added to the extension build/packaging step.
- Ships an MIT NOTICE for the embedded codicon glyph.

## Status

Accepted. Implementation pending — the tree icon-system change that introduces
`scripts/generate-tree-icons.py` and `docs/icon-guidelines.md`.
