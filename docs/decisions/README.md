# decisions

tsuzuri's architecture decision records. Each one says what was decided, what it replaced or ruled out, and what it costs, so a later change can tell a deliberate choice from an accident. [ADR 0001](0001-record-decisions-as-adrs.md) describes the format.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-record-decisions-as-adrs.md) | Record decisions as ADRs | accepted |
| [0002](0002-files-are-the-only-truth.md) | Files are the only truth | accepted |
| [0003](0003-obsidian-semantics-without-the-app.md) | Obsidian semantics without the Obsidian app | accepted; title rule amended by 0015 |
| [0004](0004-assume-no-layout-or-house-style.md) | Assume no layout or house style | accepted; Obsidian settings superseded by 0011, capture keys by 0014, journal paths by 0017 |
| [0005](0005-the-write-model.md) | Capture creates; edits target one part, guarded | superseded by 0016, except its guards |
| [0006](0006-portable-core-and-fallback-chains.md) | A portable core, with fallback chains for runtime speed-ups | accepted |
| [0007](0007-maintained-dependencies-or-own-code.md) | Maintained dependencies or tsuzuri's own code | accepted |
| [0008](0008-files-only-no-git-no-server.md) | Files only: no Git and no server | accepted |
| [0009](0009-the-core-contract-and-prelude.md) | The core contract and its prelude | accepted; layers extended by 0019 |
| [0010](0010-agent-tools-as-an-extension-package.md) | Agent tools as an extension package | accepted; separate package superseded by 0012, exposure by 0016 |
| [0011](0011-settings-from-neiro-toml-only.md) | Settings from `tsuzuri.toml` only | accepted; capture keys superseded by 0014, journal paths by 0017 |
| [0012](0012-one-npm-package-named-tsuzuri.md) | One npm package, named tsuzuri | accepted |
| [0013](0013-node-first-toolchain.md) | Node first, Bun as a fast path | accepted; tested versions extended by 0024 |
| [0014](0014-note-types-from-templates.md) | Note types from templates, and a smaller tsuzuri.toml | accepted |
| [0015](0015-any-markdown-folder.md) | Any Markdown folder, Obsidian first | accepted |
| [0016](0016-the-sdk-reads-and-writes-the-whole-vault.md) | The SDK reads and writes the whole vault; policy belongs to the host | accepted; permission layer amended by 0018, browsing reads by 0022 |
| [0017](0017-no-journal-in-the-sdk.md) | No journal in the SDK | accepted; journals move to an opt-in bundled extension by 0019 and 0020 |
| [0018](0018-operations-and-a-permission-mask.md) | Operations, and a permission mask the host sets | accepted; opened to extensions by 0019, scoped paths amended by 0021 |
| [0019](0019-a-small-core-and-vault-extensions.md) | A small core, and extensions a vault defines | accepted; bundled extensions added by 0020, scopes amended by 0021 |
| [0020](0020-bundled-extensions-journal-first.md) | Bundled extensions, the journal first | accepted |
| [0021](0021-scope-derived-paths-and-extension-operations.md) | Scope derived paths and extension operations honestly | accepted |
| [0022](0022-reads-skip-the-declared-templates-folder.md) | Reads skip the declared templates folder | accepted |
| [0023](0023-a-table-row-is-added-in-place.md) | A table row is added in place | accepted |
| [0024](0024-node-26-joins-the-tested-toolchain.md) | Node 26 joins the tested toolchain | accepted |
