.PHONY: install check validate build node-smoke pack publish format corpus

install: ## Install dependencies from the lockfile and check out the CI corpus
	npm ci
	git submodule update --init --depth 1 tests/vaults/kepano-obsidian

check: ## Pre-commit gate: Biome lint and format, types, Markdown, spelling, tests
	npm run lint
	npm run typecheck
	rumdl check .
	typos
	npm run build:lib
	npm run test
	npx tsc --ignoreConfig --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck tests/consumer.ts

validate: check build ## Pre-PR gate: check, then run the built CLI against the fixture vault
	node dist/lib/cli.js --vault tests/fixtures/vault nav --json > /dev/null
	node dist/lib/cli.js --vault tests/fixtures/vault search "cognitive load" --json > /dev/null

node-smoke: ## Run the read commands on Node, then run the package and its two commands from a node_modules install, requiring Bun's output
	npm run build:lib
	bun tests/bun-providers.ts
	bun tests/node-smoke.ts

build: ## Build the CLI and SDK into JavaScript at dist/lib
	npm run build

pack: ## Pack tsuzuri into dist/pack, the tarball npm and each GitHub release carry
	rm -rf dist/pack
	mkdir -p dist/pack
	npm pack --pack-destination dist/pack
	tar -tzf dist/pack/tsuzuri-[0-9]*.tgz | grep -q package/dist/lib/index.d.ts
	tar -tzf dist/pack/tsuzuri-[0-9]*.tgz | grep -q package/dist/lib/tools.d.ts
	tar -tzf dist/pack/tsuzuri-[0-9]*.tgz | grep -q package/dist/lib/extension.d.ts
	tar -tzf dist/pack/tsuzuri-[0-9]*.tgz | grep -q package/dist/lib/extensions/journal.d.ts
	tar -tzf dist/pack/tsuzuri-[0-9]*.tgz | grep -q package/README.md
	! tar -tzf dist/pack/tsuzuri-[0-9]*.tgz | grep -q -e '\.test\.ts$$' -e '^package/tests/'

# Needs `npm login` as the package owner; npm asks for a one-time password when 2FA is on.
publish: pack ## Publish the packed tarball to npm, after the release is tagged
	npm publish dist/pack/tsuzuri-[0-9]*.tgz

format: ## Apply Biome and rumdl formatting
	npm run format
	rumdl fmt .

corpus: ## Check out the opt-in obsidian-help corpus (about 635 MB), which tests then include
	git -c submodule.test/vaults/obsidian-help.update=checkout submodule update --init --depth 1 tests/vaults/obsidian-help
