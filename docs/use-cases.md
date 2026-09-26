# use cases

What people and agents do with tsuzuri, the commands each case walks through, and the tests that hold it in place. A case is **shipped** when every step works today, **partial** when it works with a gap a planned issue closes, and **planned** when it waits on an issue. Update this page with the [roadmap](roadmap.md) when a change ships, and name a covering test for every shipped step. Tests are cited as `file › test name` under `tests/`.

## from the terminal

### T1. Find a note I half remember

`search <words>`, then `get <path>`. Shipped.

- `vault.test › ranks a title match first`
- `vault.test › matches Latin words on word boundaries and honours filters`
- `vault.test › matches CJK text as a substring`

### T2. Open a note by its name, title, or alias

`get <ref>`. An ambiguous reference fails and names every candidate instead of picking one. A miss names the closest notes by fuzzy match, even through a typo. Shipped.

- `vault.test › resolves a path, stem, title, or alias`
- `fuzzy.test › suggests the closest notes, even through a typo`
- `vault.test › refuses an ambiguous stem and names the candidates`

### T3. Browse a folder before searching

`nav`, then `nav <folder>`, reading the folder's `index.md` or `README.md` headings. Shipped.

- `vault.test › shows the root folders and notes`
- `vault.test › shows a folder's index note and headings`
- `vault.test › uses README.md as the folder index, with index.md taking precedence`

### T4. Check the vault's links

`unresolved` for links pointing at nothing or at several notes, `backlinks <note>` before renaming or archiving. `orphans` lists notes nothing links to or embeds. As in Obsidian, wikilinks in frontmatter values, such as `categories: "[[Books]]"`, and Markdown links to vault files count as links, and `[[Node.js]]` finds the note `Node.js.md`. The links are resolved once per scan. Shipped.

- `vault.test › resolves each wikilink form the way Obsidian does`
- `vault.test › counts frontmatter wikilinks and local Markdown links, as Obsidian does`
- `corpus.test › counts category links written in frontmatter`
- `vault.test › resolves a note whose name has a dot before calling it an attachment`
- `vault.test › skips links in a fence that holds a shorter fence, as headings do`
- `vault.test › sees a new link after a write, since the link graph goes with the scan`
- `vault.test › finds backlinks and unresolved links`
- `corpus.test › resolves links consistently`
- `reads.test › counts embeds as links and self-links as nothing, narrowed by the filters`

### T5. Open today's or this week's journal

`journal day|week|month|quarter|year [--date]` from the bundled journal extension, which a vault enables with `extensions = ["tsuzuri:journal"]` and its `[journal.<period>]` tables ([ADR 0020](decisions/0020-bundled-extensions-journal-first.md)). Shipped.

- `extensions.test › opens with a vault that lists it, and reads the note for a date in either week convention`
- `extensions.test › runs from the CLI, with its own options and help`

### T6. Capture a thought, or file a draft

`capture <text>`, `echo … | capture`, or `capture --file draft.md`, with `--dry-run` to look first. The note lands in the vault's capture folder in its house style. Shipped.

- `cli.test › dry-runs a capture from stdin`
- `cli.test › imports a Markdown file, merging --tag`
- `capture.test › write the declared properties in order`
- `capture.test › creates a new file, never overwriting one`

### T7. Recently touched notes, latest in a category

`list --where type=book --sort modified --desc --limit 10`; `--offset 10` requests the next page in the same order. `--format paths` pipes the result to `xargs` or `fzf`. `--where` takes any frontmatter property, and notes without the sort value come last. Shipped.

- `vault.test › filters by property, tag, and folder`
- `cli.test › --format paths prints one path per line`
- `list.test › give the ten most recently modified books in one call`
- `list.test › matches any frontmatter property as text, and list properties by any item`
- `vault.test › offset slices each command's existing order`

### T8. Rename a note without breaking its links

`move <note> <path> --dry-run` shows every note whose links would change; the write moves the note and keeps its wikilinks, Markdown links, and parsed frontmatter links pointing at it. Code and YAML comments stay untouched. A target occupied by another file is refused, including when the names differ only by case on a case-sensitive disk. A link that cannot be rewritten safely makes the move fail before changing files. Shipped.

