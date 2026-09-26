# cli reference

Every `tsuzuri` command, its options, and what `--json` returns. `tsuzuri help <command>` prints the same for one command, and `tsuzuri help --json` prints all of it as JSON. A test fails when this page misses a command or option the CLI declares.

## global options

| Option | Meaning |
| --- | --- |
| `--vault <dir>` | vault root (default: $TSUZURI_VAULT, then nearest ancestor with tsuzuri.toml, then cwd) |
| `--json` | machine-readable output and errors, the same as --format json |
| `--format <text\|json\|paths>` | paths prints one path per line, for xargs and fzf |
| `--trust` | run the extension modules the vault itself lists (bundled tsuzuri: extensions need no trust) |
| `-h, --help` | show help, for one command when one is given |
| `-v, --version` | show the version |

The vault is `--vault`, else `$TSUZURI_VAULT`, else the nearest ancestor of the current directory holding `tsuzuri.toml`. Without that file anywhere above, it uses the current directory. A command refuses an option it does not take. A text argument that starts with a dash and a space, or a negative number, is text rather than an option; anything else starting with a dash goes after `--`.

A vault's extensions add commands of their own, such as the bundled journal's `journal` and `journal append`; `tsuzuri help` lists them, and [extensions](extensions.md) describes them. They load when a vault lists them in `tsuzuri.toml`; a module the vault itself holds runs only with `--trust`, or when the vault's root is in `vaults` in `$XDG_CONFIG_HOME/tsuzuri/trust.toml`.

## output and errors

Text output is for people. With `--json`, stdout is one JSON value, shaped as each command below says. Commands that return notes share one summary: `path`, `title`, `type`, `status`, `tags`, `created`, and `modified`, the optional ones only when set. The title comes from frontmatter, then a first H1, then the filename. `--fields a,b` keeps only the named fields, a summary field or any frontmatter key, `null` when absent, and `--format paths` prints one path per line.

With `--json`, a failure prints one line on stderr, `{"error": {"name", "message", ...}}`, with the error's own fields: `suggestions` on `NotFoundError`.

| Exit | Meaning |
| --- | --- |
| 0 | done |
| 1 | a request tsuzuri refused or could not serve: `NotFoundError`, `WriteConflictError`, `UnsupportedError`, `ConfigError`, and the other `TsuzuriError`s |
| 2 | bad usage: `UsageError` |

## reads

### types

`tsuzuri types`

List each template-backed type with its template path, effective destination folder, and filename pattern. With `--json`, returns objects with `type`, `template`, `folder`, and `filename`.

```sh
tsuzuri types --json
```

### check

`tsuzuri check <note>`

Check for frontmatter keys declared by the note type's template and the vault's `[tags]` and `[titles]` rules. A note without a `type` property uses the capture template. With `--json`, returns `path`, `type`, `ok`, `missing`, and `errors`. Exits 1 when a check fails.

```sh
tsuzuri check "Working memory" --json
```

### config

`tsuzuri config`

Show the resolved vault root and effective settings, including loaded extension table values. Each setting has a `name`, `value`, and `source` (`options`, `tsuzuri.toml`, `default`, or both when the extension list is merged). With `--json`, returns `root` and `settings`.

```sh
tsuzuri config --json
```

### get

`tsuzuri get <note>`

Print one note by path, file name, title, or alias; the JSON carries its hash for --if-hash.

| Option | Meaning |
| --- | --- |
| `--lines <a:b>` | lines a to b, counted from the top of the file (a:, :b, or one line) |
| `--around <line\|path:line>` | a line and --context lines either side; accepts rg -n output |
| `-C, --context <n>` | lines either side (get --around: 5 by default) |
| `--max-chars <n>` | truncate the note body |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: a note: the summary fields, `frontmatter`, `body`, `hash`, `truncated`, and with `--lines` or `--around` its `start`, `end`, and `total` lines.

```sh
tsuzuri get "Working memory" --lines 1:20 --json
```

### search

`tsuzuri search <query...>`

Rank notes by relevance (BM25; CJK matches as substrings).

| Option | Meaning |
| --- | --- |
| `--type <type>` | only notes whose type property is this |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--status <status>` | only notes whose status property is this |
| `--under <folder>` | only notes in this folder |
| `--where <key=value\|key>` | filter on any frontmatter property; may repeat; a bare key means present |
| `--limit <n>` | most results |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: hits: the summary fields plus `score` and `snippet`.

```sh
tsuzuri search cognitive load --limit 5 --json
```

### grep

`tsuzuri grep <pattern>`

Matching lines as path:line:text, like rg -n (smart case).

| Option | Meaning |
| --- | --- |
| `--type <type>` | only notes whose type property is this |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--status <status>` | only notes whose status property is this |
| `--under <folder>` | only notes in this folder |
| `--where <key=value\|key>` | filter on any frontmatter property; may repeat; a bare key means present |
| `-F, --fixed-strings` | match the pattern as literal text |
| `-C, --context <n>` | lines either side (get --around: 5 by default) |

