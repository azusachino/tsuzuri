# Contributing

tsuzuri is a personal project shared publicly. Issues, fixes, and honest disagreement with a design decision are welcome. Read [AGENTS.md](AGENTS.md) and the [roadmap](docs/roadmap.md) first: most non-obvious choices are recorded there with their reasons, and a pull request that contradicts one should say so rather than silently reverting it.

## Setup

```bash
mise install node rumdl typos  # Node toolchain; Bun is optional
make install                  # dependencies from package-lock.json, plus the kepano-obsidian test vault
```

## Before opening a pull request

```bash
make check       # Biome lint and format, tsc, rumdl, typos, and tests
make validate    # check, then build the binary and run it against the fixture vault
```

CI runs `make validate` on every push and pull request; a red run blocks merge. `make format` applies Biome and rumdl formatting. `make corpus` fetches the large opt-in `obsidian-help` vault, which the test suite then includes.
`make node-smoke` additionally compares Node and Bun when Bun is installed.

## Tests

- Contract tests live in `tests/` and import only `tsuzuri` and `tsuzuri/tools`, by the package's own name, as a consumer would. Unit tests of internals sit beside their code in `src/*.test.ts`, with their own temporary files rather than the fixture vault.
- `tests/fixtures/vault` is a small synthetic vault for edge cases. Never copy real personal notes into it.
- `tests/vaults/` holds real public Obsidian vaults, pinned as submodules. Their tests assert invariants any correct reader must hold rather than exact counts.
- Behaviour that depends on a vault's own conventions is tested through `tsuzuri.toml` or `VaultOptions.config`, never built in as a default.

## Code style

- Biome formats and lints TypeScript and JSON; rumdl formats and lints Markdown. Do not hand-format around them.
- Comments explain a non-obvious why, never restate what the code does.
- New code uses standard `node:` modules that both Bun and Node provide. A Bun-only API belongs in a provider of a [fallback chain](docs/roadmap.md#capabilities-and-fallback-chains).
- Add a dependency only when it has released within the past year, has few or no dependencies of its own, and does something hard to get right.

## Releasing

1. Update `CHANGELOG.md` and the `version` in `package.json`, and merge.
2. Tag the merge commit `v<version>` and push the tag. The [release workflow](.github/workflows/release.yml) checks the tag against the version, runs `make validate`, publishes the package to npm with provenance, and creates the GitHub release with the tarball and the version's changelog section.

npm trusts that workflow by OIDC, so no npm token is stored: on npmjs.com, the package's settings name `azusachino/tsuzuri` and `release.yml` as its trusted publisher. `make publish` remains for a manual release from a maintainer's machine, after `npm login`.

Consumers install from npm, as the [README](README.md#install) shows. A Git dependency on the repository installs the package without its built `dist/lib`, which Node needs; install from npm.

## Reporting a security issue

See [SECURITY.md](SECURITY.md). Do not open a public issue for a real vulnerability.