- `move.test › renames a note, rewriting every link to it and keeping headings and display text`
- `move.test › rewrites parsed frontmatter links while leaving comments and other YAML intact`
- `move.test › refuses a move when YAML escapes hide a link's delimiters`
- `move.test › a case-only move cannot overwrite a different note`
- `move.test › keeps a real frontmatter link and the surrounding note intact`

### T9. Delete a note into recoverable trash

`delete <note> --dry-run` shows where the note would go. A write keeps its bytes in `.trash/<path>.<timestamp>` and removes it from reads; a stale `--if-hash` refuses it. A folder-scoped delete checks the source note and uses that fixed trash destination ([ADR 0021](decisions/0021-scope-derived-paths-and-extension-operations.md)). Shipped.

- `delete.test › moves a note into .trash under its path with a timestamp, keeping every byte`
- `delete.test › hides the note from reads, and leaves links to it unresolved`
- `delete.test › a dry run and a stale hash change nothing`
- `delete.test › under a mask, needs delete for the note's folder`

### T10. Create a note at a chosen path, or replace one after reading it

`write <path>` creates a Markdown note and refuses an occupied path; `put <note>` replaces an existing note found by reference. Either can show a dry-run diff, and `put --if-hash` refuses a note changed since `get`. Shipped.

- `props-put.test › creates a note at any .md path in the vault, and refuses an existing file`
- `props-put.test › reports a dry run without writing`
- `props-put.test › replaces a whole note by any reference, with no hash needed`
- `props-put.test › refuses a stale hash, and a note that does not exist`

### T11. Read a documentation site or plain Markdown folder

Run `nav` or `search` in a folder without Obsidian or a `tsuzuri.toml`. A first H1 names a page whose file is `01.md`; `README.md` acts as the folder index. From a subfolder, the CLI uses the nearest ancestor with `tsuzuri.toml`, or cwd when none exists. Shipped.

- `vault.test › uses a first H1 after frontmatter, with property then filename precedence`
- `vault.test › uses README.md as the folder index, with index.md taking precedence`
- `root-discovery.test › walks to the nearest ancestor with tsuzuri.toml`
- `root-discovery.test › uses cwd when no ancestor has a config`
- `corpus.test › keeps Obsidian titles from frontmatter or filenames`

### T12. Set up a vault without guessing the config format

Run `init --dry-run` to see a starter `tsuzuri.toml` and `templates/capture.md`, then `init` to write them. It refuses either occupied target, and `config --json` shows the effective values and sources. Shipped.

- `self-description.test › init previews both starter files, writes once, and refuses either existing target`
- `self-description.test › init refuses a pre-existing template before writing the config`
- `self-description.test › types and config describe effective routes and provenance`

## from an agent

An agent reaches tsuzuri in one of two ways: a coding agent shells out to the CLI with `--json`, and a bot imports the SDK in-process. Both see the same operations, and every case below is written for a model that has never seen the vault.

### A1. Orient in an unfamiliar vault

`nav` at the root, then into the folders whose index notes look relevant, before any search. This keeps a model from guessing a layout. Shipped.

- `vault.test › shows a folder's index note and headings`
- `vault.test › skips dot folders and submodule paths`

### A2. Answer a question from the vault, citing notes

`search <question> --limit 5 --json`, then `get <path> --max-chars <n>` on the best hits, answering with their paths. `--offset 5` gets the next page in the same rank order. A hit carries the same summary as `list` (type, status, tags, dates), and `--fields` adds any frontmatter key, so the agent can choose between hits without another call. In a long note, `get <path> --lines a:b` reads only the part it needs. Shipped.

- `vault.test › ranks a title match first`
- `vault.test › returns a content hash and marks truncation`
- `vault.test › returns the same summary as list, plus score and snippet`
- `vault.test › selects summary fields and frontmatter keys, null when absent`
- `cli.test › emits JSON with --json`
- `vault.test › counts lines from the top of the file, frontmatter included`
- `vault.test › offset slices each command's existing order`

### A3. Locate an exact phrase, then read around it

`grep <pattern>` for `path:line:text`, then `get --around <path:line> --context 10`, which takes a grep or `rg -n` result unchanged. Shipped.