With `--json`: hits: `path`, `line`, `text`, and with `-C` the `before` and `after` lines.

```sh
tsuzuri grep -F "working memory" -C 2
```

### find

`tsuzuri find <query...>`

Fuzzy match over paths, titles, and aliases, ranked as fzf ranks. Each word of the query must match; a CJK phrase written without spaces is split into its words, so `分布式事务` finds the same notes as `分布式 事务`.

| Option | Meaning |
| --- | --- |
| `--type <type>` | only notes whose type property is this |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--status <status>` | only notes whose status property is this |
| `--under <folder>` | only notes in this folder |
| `--where <key=value\|key>` | filter on any frontmatter property; may repeat; a bare key means present |
| `--limit <n>` | most results |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: suggestions: the summary fields plus `score` and the `matched` path, title, or alias.

```sh
tsuzuri find cogload --json
```

### list

`tsuzuri list`

Notes matching the filters, optionally sorted.

| Option | Meaning |
| --- | --- |
| `--type <type>` | only notes whose type property is this |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--status <status>` | only notes whose status property is this |
| `--under <folder>` | only notes in this folder |
| `--where <key=value\|key>` | filter on any frontmatter property; may repeat; a bare key means present |
| `--sort <modified\|created\|title\|path>` | order; notes without the value sort last |
| `--desc` | sort descending |
| `--limit <n>` | most results |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: summaries.

```sh
tsuzuri list --tag psychology --sort modified --desc --limit 10
```

### tags

`tsuzuri tags`

Every tag with its note count, parents of nested tags included.

| Option | Meaning |
| --- | --- |
| `--type <type>` | only notes whose type property is this |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--status <status>` | only notes whose status property is this |
| `--under <folder>` | only notes in this folder |
| `--where <key=value\|key>` | filter on any frontmatter property; may repeat; a bare key means present |

With `--json`: `tag` and `notes`, the count, most used first.

```sh
tsuzuri tags --json
```

### nav

`tsuzuri nav [folder]`

A folder's `index.md` or `README.md` note and headings, subfolders, and notes. When both exist, `index.md` is the index.

| Option | Meaning |
| --- | --- |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: `folder`, its `index` note with `headings`, `folders` with note counts, and `notes`.

```sh
tsuzuri nav Topics
```

### links

`tsuzuri links <note>`

A note's outgoing links and how each resolves.

With `--json`: links: `target`, `display`, `embed`, and `resolution`, whose `status` is `resolved` (with `path`), `missing`, `ambiguous` (with `candidates`), or `asset`.

```sh
tsuzuri links "Cognitive load" --json
```

### backlinks

`tsuzuri backlinks <note>`

Notes that link to a note.

| Option | Meaning |
| --- | --- |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: summaries.

```sh
tsuzuri backlinks "Cognitive load"
```

### unresolved

`tsuzuri unresolved`

Links pointing at no note, or at several.

With `--json`: `from`, `target`, and `resolution`.

```sh
tsuzuri unresolved --json
```

### orphans

`tsuzuri orphans`

Notes no other note links to or embeds.

| Option | Meaning |
| --- | --- |
| `--type <type>` | only notes whose type property is this |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--status <status>` | only notes whose status property is this |
| `--under <folder>` | only notes in this folder |
| `--where <key=value\|key>` | filter on any frontmatter property; may repeat; a bare key means present |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: summaries.

```sh
tsuzuri orphans --under Topics
```

### outline

`tsuzuri outline <note>`

A note's headings with their line numbers.

With `--json`: headings: `level`, `text`, and `line`.

```sh
tsuzuri outline "Cognitive load"
```

### prop get

`tsuzuri prop get <note> <key>`

One frontmatter value.

With `--json`: the value as YAML parsed it.

```sh
tsuzuri prop get "Cognitive load" tags --json
```

### help

`tsuzuri help [command]`

This usage, one command's help, or every command as JSON with --json.

With `--json`: `version`, the `global` options, and `commands` with their `operation`, `options`, and `example`; `operation` names the entry of the SDK's `OPERATIONS` a command runs.

```sh
tsuzuri help get
```

## writes

### init

`tsuzuri init`

Write a commented starter `tsuzuri.toml` and `templates/capture.md`. Refuses to overwrite either file. `--dry-run` prints both proposed files without writing, even when they already exist. With `--json`, returns `files` (each path and content) and `written`.

| Option | Meaning |
| --- | --- |
| `--dry-run` | show the result, a diff for edits, without writing |

```sh
tsuzuri init --dry-run --json
```

