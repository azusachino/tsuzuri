# Configuration

tsuzuri reads any Markdown folder without a config file. The CLI uses `--vault <dir>`, then `$TSUZURI_VAULT`, then the nearest ancestor of cwd holding `tsuzuri.toml`, then cwd. SDK callers pass the root to `Vault` or `Vault.open`.

Run `tsuzuri init --dry-run` to preview a starter `tsuzuri.toml` and `templates/capture.md`; `tsuzuri init` writes them only when neither target exists. `tsuzuri config --json` prints the effective root, settings, and their sources. Each setting resolves from code options, then `tsuzuri.toml`, then a default. tsuzuri does not read `.obsidian/` configuration.

## Core settings

| Setting | Key | Default |
| --- | --- | --- |
| Capture folder | `[capture] folder` | vault root |
| Capture filename pattern | `[capture] filename` | `{{title}}` |
| Type route | `[types.<type>] folder`, `filename` | capture route |
| Template folder | `[templates] folder` | `templates/` if that folder exists; otherwise unset |
| Template date format | `[templates] date_format` | `YYYY-MM-DD` |
| Template time format | `[templates] time_format` | `HH:mm` |
| Tag spelling | `[tags] style` | `as-written`; or `kebab` |
| Required tags | `[tags] require` | `false` |
| Rejected tags | `[tags] reject` | `[]` |
| Title case | `[titles] case` | `as-written`; or `lowercase` |
| Preserved title words | `[titles] keep` | `[]` |

Folders are relative to the vault root. A filename pattern and a template can use `{{title}}`, `{{slug}}`, `{{date}}`, `{{time}}`, or a formatted value such as `{{date:YYYY}}`. A type's route overrides only the fields it names; the others come from the capture route. Type names match template files without case sensitivity. `new <type> <title>` needs a template; `capture` works without one.

```toml
[capture]
folder = "Inbox"
filename = "{{slug}}"

[templates]
folder = "templates"

[types.book]
folder = "Books"
filename = "{{slug}}-{{date:YYYY}}"

[tags]
style = "kebab"
require = true
reject = ["todo"]

[titles]
case = "lowercase"
keep = ["OpenAI", "iPhone"]
```

A vault can also list `extensions = ["tsuzuri:journal"]` and its `[journal.<period>]` tables; see the [extension guide](extensions.md). Extensions can add their own settings tables and operations. `Vault.open` loads listed extensions, with vault-owned code requiring explicit trust. Code options use the same shape as the TOML file and override its settings. The `extensions` lists from both sources are merged.

Unknown keys, invalid values, or removed capture keys raise `ConfigError` with a suggested replacement. Frontmatter and headings belong in template files, not settings. `tsuzuri types` lists templates and their routes; `tsuzuri check <note>` checks its template's frontmatter keys and the tag/title rules.

The [CLI reference](cli.md) lists every command, option, JSON result, and exit code. [ADR 0014](decisions/0014-note-types-from-templates.md) explains why templates define types and TOML only routes and checks them.