- `grep.test › numbers lines from the top of the file, frontmatter included`
- `grep.test › uses smart case, ignoring escapes`
- `cli.test › takes an rg -n result for --around unchanged`
- `vault.test › reads around a line, clipped at either end of the file`
- `vault.test › refuses a range the note cannot serve, naming its length`

### A4. Resolve a loose reference from a user's message

The user writes "that note about oolong". `get` resolves a path, file name, title, or alias; on a miss, `find` ranks near matches by fuzzy score. Shipped. How Obsidian treats a bare alias link is open in [#24](https://github.com/azusachino/tsuzuri/issues/24).

- `vault.test › resolves a path, stem, title, or alias`
- `fuzzy.test › ranks Latin titles, aliases, and paths`
- `fuzzy.test › ranks CJK titles`
- `fuzzy.test › prints the suggestions from the CLI and exits 1`

### A5. Capture a chat message into the vault

A bot receives a message, previews it with `capture(…, { dryRun: true })`, and on confirmation writes it: one new file in the capture folder, never touching an existing note. Committing it is the owner's, as [ADR 0008](decisions/0008-files-only-no-git-no-server.md) decides. Shipped.

- `capture.test › dry run writes nothing`
- `capture.test › creates a new file, never overwriting one`

### A6. Tag a capture with the vault's own tags

The agent lists existing tags with their counts and picks from them instead of inventing a near-duplicate. `tags --json` gives each tag with its note count, parents of nested tags included, and capture enforces the vault's required, rejected, and kebab-case rules. Shipped.

- `capture.test › enforce required, kebab-case, and rejected tags`
- `capture.test › keep titles and tags as written, checking Obsidian's tag syntax`
- `tags.test › counts notes per tag, parents of nested tags included, case variants merged`
- `tags.test › prints counts from the CLI, and --tag may repeat`

### A7. Summarize the week, then record the summary

`journal week` to read, then `journal append week <text> --heading <h>` to add to the note, from the bundled journal extension; the agent tools are `tsuzuri_journal` and `tsuzuri_journal_append`, offered as the host's mask allows. Shipped.

- `extensions.test › appends to a note that exists, with a dry run, and refuses one not written yet`
- `extensions.test › becomes agent tools the mask filters`

### A8. Edit a note without overwriting the owner's change

`get` returns the note's `hash`; a write passes it back with `--if-hash` and is refused when the file changed in between, with `--dry-run` showing the diff first. `append` and `section put` take both. A write replaces the file whole through a rename, so nobody reads half a note. Shipped.

- `vault.test › returns a content hash and marks truncation`
- `write.test › refuses a stale hash and accepts the one get returned`
- `write.test › replaces a note whole, keeping its mode and any symbolic link, with no temporary file left`
- `sections.test › a dry run returns the diff and writes nothing; a stale hash is refused`

### A9. Stop instead of guessing

When the vault does not say where something lives, tsuzuri raises `UnsupportedError` rather than inventing a path, and the CLI exits 1 for a missing or unsupported request and 2 for bad usage, so an agent can tell its own mistake from the vault's. A misspelled `tsuzuri.toml` key or value raises `ConfigError` instead of being ignored, and every such error is a `TsuzuriError`. Shipped.

- `templates.test › names the templates that exist when the type has none, and needs a template folder`
- `capture.test › rejects a misspelled key, naming the keys the table takes`
- `cli.test › reports a malformed or retired tsuzuri.toml in one line`
- `errors.test › every error tsuzuri raises is a TsuzuriError named after its class`
- `cli.test › exits 1 for a missing note and 2 for bad usage`
- `chain.test › names the capability and what each provider needs when none is available`

### A10. Serve a long-running process

A bot keeps one `Vault` for its lifetime and passes `watch`, so a read rescans, at most once per interval, when the notes' paths, modification times, or sizes change, and never otherwise. Reads that arrive during a scan share it. The scan also keeps lowercase text and word counts for repeat searches, rebuilding them when it changes. A process without `watch` calls `reload()` after the files change. It runs on Bun or Node. Shipped.

- `make node-smoke`, which runs the read commands on Node and requires Bun's output
- `refresh.test › a live vault sees a changed and a new file on its next read`
- `refresh.test › reads that arrive during a scan share it`
- `vault.test › rebuilds search statistics with the scan after a reload`
- [Search benchmark](benchmarks/search-0.8.md) on a 10,248-note synthetic tree

### A11. Hand an agent framework tsuzuri's tools

Import ready-made tool definitions with parameter schemas and read-only or destructive hints, instead of writing wrappers. The `tsuzuri/tools` entry's `agentTools()` returns each tool with its JSON Schema, MCP-style hints, the operation it runs, and a `run` bound to the SDK, filtered by the vault's mask, and `tsuzuri-tools --json` prints them for an agent with only a shell. Shipped; which tools to offer is the host's mask ([ADR 0016](decisions/0016-the-sdk-reads-and-writes-the-whole-vault.md), [ADR 0018](decisions/0018-operations-and-a-permission-mask.md)), and the tools ship in the one package since [ADR 0012](decisions/0012-one-npm-package-named-tsuzuri.md).

- `tools.test › have valid JSON Schemas: closed objects whose required inputs are declared and described`
- `tools.test › writes take the model's guards and change only the files`
- `tools.test › grep reads a model's pattern as literal text unless regex is set, and caps its length`
- `tools.test › refuses a malformed line range instead of reading the whole note`

### A12. Serve a bot beside its owner, in one checkout

The owner edits one checkout every day, and a bot on the same machine answers from it and captures into it. The bot opens the owner's checkout with `watch`, so its next read sees an edit the owner has not committed, and registers the read tools and `tsuzuri_capture`. A capture adds one new file and leaves the owner's staged and unstaged work as it was; the owner commits it with the rest. The checkout may be a submodule of the owner's workstation. Shipped.

- `submodule.test › captures one new file and leaves the owner's staged and unstaged work alone`
- `submodule.test › a watching reader sees the owner's uncommitted edit on its next read`
- `submodule.test › a vault at the superproject's root skips the checked-out submodule`
- `tools.test › are offered as the vault's mask allows, and all of them without a vault`

### A13. Import tsuzuri in a Node project

A consumer installs tsuzuri and imports it on Node, which strips no types under `node_modules`; `exports` serves Node the built JavaScript and declarations, and Bun the TypeScript source. Shipped.

- `make node-smoke`, which imports the built package from a `node_modules` folder on Node and requires Bun's output

### A14. Limit an agent to named operations and folders

A host opens one vault with an `allow` mask. Reads outside its visible folders disappear; a write outside its allowed folder fails before changing a file. An extension operation is allowed by name or kind, while its inner `Vault` calls carry the folder scopes. A scoped rule on the extension operation itself is refused instead of appearing to protect files it cannot check. Shipped.

- `mask.test › limits a rule to folders, refusing every path outside them`
- `mask.test › hides the notes outside a read rule's folders from every read`
- `extensions.test › the mask covers its operations, and every call they make`
- `extensions.test › refuses a folder scope on an extension operation it cannot enforce`

### A15. Work through a large vault over several questions

Keep one `Vault` in the agent process, search with `limit` and `offset`, and fetch only the selected notes. Repeat searches reuse the scan's lowercase text and word counts, with no index written to disk. Reload after external edits, or use `watch`. Shipped.

- `vault.test › keeps paths, BM25 scores, and snippets from the uncached calculation`
- `vault.test › rebuilds search statistics with the scan after a reload`
- `vault.test › offset slices each command's existing order`
- `tools.test › read tools page in the same order as SDK calls`
- [Search benchmark](benchmarks/search-0.8.md) on a 10,248-note synthetic tree

### A16. Validate an agent-created note against vault conventions

After creating a note, run `check <note> --json` or the read-only `tsuzuri_check` tool. It reports missing keys from that note type's template and failed `[tags]` or `[titles]` rules; `ok: false` and CLI exit 1 keep a failed note visible for correction. `types` or `tsuzuri_types` lists the available templates and routes first. Shipped.

- `self-description.test › check reports template keys and title/tag failures, with CLI exit 1`
- `self-description.test › check accepts a note created from its template`
- `self-description.test › types and config describe effective routes and provenance`
