# tsuzuri

![tsuzuri](https://raw.githubusercontent.com/azusachino/tsuzuri/main/docs/assets/tsuzuri.svg)

[![npm](https://img.shields.io/npm/v/tsuzuri)](https://www.npmjs.com/package/tsuzuri)
[![CI](https://github.com/azusachino/tsuzuri/actions/workflows/ci.yml/badge.svg)](https://github.com/azusachino/tsuzuri/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/tsuzuri)](package.json)
[![License: MIT](https://img.shields.io/npm/l/tsuzuri)](LICENSE)

An SDK and CLI for reading and writing an Obsidian-compatible Markdown vault. It works on the files directly: Obsidian does not need to be installed or running. It is built for a personal vault that is used from the terminal and by a Telegram bot, which imports the SDK in-process.

The command vocabulary follows [Obsidian's own CLI](https://obsidian.md/help/cli), but the model follows [notesmd-cli](https://github.com/Yakitrak/notesmd-cli): files are the only source of truth, and there is no index to build or keep fresh. A full scan of a 1,837-note vault answers a search in about 200 ms, including process start-up.

## Features

- **Files only:** no app, no index, no server, and no Git; tsuzuri reads and writes the Markdown files and nothing else.
- **Obsidian's rules:** wikilinks resolve as Obsidian resolves them, including links in frontmatter; tags nest and match case-insensitively; aliases and titles find notes.
- **Find:** BM25 search with CJK support, `rg`-style `grep`, fzf-style fuzzy `find`, and `list` filtered on any frontmatter property.
- **Navigate:** a folder's index and notes, a note's outline, its links and backlinks, and the vault's orphans and unresolved links.
- **The whole vault:** create, edit a heading or property, replace, move a note with its links rewritten, and delete into `.trash`; every write shows a diff with `--dry-run` and can refuse a note changed since it was read.
- **Yours to extend and limit:** a vault adds its own operations as [extensions](docs/extensions.md), the journal bundled, and a host limits every operation with a permission mask.
- **Built for agents:** JSON output and errors, ready-made tool definitions with MCP-style hints, and a skill for coding agents.
- **Node and Bun:** one npm package, runnable with `npx` or `bunx`.

## Install

```sh
npm install -g tsuzuri    # the tsuzuri and tsuzuri-tools commands
npm install tsuzuri       # the SDK, in a project; or bun add tsuzuri
npx tsuzuri --help        # or bunx tsuzuri, without installing
```

One package holds the SDK, the agent tools at `tsuzuri/tools`, and both commands. It needs Node 22 or later, or Bun 1.4 or later.

## Quick start

```sh
npx tsuzuri --version                 # or bunx tsuzuri; or npm install -g tsuzuri for a `tsuzuri` command
export TSUZURI_VAULT=~/notes          # or pass --vault <dir>; the default is the current directory

tsuzuri nav                           # the vault's top folders and notes
tsuzuri search cognitive load --limit 5
tsuzuri get "Cognitive load" --json   # one note, with the hash a later write needs
tsuzuri capture --tag reading "Read: how agents plan"
```

`tsuzuri help` lists every command, `tsuzuri help <command>` gives one command's options and an example, and the [CLI reference](docs/cli.md) has every option and JSON output shape.

## Commands

### Read

| Command | What it returns |
| --- | --- |
| `get <note>` | one note by path, file name, title, or alias; `--lines 20:60` or `--around <path:line>` for part of it |
| `search <query...>` | notes ranked by BM25 with title and tag boosts; CJK matches as substrings |
| `grep <pattern>` | matching lines as `path:line:text`, like `rg -n`, with smart case, `-F`, and `-C <n>` |
| `find <query...>` | notes by fuzzy match over paths, titles, and aliases, ranked as fzf ranks |
| `list` | notes filtered by `--type`, `--tag`, `--status`, `--under`, or `--where key=value`, and sorted |
| `tags` | every tag with its note count |
| `prop get <note> <key>` | one frontmatter value |

### Navigate and link

| Command | What it returns |
| --- | --- |
| `nav [folder]` | a folder's index note and headings, its subfolders, and its notes |
| `outline <note>` | a note's headings with their line numbers |
| `links <note>` | a note's outgoing links and how each resolves |
| `backlinks <note>` | notes that link to a note |
| `orphans` | notes nothing links to or embeds |
| `unresolved` | links pointing at no note, or at several |

### Write

| Command | What it changes |
| --- | --- |
| `capture [text...]` | creates a new note in the capture folder, from text, `--file`, or stdin |
| `new <type> <title...>` | creates a note from the vault's template for a type, placed as `capture` places it |
| `append <note> [text...]` | adds text at the end of a note, or of section `--heading` |
| `section put <note> [text...]` | replaces the body of section `--heading`, or adds the section |
| `prop set <note> <key> <value>` | sets one frontmatter key, keeping comments and key order |
| `write <path> [text...]` | creates a note at any `.md` path; an existing file is refused |
| `put <note> [text...]` | replaces a whole note; `--if-hash` refuses one changed since `get` |
| `move <note> <path>` | moves or renames a note, rewriting every link the move would break |
| `delete <note>` | moves a note into `.trash` under its path with a timestamp added, where it can be restored |

`capture`, `new`, and `write` only create files, so they never touch a note the owner is editing. Every edit changes only its target and takes two guards: `--dry-run` shows a unified diff, and `--if-hash <hash>` refuses a note changed since `get` returned that hash. tsuzuri only writes files; committing and syncing them is the owner's, through Git or whatever else keeps the vault ([ADR 0008](docs/decisions/0008-files-only-no-git-no-server.md)). A text argument that starts with a dash and a space is a Markdown bullet, not an option.

The `tsuzuri/tools` entry offers the same operations as agent tools, and `tsuzuri-tools --json` prints their definitions.

## Output and errors

- `--json` makes stdout one JSON value. Commands that return notes share one summary: `path`, `title`, `type`, `status`, `tags`, `created`, and `modified`.
- `--fields a,b` keeps only the named fields, a summary field or any frontmatter key, and `--format paths` prints one path per line for `xargs` or `fzf`.
- With `--json`, a failure prints one line on stderr, `{"error": {"name", "message", ...}}`, such as `NotFoundError` with the closest notes in `suggestions`.
- The exit code is 1 for a request tsuzuri refused or could not serve, and 2 for bad usage. A command refuses an option it does not take.

## Links

Wikilinks resolve the way Obsidian resolves them: a vault-root path, a path relative to the linking note's folder, a unique path suffix, then a unique file name, preferring the linking note's own folder. A link that still matches several notes is reported as ambiguous rather than guessed. As in Obsidian, wikilinks in frontmatter values and Markdown links to vault files such as `[text](My%20Note.md)` count as links too. A note without a `title` property takes its title from its file name.

Tags match the way Obsidian matches them: case-insensitively, with `area` matching `area/sub`. `--tag` may repeat, and every tag must match.

## Settings

tsuzuri assumes no folder layout or house style. Each setting is resolved in this order, and the first source that has it wins:

1. options passed in code (`new Vault(root, { config })`), in the shape of `tsuzuri.toml`
2. `tsuzuri.toml` at the vault root
3. a neutral default, or an `UnsupportedError` naming what to set

| Setting | `tsuzuri.toml` | Default |
| --- | --- | --- |
| capture folder | `[capture] folder` | the vault root |
| template folder | `[templates] folder` | `UnsupportedError` for `new` |

tsuzuri reads nothing in `.obsidian/`: an Obsidian-compatible vault needs no Obsidian configuration, and a vault edited in Obsidian writes its conventions in `tsuzuri.toml` once ([ADR 0011](docs/decisions/0011-settings-from-neiro-toml-only.md)).

An unknown key, or a value of the wrong type or choice, in `tsuzuri.toml` or code options raises `ConfigError` naming it. A vault's own conventions, such as daily and weekly notes, come from [extensions](docs/extensions.md) it lists: `extensions = ["tsuzuri:journal"]` enables the bundled journal and its `[journal.<period>]` tables.

A `tsuzuri.toml` declaring a stricter house style:

```toml
[capture]
folder = "inbox"
filename = "slug"                  # ASCII kebab-case; the default "title" names files as Obsidian does
properties = ["title", "created", "modified", "status", "tags", "source"]
timestamp_format = "YYYY-MM-DD HH:mm"  # the default "YYYY-MM-DD" is the format of Obsidian's Date property
title_style = "lowercase"          # lowercase title words, except those in the allowlist
title_allowlist = "casing.toml"    # every string in this file's arrays is kept as written
tag_style = "kebab"                # canonical lowercase kebab-case; the default keeps tags as written
require_tags = true
reject_tags = ["todo"]

[capture.values]
status = "inbox"

[templates]
folder = "templates"               # without it, `new` raises UnsupportedError
```

Paths listed in the vault's `.gitmodules`, dot folders such as `.obsidian` and `.trash`, `node_modules`, and anything the vault root's `.gitignore` ignores are never scanned, as ripgrep skips them.

## Capture

```sh
tsuzuri capture --tag llm --source https://example.com/post "Read: how agents plan"
printf -- '- white miso\n- red miso\n' | tsuzuri capture --tag cooking --title "Miso to try"
tsuzuri capture -- "- text starting with a dash goes after --"
tsuzuri capture --file tmp/draft.md --tag reading     # a whole Markdown file, frontmatter included
```

- The title is the first line of the text unless `--title` is given, with Markdown markers removed. With `--file`, the file's `title` property comes first, then its first heading, then its file name, and its `tags`, `source`, and other properties carry over; `--tag` adds to its tags.
- By default the frontmatter holds only the tags and source, when given, and a note without either has no frontmatter. `properties` and `[capture.values]` in `tsuzuri.toml` declare more, and capture always fills the properties the vault declares.
- By default the file is named after the title, without the characters Obsidian refuses in file names, and a taken name gets a number, as in `Idea 2.md`. The `slug` style uses an ASCII kebab-case stem with a `-2` suffix, falling back to `capture-YYYYMMDD-HHmm` for a title with no ASCII letters.
- Tags use Obsidian's tag syntax: letters, numbers, `_`, `-`, and `/` for nesting, with at least one non-digit.
- `--dry-run` prints the note without writing.

## SDK

```ts
import { Vault } from "tsuzuri";

const vault = new Vault(process.env.TSUZURI_VAULT ?? ".");
const hits = await vault.search("distributed consensus", { limit: 5 });
const note = await vault.get(hits[0].path, { maxChars: 8000 });
const day = await vault.get("Daily/2026-09-26.md"); // a daily note, by the path your vault uses
await vault.capture({ text: "An idea", tags: ["learning"] });
```

- Bun imports the TypeScript source; Node and bundlers import the JavaScript and declarations that `make build` writes to `dist/lib`, which packing the package builds too. The installed `tsuzuri` command runs on Node as well as Bun.
- Every error tsuzuri raises on purpose extends `TsuzuriError`, so one `instanceof` check separates them from bugs.
- A `Vault` scans once and caches the notes. Call `vault.reload()` after the files change underneath it, or, in a long-running process, pass `watch: 1000` to have reads rescan, at most once a second, when the notes' paths, modification times, or sizes change.

### Permission mask

Every operation is named in `OPERATIONS` with its kind: `read`, `create`, `edit`, `move`, or `delete`. A host limits a `Vault` with `allow`, a list of rules naming kinds or operations, each optionally limited to folders ([ADR 0018](docs/decisions/0018-operations-and-a-permission-mask.md)). Without `allow`, everything is allowed; tsuzuri ships no policy of its own.

```ts
// A bot sharing its owner's vault: every read, and new notes through capture only.
const bot = new Vault(root, { allow: ["read", "capture"] });
// An agent that reads everything but creates and edits only in the inbox.
const agent = new Vault(root, { allow: ["read", { ops: ["create", "edit"], under: ["Inbox"] }] });
```

- A disallowed operation raises `PermissionError` before touching any file. Paths are checked after normalization and without case, so `Inbox/../Notes` or `INBOX/..` cannot leave a folder. A scoped delete checks the source note; its fixed `.trash/<path>.<timestamp>` destination is part of that deletion ([ADR 0021](docs/decisions/0021-scope-derived-paths-and-extension-operations.md)).
- A read rule limited to folders hides the notes outside them from every read: lists, search, grep, `find`, `nav`, and links. A link to a hidden note is left out, and an ambiguous link names only the candidates shown. A path outside the folders raises `PermissionError`; a name that only a hidden note has is not found.
- Reading a template is part of `create`, so read rules do not apply to it.

### Extensions

A vault lists [extensions](docs/extensions.md) in `tsuzuri.toml`, and `Vault.open` loads them: a bundled `tsuzuri:<name>` always, and a module the vault holds only with `trust`. Their operations run through `vault.run(name, input)`, appear in `vault.operations()`, and become agent tools and CLI commands; the mask covers them and every call they make.

An extension operation cannot itself take a folder-scoped `allow` rule. Scope the core `Vault` methods it calls instead; a scoped extension rule raises `ConfigError` ([ADR 0021](docs/decisions/0021-scope-derived-paths-and-extension-operations.md)).

```ts
const vault = await Vault.open(root, { allow: ["read", "capture"] }); // tsuzuri.toml: extensions = ["tsuzuri:journal"]
const today = await vault.run("journal", { period: "day" });
console.log(vault.skipped); // the listed extensions not loaded, and why
```

### Agent tools

The `tsuzuri/tools` entry turns the SDK's operations into tool definitions for a tool-calling model. It imports only the prelude, so it can do nothing a consumer cannot ([ADR 0012](docs/decisions/0012-one-npm-package-named-tsuzuri.md)).

```ts
import { Vault } from "tsuzuri";
import { agentTools, validateInput } from "tsuzuri/tools";

const vault = new Vault(process.env.TSUZURI_VAULT ?? ".");
const tools = agentTools(); // register each tool's name, description, and inputSchema with the model
const tool = tools.find((candidate) => candidate.name === "tsuzuri_search");
const result = await tool?.run(vault, validateInput(tool, { query: "cognitive load" }));
```

`agentTools(vault)` returns each tool with a `tsuzuri_` name, the `operation` it runs, a JSON Schema for the input, MCP-style `readOnlyHint`, `destructiveHint`, and `idempotentHint`, and a `run` bound to the SDK. Validate a model's input with `validateInput`, then call `run(vault, input)`.

tsuzuri offers the tools the vault's [permission mask](#permission-mask) allows, and every tool without a vault; which of them to confirm with a human is the host's choice, which the hints inform ([ADR 0016](docs/decisions/0016-the-sdk-reads-and-writes-the-whole-vault.md)). A bot sharing its owner's vault opens it with `allow: ["read", "capture"]` and offers `agentTools(vault)`. `tsuzuri_grep` reads a model's pattern as literal text unless it sets `regex`, and caps it at 200 characters, since a regular expression runs in the host's process.

The `tsuzuri-tools` command lists each tool with its operation and whether it reads, adds, or changes notes, and `tsuzuri-tools --json` prints the definitions.

### Agent skill

[`SKILL.md`](skills/tsuzuri/SKILL.md) tells a coding agent which command to reach for, how to write without overwriting the owner (read the `hash`, `--dry-run`, then `--if-hash`), and what to do about each JSON error. It is self-contained, so an installer that copies only the skill's folder can use it, and a test fails when it names a command or option the CLI does not take.

Install it into Claude Code, Codex, Cursor, and other coding agents with the [skills](https://skills.sh) installer:

```sh
npx skills add azusachino/tsuzuri
```

## Development

Node, Bun, rumdl, and typos are pinned in `.mise.toml`. Install the Node toolchain with `mise install node rumdl typos`, then:

```sh
make install    # dependencies from package-lock.json, plus the kepano-obsidian test vault
make check      # Biome lint and format, tsc, rumdl, typos, and tests
make validate   # check, then build the CLI and run it against the fixture vault
make build      # compile the CLI and SDK into dist/lib
make node-smoke # compare Node and Bun; requires optional Bun
make pack       # pack the package into dist/pack, the tarball npm and a release carry
make publish    # publish that tarball to npm, after a release is tagged (see CONTRIBUTING.md)
make corpus     # fetch the opt-in obsidian-help vault (about 635 MB), which the tests then include
```

Tests run against a small synthetic vault and against real public Obsidian vaults pinned under `tests/vaults/`: [kepano-obsidian](https://github.com/kepano/kepano-obsidian) in CI, and Obsidian's own [help vault](https://github.com/obsidianmd/obsidian-help) on request. See [CONTRIBUTING.md](CONTRIBUTING.md), the [use cases](docs/use-cases.md), and the [roadmap](docs/roadmap.md).

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) first: the [decision records](docs/decisions/README.md) explain the rules a change has to keep, and the [roadmap](docs/roadmap.md) says what is planned. Please follow the [code of conduct](CODE_OF_CONDUCT.md).

## Security

Report a vulnerability privately, as [SECURITY.md](SECURITY.md) describes, not in a public issue.

## Changelog

Every release and its breaking changes are in [CHANGELOG.md](CHANGELOG.md) and on the [releases page](https://github.com/azusachino/tsuzuri/releases). tsuzuri was named neiro before 0.7.0.

## Acknowledgements

- [notesmd-cli](https://github.com/Yakitrak/notesmd-cli), whose files-only model tsuzuri follows.
- [Obsidian's CLI](https://obsidian.md/help/cli), whose command vocabulary it borrows.
- [kepano-obsidian](https://github.com/kepano/kepano-obsidian) and Obsidian's [help vault](https://github.com/obsidianmd/obsidian-help), the public vaults its tests run against.

## License

[MIT](LICENSE).
