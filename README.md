# tsuzuri

![tsuzuri](https://raw.githubusercontent.com/azusachino/tsuzuri/main/docs/assets/tsuzuri.svg)

[![npm](https://img.shields.io/npm/v/tsuzuri)](https://www.npmjs.com/package/tsuzuri)
[![CI](https://github.com/azusachino/tsuzuri/actions/workflows/ci.yml/badge.svg)](https://github.com/azusachino/tsuzuri/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/tsuzuri)](package.json)
[![License: MIT](https://img.shields.io/npm/l/tsuzuri)](LICENSE)

tsuzuri is a CLI and TypeScript SDK for reading and writing Markdown folders. It understands Obsidian links, tags, aliases, and frontmatter, while also reading plain notes and documentation sites. It works on the files directly; no Obsidian app, server, or persistent index is needed.

## Quick start

From a folder of Markdown files:

```sh
cd ~/notes
npx tsuzuri nav
npx tsuzuri search "working memory" --limit 5
npx tsuzuri get "Working memory" --json
bunx tsuzuri list --limit 5 --json   # the same CLI on Bun
```

Use `--vault <dir>` or `$TSUZURI_VAULT` to select another folder. Otherwise the CLI finds the nearest parent with `tsuzuri.toml`, then falls back to the current directory. `npx` needs Node 22 or later; `bunx` needs Bun 1.4 or later. Install with `npm install -g tsuzuri` for a `tsuzuri` command, or `npm install tsuzuri` in a project that imports the SDK.

## Why tsuzuri

- **Your files stay in charge.** Reads use Markdown files and writes change those files. There is no database to build, migrate, or reconcile. A long-running `Vault` keeps a scan in memory and can refresh it when files change.
- **One reader for notes and docs.** Obsidian links and tags work alongside notes whose title is their first H1 and folders whose landing page is `README.md` or `index.md`.
- **Useful from a shell or an agent.** Commands return JSON, name errors, and show diffs with `--dry-run`. The SDK exposes the same operations; a host can limit them with a permission mask.

See the [use cases](docs/use-cases.md) for complete reading, writing, and agent workflows.

## Commands

| Task | Commands |
| --- | --- |
| Explore | `nav [folder]`, `types`, `config`, `tags`, `outline <note>` |
| Find and read | `search <words>`, `find <name>`, `grep <pattern>`, `list`, `get <note>` |
| Follow links | `links <note>`, `backlinks <note>`, `unresolved`, `orphans` |
| Create | `init`, `capture [text]`, `new <type> <title>`, `write <path> [text]` |
| Edit | `append <note> [text]`, `section put <note> [text]`, `prop set <note> <key> <value>`, `put <note> [text]` |
| Move or remove | `move <note> <path>`, `delete <note>` |
| Validate | `check <note>` |

`search`, `find`, `grep`, and `list` accept `--offset <n>` to continue in the same result order; `search`, `find`, and `list` also accept `--limit <n>`. Use `--json` for programs. Note-returning commands support `--format paths` for a pipeline, and most take `--fields a,b` to select note fields. `get --lines 20:60` reads part of a note; `get --around path:line` accepts a `grep` hit.

Creating a note never overwrites an existing file. Edits support `--dry-run` for a diff and `--if-hash <hash>` to refuse a note changed since `get`. `move` rewrites affected links; `delete` moves a note into `.trash`. Run `npx tsuzuri help <command>` for examples, or use the full [CLI reference](docs/cli.md).

## Configuration

A plain Markdown folder works without configuration. To start a configured vault, preview the two starter files, then create them:

```sh
npx tsuzuri init --dry-run
npx tsuzuri init
npx tsuzuri config --json
```

`init` writes `tsuzuri.toml` and `templates/capture.md`, refusing to overwrite either one. `config` shows each effective setting and its source. Options passed to `Vault` win over `tsuzuri.toml`, then neutral defaults apply. See the [configuration reference](docs/configuration.md) for every setting, route, and rule. A vault can also list [extensions](docs/extensions.md), including the bundled, opt-in journal.

## Note types and templates

A template file defines a type. For example, `templates/book.md` can contain:

```md
---
type: book
title: "{{title}}"
author:
tags:
  - reading
---

# {{title}}
```

Then `npx tsuzuri new book "The Left Hand of Darkness" --dry-run` previews a note. `npx tsuzuri types --json` lists available types and routes. `[types.book]` in `tsuzuri.toml` can choose its folder and filename pattern; `[tags]` and `[titles]` hold vault-wide rules. `npx tsuzuri check <note> --json` reports missing template keys and rule failures, exiting 1 when it finds any. `capture` uses `templates/capture.md` when present. Templates accept `{{title}}`, `{{slug}}`, `{{date}}`, `{{time}}`, and date or time formats; they have no scripting language.

## Agent tools and skill

`tsuzuri/tools` provides tool definitions with JSON Schemas and read-only or destructive hints. `agentTools(vault)` offers the operations allowed by that vault's mask; `validateInput(tool, input)` checks a model's arguments before `tool.run(vault, input)`. `npx -p tsuzuri tsuzuri-tools --json` lists the definitions from a shell. The [agent skill](skills/tsuzuri/SKILL.md) explains how to choose commands and guard writes; install it with `npx skills add azusachino/tsuzuri`.

## SDK

```ts
import { Vault } from "tsuzuri";

const vault = await Vault.open("./notes", { watch: 1000, allow: ["read", "capture"] });
const hits = await vault.search("distributed consensus", { limit: 5 });
if (hits[0]) {
  const note = await vault.get(hits[0].path);
  console.log(note.body);
}
await vault.capture({ text: "An idea", tags: ["learning"] }, { dryRun: true });
```

`Vault.open` loads the extensions listed by the vault. `watch` checks for changes at most once per interval; call `vault.reload()` after external edits when you do not use it. The [public API and permission rules](docs/decisions/0009-the-core-contract-and-prelude.md), [agent tools](docs/decisions/0018-operations-and-a-permission-mask.md), and [extension guide](docs/extensions.md) describe the larger contract.

## Development

The project uses `mise` for pinned tools and Make for tasks:

```sh
mise install node rumdl typos
make install    # npm dependencies and the kepano-obsidian test vault
make check      # lint, types, documentation, and tests
make validate   # check plus the built CLI smoke test
make node-smoke # Node and Bun parity, when Bun is installed
make pack       # inspect the npm tarball in dist/pack
```

Tests use a small synthetic vault and the pinned [kepano-obsidian](https://github.com/kepano/kepano-obsidian) corpus; `make corpus` adds Obsidian's larger help vault. See [CONTRIBUTING.md](CONTRIBUTING.md), the [roadmap](docs/roadmap.md), [changelog](CHANGELOG.md), and [security policy](SECURITY.md). Licensed under [MIT](LICENSE).
