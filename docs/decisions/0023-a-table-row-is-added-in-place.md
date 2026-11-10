# 0023 a table row is added in place

Status: accepted, 2026-10-15 (0.9.0). Extends the write model of [ADR 0005](0005-the-write-model.md).

## context

ADR 0005 gives a caller two shapes for a section: append text to it, or replace its body. Recording one more item in a tracked table forced the second shape over a larger range than the change:

```sh
tsuzuri section put note.md --heading checks --if-hash "$H" <<'ROWS'
| date | question | what the answer showed | link |
| 2026-10-16 | … | … | … |
ROWS
```

The caller reads the section, rebuilds every earlier row, and writes it back. A mistake in that rebuild drops history that nothing else holds, and the diff shows a whole section changed for one row. `append` cannot help: it adds after the section's last character, which is not the same place as after the table's last row when the section holds anything else.

## decision

- **`section row <note> <row> --heading <heading>`** (`Vault.appendRow`, an `appendRow` operation of kind `edit`) inserts one row after the last row of the section's first table, and nothing else changes.
- **The row must have as many cells as the header.** A row of a different width is refused with both counts named, because a short or long row is a table the other parsers will break on.
- **A section without a table is refused** and the note is left alone. Plain text in a section stays `append`'s job.
- **`--if-hash` and `--dry-run` apply**, as for every other edit.
- Cells split on pipes that are not escaped, so `\|` inside a wikilink alias or a code span stays in its cell.

## alternatives considered

- **Make `append` table-aware:** rejected; `append` means "add text at the end of this section", and inferring that the last block is a table from the text shape would surprise a caller appending a paragraph that starts with a pipe.
- **Rewrite the section but keep the rows (a merge):** rejected; it needs a diff over Markdown tables, and the failure mode is the same silent loss with more code.
- **A general table model:** rejected as too much for the need; the vault client knows no layout, and this rule only needs to count cells and find the last row.

## consequences

One check is one row, and the diff shows one line. A caller building a table from nothing still uses `section put`. Column widths are not recomputed and no cell is padded, so a hand-written table stays as its owner wrote it.
