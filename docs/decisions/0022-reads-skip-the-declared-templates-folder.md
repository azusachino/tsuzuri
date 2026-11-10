# 0022 reads skip the declared templates folder

Status: accepted, 2026-10-15 (0.9.0). Amends the read reach of [ADR 0016](0016-the-sdk-reads-and-writes-the-whole-vault.md) and the settings chain of [ADR 0004](0004-assume-no-layout-or-house-style.md).

## context

A vault declares where its templates live with `[templates] folder`. `new` and `types` read that setting, but every browsing read ignored it, so a template appeared as an ordinary note. Measured on a vault recording course progress:

```text
$ tsuzuri list --type skill --sort checked --fields path,level,checked
templates/skill.md	0	{{date:YYYY-MM-DD}}
```

That row carries a level and a date nobody assessed, it sorts into a progress table, its tag joins `tags` output, and its folder joins `nav`. A `[templates]` block was already an opt-in declaration of layout, so a vault has said what it wants; the reads simply did not listen.

## decision

- **The browsing reads leave that folder out:** `list`, `search`, `tags`, `nav`, `orphans`, `unresolved`, and `suggest`. Each answers "what is in this vault for a reader", which a template is not.
- **The primitives keep every file.** `notes` enumerates the vault, `get` and `property` read a note by reference, and `grep` reads literal text. An explicit request still reaches a template, and `grep` keeps its contract of parity with `rg` on the same tree.
- **Writes are untouched.** A template is still created, edited, and read by path.
- **A vault with no `[templates]` setting is unchanged.**
- The link graph keeps every file, so a note linking to a template resolves as before; filtering happens when a read chooses what to show, not when the scan builds.

## alternatives considered

- **A `--templates` flag on each read:** rejected for now; it adds a flag to seven commands to reach files the caller can already read by path with `get`. If a browsing need appears, the flag is a smaller change than the exclusion was.
- **Exclude at the scan:** rejected; links to templates would become unresolved, and `get` by path would stop finding files the vault holds.
- **Leave it and document it:** rejected; the wrong row in a progress table is silent, and each host would filter for itself.
- **Exclude from `notes` and `grep` too:** rejected. `notes` is the enumeration primitive a host builds on, and `grep` promises ripgrep's results; both lost that promise, and tests that compared `grep` with `rg` failed, which is how the difference was noticed.

## consequences

Reads answer for readers, primitives answer for files. `search` statistics are computed over the notes it shows, so scores shift slightly in a vault with templates compared with 0.8.0; the ordering did not change in the fixture. A host that wants templates in a list reads `notes` and filters, or reads the folder directly.