Every edit takes `--dry-run` for a unified diff, `--if-hash` to refuse a note changed since `get` returned that hash, and `capture` and `new` only create notes.

### capture

`tsuzuri capture [text...]`

Create a new note from text, --file, or stdin; never edits a note. A `templates/capture.md` template supplies frontmatter and headings when present. The capture route comes from `[capture]` or `[types.capture]`.

| Option | Meaning |
| --- | --- |
| `--title <title>` | the note's title (default: the first line of text) |
| `--source <url>` | where the note came from |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--file <path>` | read the note from a Markdown file |
| `--dry-run` | show the result, a diff for edits, without writing |

With `--json`: `path`, `content`, and `written`.

```sh
tsuzuri capture --tag reading --source https://example.com "Read: how agents plan" --dry-run
```

### new

`tsuzuri new <type> <title...>`

Create a note from `templates/<type>.md`, or the configured template folder. `[types.<type>]` may route it to a folder and filename pattern; otherwise it uses the capture route.

| Option | Meaning |
| --- | --- |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--dry-run` | show the result, a diff for edits, without writing |

With `--json`: as `capture`.

```sh
tsuzuri new Book The Pragmatic Programmer --dry-run
```

### append

`tsuzuri append <note> [text...]`

Add text at the end of a note, or at the end of section --heading.

| Option | Meaning |
| --- | --- |
| `--heading <heading>` | the section, by heading text |
| `--create-heading` | add a missing heading at the end of the note instead of refusing |
| `--level <1-6>` | the level of a created heading (default: 2) |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |

With `--json`: a write result: `path`, the unified `diff`, `written`, `created`, and the new `hash`.

```sh
tsuzuri append Home "- a new line" --heading "start here" --dry-run
```

### section put

`tsuzuri section put <note> [text...]`

Replace the body of section --heading, or add the section.

| Option | Meaning |
| --- | --- |
| `--heading <heading>` | the section, by heading text |
| `--level <1-6>` | the level of a created heading (default: 2) |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |

With `--json`: a write result, as `append`.

```sh
tsuzuri section put Home "Fresh text." --heading reading --dry-run
```

### prop set

`tsuzuri prop set <note> <key> <value>`

Set one frontmatter key, the value read as YAML, keeping comments and order.

| Option | Meaning |
| --- | --- |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |

With `--json`: a write result, as `append`.

```sh
tsuzuri prop set "Cognitive load" rating 4 --dry-run
```

### write

`tsuzuri write <path> [text...]`

Create a note at any .md path in the vault (text, --file, or stdin); an existing file is refused. Missing folders are created.

| Option | Meaning |
| --- | --- |
| `--file <path>` | read the note from a Markdown file |
| `--dry-run` | show the result, a diff for edits, without writing |

With `--json`: a write result, as `append`, with `created: true`.

```sh
tsuzuri write "Inbox/Fresh.md" "A whole new note." --dry-run
```

### delete

`tsuzuri delete <note>`

Move a note into .trash, keeping its path with a timestamp added; links to it become unresolved. `Topics/x.md` deleted at 11:22:33 on 2026-09-26 becomes `.trash/Topics/x.md.20260926112233`, in local time, with `-2` and on added when that name is taken. The file keeps every byte, and restoring it is renaming it back. tsuzuri reads nothing under a dot folder, and the name no longer ends in `.md`.

| Option | Meaning |
| --- | --- |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |

With `--json`: `path`, `trashed`, the content's `hash`, and `written`. Without it, the two paths.

```sh
tsuzuri delete "Existing idea" --dry-run
```

### move

`tsuzuri move <note> <path>`

Move or rename a note to a .md path, rewriting every link the move would break. Missing folders are created, and an existing file at the path is refused. A link is rewritten when it resolved to a note before the move and would not resolve to that note after it: links to the moved note, the moved note's own relative links, and links to another note whose name the move makes ambiguous. Each keeps its heading, block, and display text, and takes the shortest form that resolves: the name, else the path; a relative Markdown link stays relative. Links in code and raw HTML are untouched.

| Option | Meaning |
| --- | --- |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |

With `--json`: `from`, `to`, the moved note's `diff` and `hash`, `written`, and `rewritten`, a write result for each other note whose links changed. Without `--json`, a dry run prints every diff; a move prints the paths and each rewritten note.

```sh
tsuzuri move "Existing idea" "Notes/Existing idea.md" --dry-run
```

### put

`tsuzuri put <note> [text...]`

Replace a whole note (text, --file, or stdin); --if-hash refuses one changed since get. The note must exist; `write` creates one.

| Option | Meaning |
| --- | --- |
| `--file <path>` | read the note from a Markdown file |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |

With `--json`: a write result, as `append`.

```sh
tsuzuri put "Existing idea" "A whole new body." --dry-run
```
