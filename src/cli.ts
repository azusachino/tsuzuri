#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { parse as parseToml } from "smol-toml";
import pkg from "tsuzuri/package.json" with { type: "json" };
// The CLI uses only the public SDK surface, the same one library consumers import.
import {
  captureInputFromMarkdown,
  type Filter,
  formatGrep,
  type GrepHit,
  type MoveResult,
  type OperationDefinition,
  type OperationName,
  propertyValue,
  type SectionWriteOptions,
  SORT_KEYS,
  TsuzuriError,
  Vault,
  type WriteOptions,
  type WriteResult,
} from "./index.ts";

class UsageError extends Error {
  override name = "UsageError";
}

/** `--json` or `--format json`, read from the raw arguments so it holds even when parsing them failed. */
const jsonErrors = (() => {
  const args = process.argv.slice(2);
  return (
    args.includes("--json") ||
    args.includes("--format=json") ||
    args.some((arg, i) => arg === "--format" && args[i + 1] === "json")
  );
})();

/**
 * Report a failure and exit: prose for people, or one JSON line for agents, carrying the error's own fields such as
 * `suggestions`, or a partial write's `path`, `hash`, and `committed`.
 */
function fail(error: Error, code: 1 | 2): never {
  if (jsonErrors) {
    const { name: _, ...fields } = Object.fromEntries(Object.entries(error));
    console.error(JSON.stringify({ error: { name: error.name, message: error.message, ...fields } }));
  } else {
    console.error(`tsuzuri: ${error.message}${code === 2 ? `\n\n${usage()}` : ""}`);
  }
  process.exit(code);
}

/** One option: its parseArgs type, the value it takes, and what it does. `--tag` and friends are declared once here. */
interface OptionSpec {
  type: "string" | "boolean";
  short?: string;
  multiple?: boolean;
  /** The value placeholder in help, such as `<n>`. */
  value?: string;
  summary: string;
}

const OPTIONS = {
  vault: {
    type: "string",
    value: "<dir>",
    summary: "vault root (default: $TSUZURI_VAULT, then nearest ancestor with tsuzuri.toml, then cwd)",
  },
  json: { type: "boolean", summary: "machine-readable output and errors, the same as --format json" },
  format: { type: "string", value: "<text|json|paths>", summary: "paths prints one path per line, for xargs and fzf" },
  fields: {
    type: "string",
    value: "<a,b,...>",
    summary: "only these fields: summary fields such as score, or any frontmatter key",
  },
  type: { type: "string", value: "<type>", summary: "only notes whose type property is this" },
  tag: {
    type: "string",
    multiple: true,
    value: "<tag>",
    summary:
      "a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub",
  },
  status: { type: "string", value: "<status>", summary: "only notes whose status property is this" },
  under: { type: "string", value: "<folder>", summary: "only notes in this folder" },
  where: {
    type: "string",
    multiple: true,
    value: "<key=value|key>",
    summary: "filter on any frontmatter property; may repeat; a bare key means present",
  },
  sort: { type: "string", value: "<modified|created|title|path>", summary: "order; notes without the value sort last" },
  desc: { type: "boolean", summary: "sort descending" },
  limit: { type: "string", value: "<n>", summary: "most results" },
  "max-chars": { type: "string", value: "<n>", summary: "truncate the note body" },
  lines: {
    type: "string",
    value: "<a:b>",
    summary: "lines a to b, counted from the top of the file (a:, :b, or one line)",
  },
  around: {
    type: "string",
    value: "<line|path:line>",
    summary: "a line and --context lines either side; accepts rg -n output",
  },
  context: { type: "string", short: "C", value: "<n>", summary: "lines either side (get --around: 5 by default)" },
  "fixed-strings": { type: "boolean", short: "F", summary: "match the pattern as literal text" },
  title: { type: "string", value: "<title>", summary: "the note's title (default: the first line of text)" },
  source: { type: "string", value: "<url>", summary: "where the note came from" },
  file: { type: "string", value: "<path>", summary: "read the note from a Markdown file" },
  heading: { type: "string", value: "<heading>", summary: "the section, by heading text" },
  "create-heading": { type: "boolean", summary: "add a missing heading at the end of the note instead of refusing" },
  level: { type: "string", value: "<1-6>", summary: "the level of a created heading (default: 2)" },
  "dry-run": { type: "boolean", summary: "show the result, a diff for edits, without writing" },
  "if-hash": { type: "string", value: "<sha256>", summary: "refuse unless the note still has the hash get returned" },
  trust: {
    type: "boolean",
    summary: "run the extension modules the vault itself lists (bundled tsuzuri: extensions need no trust)",
  },
  help: { type: "boolean", short: "h", summary: "show help, for one command when one is given" },
  version: { type: "boolean", short: "v", summary: "show the version" },
} as const satisfies Record<string, OptionSpec>;

type OptionName = keyof typeof OPTIONS;

/** One command: its arguments, the options it takes beyond the global ones, and an example that runs. */
interface CommandSpec {
  name: string;
  /** The vault operation the command runs; `help` runs none. */
  operation?: OperationName;
  args: string;
  summary: string;
  writes?: boolean;
  options: readonly OptionName[];
  example: string;
}

const GLOBAL: readonly OptionName[] = ["vault", "json", "format", "trust", "help", "version"];
const FILTERS: readonly OptionName[] = ["type", "tag", "status", "under", "where"];
const WRITE: readonly OptionName[] = ["dry-run", "if-hash"];
const SECTION: readonly OptionName[] = ["heading", "create-heading", "level"];

const COMMANDS: readonly CommandSpec[] = [
  {
    name: "types",
    operation: "types",
    args: "",
    summary: "list template-backed note types and their routes",
    options: [],
    example: "tsuzuri types --json",
  },
  {
    name: "check",
    operation: "check",
    args: "<note>",
    summary: "check a note's template keys and title/tag rules; exit 1 when it fails",
    options: [],
    example: 'tsuzuri check "Working memory" --json',
  },
  {
    name: "config",
    operation: "config",
    args: "",
    summary: "show effective settings, their sources, and the vault root",
    options: [],
    example: "tsuzuri config --json",
  },
  {
    name: "get",
    operation: "get",
    args: "<note>",
    summary: "print one note by path, file name, title, or alias; the JSON carries its hash for --if-hash",
    options: ["lines", "around", "context", "max-chars", "fields"],
    example: 'tsuzuri get "Working memory" --lines 1:20 --json',
  },
  {
    name: "search",
    operation: "search",
    args: "<query...>",
    summary: "rank notes by relevance (BM25; CJK matches as substrings)",
    options: [...FILTERS, "limit", "fields"],
    example: "tsuzuri search cognitive load --limit 5 --json",
  },
  {
    name: "grep",
    operation: "grep",
    args: "<pattern>",
    summary: "matching lines as path:line:text, like rg -n (smart case)",
    options: [...FILTERS, "fixed-strings", "context"],
    example: 'tsuzuri grep -F "working memory" -C 2',
  },
  {
    name: "find",
    operation: "suggest",
    args: "<query...>",
    summary: "fuzzy match over paths, titles, and aliases, ranked as fzf ranks",
    options: [...FILTERS, "limit", "fields"],
    example: "tsuzuri find cogload --json",
  },
  {
    name: "list",
    operation: "list",
    args: "",
    summary: "notes matching the filters, optionally sorted",
    options: [...FILTERS, "sort", "desc", "limit", "fields"],
    example: "tsuzuri list --tag psychology --sort modified --desc --limit 10",
  },
  {
    name: "tags",
    operation: "tags",
    args: "",
    summary: "every tag with its note count, parents of nested tags included",
    options: FILTERS,
    example: "tsuzuri tags --json",
  },
  {
    name: "nav",
    operation: "nav",
    args: "[folder]",
    summary: "a folder's index note and headings, subfolders, and notes",
    options: ["fields"],
    example: "tsuzuri nav Topics",
  },
  {
    name: "links",
    operation: "links",
    args: "<note>",
    summary: "a note's outgoing links and how each resolves",
    options: [],
    example: 'tsuzuri links "Cognitive load" --json',
  },
  {
    name: "backlinks",
    operation: "backlinks",
    args: "<note>",
    summary: "notes that link to a note",
    options: ["fields"],
    example: 'tsuzuri backlinks "Cognitive load"',
  },
  {
    name: "unresolved",
    operation: "unresolved",
    args: "",
    summary: "links pointing at no note, or at several",
    options: [],
    example: "tsuzuri unresolved --json",
  },
  {
    name: "orphans",
    operation: "orphans",
    args: "",
    summary: "notes no other note links to or embeds",
    options: [...FILTERS, "fields"],
    example: "tsuzuri orphans --under Topics",
  },
  {
    name: "outline",
    operation: "outline",
    args: "<note>",
    summary: "a note's headings with their line numbers",
    options: [],
    example: 'tsuzuri outline "Cognitive load"',
  },
  {
    name: "prop get",
    operation: "property",
    args: "<note> <key>",
    summary: "one frontmatter value",
    options: [],
    example: 'tsuzuri prop get "Cognitive load" tags --json',
  },
  {
    name: "capture",
    operation: "capture",
    args: "[text...]",
    summary: "create a new note in the capture folder from text, --file, or stdin; never edits a note",
    writes: true,
    options: ["title", "source", "tag", "file", "dry-run"],
    example: 'tsuzuri capture --tag reading --source https://example.com "Read: how agents plan" --dry-run',
  },
  {
    name: "init",
    operation: "init",
    args: "",
    summary: "write starter tsuzuri.toml and templates/capture.md without overwriting",
    writes: true,
    options: ["dry-run"],
    example: "tsuzuri init --dry-run --json",
  },
  {
    name: "new",
    operation: "create",
    args: "<type> <title...>",
    summary: "create a note from the vault's template for type, placed as capture places it",
    writes: true,
    options: ["tag", "dry-run"],
    example: "tsuzuri new Book The Pragmatic Programmer --dry-run",
  },
  {
    name: "append",
    operation: "append",
    args: "<note> [text...]",
    summary: "add text at the end of a note, or at the end of section --heading",
    writes: true,
    options: [...SECTION, ...WRITE],
    example: 'tsuzuri append Home "- a new line" --heading "start here" --dry-run',
  },
  {
    name: "section put",
    operation: "putSection",
    args: "<note> [text...]",
    summary: "replace the body of section --heading, or add the section",
    writes: true,
    options: ["heading", "level", ...WRITE],
    example: 'tsuzuri section put Home "Fresh text." --heading reading --dry-run',
  },
  {
    name: "prop set",
    operation: "setProperty",
    args: "<note> <key> <value>",
    summary: "set one frontmatter key, the value read as YAML, keeping comments and order",
    writes: true,
    options: WRITE,
    example: 'tsuzuri prop set "Cognitive load" rating 4 --dry-run',
  },
  {
    name: "write",
    operation: "write",
    args: "<path> [text...]",
    summary: "create a note at any .md path in the vault (text, --file, or stdin); an existing file is refused",
    writes: true,
    options: ["file", "dry-run"],
    example: 'tsuzuri write "Inbox/Fresh.md" "A whole new note." --dry-run',
  },
  {
    name: "delete",
    operation: "delete",
    args: "<note>",
    summary: "move a note into .trash, keeping its path with a timestamp added; links to it become unresolved",
    writes: true,
    options: WRITE,
    example: 'tsuzuri delete "Existing idea" --dry-run',
  },
  {
    name: "move",
    operation: "move",
    args: "<note> <path>",
    summary: "move or rename a note to a .md path, rewriting every link the move would break",
    writes: true,
    options: WRITE,
    example: 'tsuzuri move "Existing idea" "Notes/Existing idea.md" --dry-run',
  },
  {
    name: "put",
    operation: "put",
    args: "<note> [text...]",
    summary: "replace a whole note (text, --file, or stdin); --if-hash refuses one changed since get",
    writes: true,
    options: ["file", ...WRITE],
    example: 'tsuzuri put "Existing idea" "A whole new body." --dry-run',
  },
  {
    name: "help",
    args: "[command]",
    summary: "this usage, one command's help, or every command as JSON with --json",
    options: [],
    example: "tsuzuri help get",
  },
];

function optionLabel(name: OptionName): string {
  const spec: OptionSpec = OPTIONS[name];
  return `${spec.short ? `-${spec.short}, ` : ""}--${name}${spec.value ? ` ${spec.value}` : ""}`;
}

function optionLines(names: readonly OptionName[]): string {
  return names.map((name) => `  ${optionLabel(name).padEnd(30)} ${OPTIONS[name].summary}`).join("\n");
}

function commandLine(spec: CommandSpec): string {
  const call = `${spec.name} ${spec.args}`.trimEnd();
  return call.length <= 30 ? `  ${call.padEnd(30)} ${spec.summary}` : `  ${call}\n  ${"".padEnd(30)} ${spec.summary}`;
}

function usage(): string {
  const reads = COMMANDS.filter((spec) => !spec.writes).map(commandLine);
  const writes = COMMANDS.filter((spec) => spec.writes).map(commandLine);
  return [
    `tsuzuri ${pkg.version}: read and capture into an Obsidian-compatible Markdown vault`,
    "usage: tsuzuri <command> [options]",
    `commands:\n${reads.join("\n")}`,
    `writes:\n${writes.join("\n")}`,
    `options:\n${optionLines(Object.keys(OPTIONS) as OptionName[])}`,
    "Run tsuzuri help <command> for one command's options and an example, or tsuzuri help --json for every command.",
  ].join("\n\n");
}

function commandHelp(spec: CommandSpec): string {
  return [
    `usage: tsuzuri ${spec.name} ${spec.args}`.trimEnd(),
    spec.summary,
    spec.options.length > 0 ? `options:\n${optionLines(spec.options)}` : "options: none beyond the global ones",
    `global options: ${GLOBAL.map((name) => `--${name}`).join(", ")}`,
    `example:\n  ${spec.example}`,
  ].join("\n\n");
}

function optionJson(name: OptionName) {
  const spec: OptionSpec = OPTIONS[name];
  return {
    name: `--${name}`,
    ...(spec.short ? { short: `-${spec.short}` } : {}),
    ...(spec.value ? { value: spec.value } : {}),
    ...(spec.multiple ? { multiple: true } : {}),
    summary: spec.summary,
  };
}

function helpJson(specs: readonly CommandSpec[]) {
  return {
    version: pkg.version,
    global: GLOBAL.map(optionJson),
    commands: specs.map((spec) => ({
      name: spec.name,
      args: spec.args,
      summary: spec.summary,
      ...(spec.operation ? { operation: spec.operation } : {}),
      writes: spec.writes ?? false,
      options: spec.options.map(optionJson),
      example: spec.example,
    })),
  };
}

/** The command a command line runs: `prop set` before `prop`, so a subcommand wins. */
function commandFor(words: string[]): CommandSpec | undefined {
  const [first, second] = words;
  return COMMANDS.find((spec) => spec.name === `${first} ${second}`) ?? COMMANDS.find((spec) => spec.name === first);
}

/** The commands `help` names: `help prop` gives `prop get` and `prop set`. */
function commandsNamed(words: string[]): CommandSpec[] {
  for (let length = words.length; length > 0; length--) {
    const key = words.slice(0, length).join(" ");
    const found = COMMANDS.filter((spec) => spec.name === key || spec.name.startsWith(`${key} `));
    if (found.length > 0) return found;
  }
  throw new UsageError(`no command "${words.join(" ")}"; run tsuzuri help for the list`);
}

// A Markdown bullet such as "- read the paper", or a negative number such as -428, is text to write, not an option;
// parseArgs would read either as one.
const BULLET = "\u0000";
const argv = process.argv.slice(2).map((arg) => (/^-(\s|\d|\.\d)/.test(arg) ? `${BULLET}${arg}` : arg));

function parse() {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: OPTIONS,
    });
  } catch (error) {
    fail(new UsageError((error as Error).message), 2);
  }
}

// A first, loose read finds the command: a core command is parsed strictly against the core options below, and an
// extension's command, which brings options of its own, once its vault is open (see runExtension).
const loose = parseArgs({ args: argv, allowPositionals: true, strict: false, options: OPTIONS });
const firstWord = loose.positionals[0];
const coreWords = new Set(["help", ...COMMANDS.map((spec) => spec.name.split(" ")[0])]);
const extensionCommand = firstWord !== undefined && !coreWords.has(firstWord) && loose.values.version === undefined;
const parsed = extensionCommand ? (loose as unknown as ReturnType<typeof parse>) : parse();
const opts = parsed.values;
const positionals = parsed.positionals.map((arg) => (arg.startsWith(BULLET) ? arg.slice(BULLET.length) : arg));

function count(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new UsageError(`--${name} must be a positive integer`);
  return parsed;
}

/** Text for a write: the arguments joined, or stdin when there are none. */
async function inputText(words: string[]): Promise<string> {
  const value = words.length > 0 ? words.join(" ") : await text(process.stdin);
  if (value.trim() === "") throw new UsageError("nothing to write: give text or pipe it on stdin");
  return value;
}

function writeOptions(): WriteOptions {
  return { dryRun: opts["dry-run"], ifHash: opts["if-hash"] };
}

function sectionOptions(): SectionWriteOptions {
  const level = opts.level === undefined ? undefined : count("level", opts.level);
  if (level !== undefined && level > 6) throw new UsageError("--level must be 1 to 6");
  return { ...writeOptions(), heading: opts.heading, createHeading: opts["create-heading"], level };
}

/** A write's result: the diff on a dry run, else the path and the new hash for a following --if-hash. */
/** A move: its paths and the notes it rewrote, or, for a dry run, every diff it would apply. */
function emitMove(result: MoveResult): void {
  emit(result, () => {
    if (!result.written) return [result.diff, ...result.rewritten.map((write) => write.diff)].join("").trimEnd();
    const rewritten = result.rewritten.map((write) => `rewrote\t${write.path}`);
    return [`${result.from}\t${result.to}\t${result.hash}`, ...rewritten].join("\n");
  });
}

function emitWrite(result: WriteResult): void {
  emit(result, () =>
    result.written ? `${result.path}\t${result.hash}` : result.diff.trim() === "" ? "no change" : result.diff.trimEnd(),
  );
}

/** `key=value` requires that value; a bare `key` requires only that the property be present. */
function whereConditions(values: string[] | undefined): Record<string, string | null> | undefined {
  if (!values) return undefined;
  const conditions: Record<string, string | null> = {};
  for (const value of values) {
    const at = value.indexOf("=");
    const key = (at === -1 ? value : value.slice(0, at)).trim();
    if (key === "") throw new UsageError("--where takes key=value or key");
    conditions[key] = at === -1 ? null : value.slice(at + 1);
  }
  return conditions;
}

function lineCount(value: string): number {
  if (!/^\d+$/.test(value)) throw new UsageError("--context must be a whole number");
  return Number(value);
}

/** `a:b`, `a:`, `:b`, or one line `a`. */
function lineSpan(value: string): { start?: number; end?: number } {
  const match = /^(\d*):(\d*)$/.exec(value) ?? /^(\d+)()$/.exec(value);
  if (!match || (match[1] === "" && match[2] === "")) throw new UsageError("--lines takes a:b, a:, :b, or a line");
  const start = match[1] ? Number(match[1]) : undefined;
  const end = match[2] ? Number(match[2]) : value.includes(":") ? undefined : start;
  return { start, end };
}

/** A line, `path:line`, or a whole `rg -n` result `path:line:text`. */
function aroundTarget(value: string): { ref?: string; line: number } {
  if (/^\d+$/.test(value)) return { line: Number(value) };
  const match = /^(.+?):(\d+)(?::.*)?$/s.exec(value);
  if (!match) throw new UsageError("--around takes a line or path:line");
  return { ref: match[1], line: Number(match[2]) };
}

function one(args: string[], what: string): string {
  if (args.length !== 1) throw new UsageError(`expected exactly one ${what}`);
  return args[0] as string;
}

const FORMATS = ["text", "json", "paths"];
const format = opts.format ?? (opts.json ? "json" : "text");
const fields = opts.fields?.split(",").map((field) => field.trim());

function emit(value: unknown, human: () => string): void {
  if (format === "paths" || fields) {
    throw new UsageError("--format paths and --fields work with get, search, list, nav, and backlinks");
  }
  console.log(format === "json" ? JSON.stringify(value, null, 2) : human());
}

const cell = (value: unknown) =>
  value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);

/** Emit notes: one path per line with `--format paths`, only the named fields with `--fields`, else `value`. */
async function emitNotes(vault: Vault, notes: { path: string }[], value: unknown, human: () => string): Promise<void> {
  if (format === "paths") return console.log([...new Set(notes.map((note) => note.path))].join("\n"));
  if (!fields) return emit(value, human);
  const rows = await vault.select(notes, fields);
  const selected = Array.isArray(value) ? rows : rows[0];
  if (format === "json") return console.log(JSON.stringify(selected, null, 2));
  console.log(rows.map((row) => Object.values(row).map(cell).join("\t")).join("\n"));
}

/** The user's list of vaults trusted to run their own extension modules: `vaults = [...]` in this file. */
const TRUST_FILE = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "tsuzuri", "trust.toml");

function trustedByUser(root: string): boolean {
  if (!existsSync(TRUST_FILE)) return false;
  const { vaults } = parseToml(readFileSync(TRUST_FILE, "utf8")) as { vaults?: unknown };
  return Array.isArray(vaults) && vaults.some((vault) => typeof vault === "string" && resolve(vault) === root);
}

/** The vault with the extensions it lists, saying on stderr which it skipped and how to load them. */
async function openVault(dir: string | undefined, trust: boolean): Promise<Vault> {
  const explicit = dir ?? process.env.TSUZURI_VAULT;
  let root = resolve(explicit || process.cwd());
  if (!explicit) {
    for (let at = root; ; at = resolve(at, "..")) {
      if (existsSync(join(at, "tsuzuri.toml"))) {
        root = at;
        break;
      }
      if (at === resolve(at, "..")) break;
    }
  }
  const vault = await Vault.open(root, { trust: trust || trustedByUser(root) });
  if (vault.skipped.length > 0) {
    const skipped = vault.skipped.map((skip) => `${skip.extension} (${skip.reason})`).join(", ");
    console.error(`tsuzuri: skipped extensions ${skipped}; pass --trust, or list the vault in ${TRUST_FILE}`);
  }
  return vault;
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** An extension's command in the shape `help` prints for a core one. */
function extensionSpec(vault: Vault, name: string) {
  const definition = vault.definition(name) as OperationDefinition;
  const entries = Object.entries(definition.input);
  return {
    definition,
    name: definition.command,
    operation: definition.name,
    args: entries
      .filter(([, input]) => input.required)
      .map(([key]) => `<${key}>`)
      .join(" "),
    summary: definition.summary,
    writes: definition.kind !== "read",
    options: entries
      .filter(([, input]) => !input.required)
      .map(([key, input]) => ({
        name: `--${kebab(key)}`,
        ...(input.type === "boolean" ? {} : { value: `<${input.enum?.join("|") ?? input.type}>` }),
        ...(input.type === "array" ? { multiple: true } : {}),
        summary: input.description,
      })),
  };
}

/** The commands a vault's loaded extensions add, or none when the vault cannot be opened. */
async function extensionSpecs(): Promise<ReturnType<typeof extensionSpec>[]> {
  let vault: Vault;
  try {
    vault = await openVault(opts.vault, opts.trust === true);
  } catch {
    return [];
  }
  return vault
    .operations()
    .filter((operation) => operation.extension !== undefined)
    .map((operation) => extensionSpec(vault, operation.name));
}

function extensionHelp(spec: ReturnType<typeof extensionSpec>): string {
  const options = spec.options.map(
    (option) => `  ${`${option.name}${option.value ? ` ${option.value}` : ""}`.padEnd(30)} ${option.summary}`,
  );
  return [
    `usage: tsuzuri ${spec.name} ${spec.args}`.trimEnd(),
    spec.summary,
    options.length > 0 ? `options:\n${options.join("\n")}` : "options: none beyond the global ones",
    `global options: ${GLOBAL.map((name) => `--${name}`).join(", ")}`,
  ].join("\n\n");
}

/**
 * Run an extension's command. Its required inputs are the arguments, in order, the last taking the remaining words
 * when it is text, or stdin; its other inputs are `--kebab-case` options.
 */
async function runExtension(): Promise<void> {
  const vault = await openVault(loose.values.vault as string | undefined, loose.values.trust === true);
  const words = loose.positionals;
  const named = (count: number) =>
    vault.operations().find((operation) => operation.command === words.slice(0, count).join(" "));
  const operation = named(2) ?? named(1);
  if (!operation?.command) {
    const loaded = vault.operations().flatMap((each) => (each.command ? [each.command] : []));
    throw new UsageError(
      `unknown command "${firstWord}"${loaded.length > 0 ? `; extensions add: ${loaded.join(", ")}` : ""}`,
    );
  }
  const spec = extensionSpec(vault, operation.name);
  const { definition } = spec;
  const inputs = Object.entries(definition.input);
  let strict: ReturnType<typeof parseArgs>;
  try {
    strict = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        ...Object.fromEntries(GLOBAL.map((name) => [name, OPTIONS[name]])),
        ...Object.fromEntries(
          inputs
            .filter(([, input]) => !input.required)
            .map(([key, input]) => [
              kebab(key),
              { type: input.type === "boolean" ? "boolean" : "string", multiple: input.type === "array" },
            ]),
        ),
      } as Parameters<typeof parseArgs>[0] extends { options?: infer O } ? O : never,
    });
  } catch (error) {
    throw new UsageError(`${(error as Error).message}; run tsuzuri help ${spec.name}`);
  }
  if (strict.values.help) return console.log(extensionHelp(spec));
  const given = strict.positionals
    .map((arg) => (arg.startsWith(BULLET) ? arg.slice(BULLET.length) : arg))
    .slice(definition.command.split(" ").length);
  const required = inputs.filter(([, input]) => input.required);
  const input: Record<string, unknown> = {};
  const value = (key: string, raw: unknown, type: string, allowed?: readonly string[]) => {
    if (allowed && !allowed.includes(raw as string)) throw new UsageError(`${key} must be ${allowed.join(", ")}`);
    if (type !== "integer") return raw;
    const number = Number(raw);
    if (!Number.isInteger(number)) throw new UsageError(`--${kebab(key)} must be a whole number`);
    return number;
  };
  // Free text as the last argument takes the remaining words, or stdin; a choice such as a period takes one word.
  const text = (property: { type: string; enum?: readonly string[] } | undefined) =>
    property?.type === "string" && property.enum === undefined;
  for (const [i, [key, property]] of required.entries()) {
    if (i === required.length - 1 && text(property)) {
      input[key] = await inputText(given.slice(i));
    } else {
      if (given[i] === undefined) throw new UsageError(`usage: tsuzuri ${spec.name} ${spec.args}`);
      input[key] = value(key, given[i], property.type, property.enum);
    }
  }
  if (!text(required.at(-1)?.[1]) && given.length > required.length) {
    throw new UsageError(`usage: tsuzuri ${spec.name} ${spec.args}`);
  }
  for (const [key, property] of inputs.filter(([, each]) => !each.required)) {
    const raw = strict.values[kebab(key)];
    if (raw !== undefined) input[key] = Array.isArray(raw) ? raw : value(key, raw, property.type, property.enum);
  }
  const result = await vault.run(definition.name, input);
  const json = strict.values.json === true || strict.values.format === "json";
  console.log(json || !definition.format ? JSON.stringify(result, null, 2) : definition.format(result));
}

async function main(): Promise<void> {
  if (opts.version) return console.log(pkg.version);
  if (extensionCommand) return runExtension();
  const [command, ...args] = positionals;
  if (!command) return console.log(usage());
  if (command === "help" || opts.help) {
    const words = command === "help" ? args : positionals;
    if (words.length === 0) {
      const extensions = await extensionSpecs();
      const listed = extensions.map(({ definition: _, ...spec }) => spec);
      if (format === "json") return console.log(JSON.stringify({ ...helpJson(COMMANDS), extensions: listed }, null, 2));
      const lines = listed.map((spec) => `  ${`${spec.name} ${spec.args}`.padEnd(30)} ${spec.summary}`);
      return console.log(lines.length > 0 ? `${usage()}\n\nextension commands:\n${lines.join("\n")}` : usage());
    }
    if (!coreWords.has(words[0] as string)) {
      const found = (await extensionSpecs()).filter((spec) => spec.name.startsWith(words.join(" ")));
      if (found.length === 0) throw new UsageError(`no command "${words.join(" ")}"; run tsuzuri help for the list`);
      if (format === "json")
        return console.log(
          JSON.stringify(
            found.map(({ definition: _, ...spec }) => spec),
            null,
            2,
          ),
        );
      return console.log(found.map(extensionHelp).join("\n\n---\n\n"));
    }
    const specs = command === "help" ? commandsNamed(words) : [commandFor(words) ?? commandsNamed(words)].flat();
    return console.log(
      format === "json" ? JSON.stringify(helpJson(specs), null, 2) : specs.map(commandHelp).join("\n\n---\n\n"),
    );
  }
  const spec = commandFor(positionals);
  if (spec) {
    const allowed = new Set<string>([...GLOBAL, ...spec.options]);
    for (const [name, value] of Object.entries(opts)) {
      if (value !== undefined && !allowed.has(name)) {
        throw new UsageError(`${spec.name} does not take --${name}; run tsuzuri help ${spec.name}`);
      }
    }
  }

  if (!FORMATS.includes(format)) throw new UsageError(`--format takes ${FORMATS.join(", ")}`);
  const vault = await openVault(opts.vault, opts.trust === true);
  // capture reads --tag itself, as tags to write; everywhere else every --tag must match.
  const filter: Filter = {
    type: opts.type,
    tags: command === "capture" ? undefined : opts.tag,
    status: opts.status,
    under: opts.under,
    where: whereConditions(opts.where),
  };

  switch (command) {
    case "types": {
      if (args.length > 0) throw new UsageError("types takes no arguments");
      const types = await vault.types();
      return emit(types, () =>
        types.map((item) => `${item.type}\t${item.template}\t${item.folder}\t${item.filename}`).join("\n"),
      );
    }
    case "check": {
      const result = await vault.check(one(args, "note"));
      emit(result, () => [result.path, ...result.missing.map((key) => `missing: ${key}`), ...result.errors].join("\n"));
      if (!result.ok) process.exitCode = 1;
      return;
    }
    case "config": {
      if (args.length > 0) throw new UsageError("config takes no arguments");
      const result = vault.config();
      return emit(result, () =>
        [
          result.root,
          ...result.settings.map(({ name, value, source }) => `${name}\t${JSON.stringify(value)}\t${source}`),
        ].join("\n"),
      );
    }
    case "init": {
      if (args.length > 0) throw new UsageError("init takes no arguments");
      const result = vault.init({ dryRun: opts["dry-run"] });
      return emit(result, () =>
        result.files
          .map(({ path, content }) => `${path}${result.written ? "" : " (dry run)"}\n${result.written ? "" : content}`)
          .join("\n"),
      );
    }
    case "get": {
      const around = opts.around === undefined ? undefined : aroundTarget(opts.around);
      if (around?.ref && args.length > 0)
        throw new UsageError("give the note once: as <note> or in --around path:line");
      if (opts.context !== undefined && !around) throw new UsageError("--context needs --around");
      const note = await vault.get(around?.ref ?? one(args, "note"), {
        maxChars: count("max-chars", opts["max-chars"]),
        lines: opts.lines === undefined ? undefined : lineSpan(opts.lines),
        around: around && {
          line: around.line,
          context: opts.context === undefined ? undefined : lineCount(opts.context),
        },
      });
      const where = note.start === undefined ? note.path : `${note.path}:${note.start}-${note.end} of ${note.total}`;
      return emitNotes(vault, [note], note, () => `${where}\n\n${note.body}${note.truncated ? "\n[truncated]" : ""}`);
    }
    case "grep": {
      let hits: GrepHit[];
      try {
        hits = await vault.grep(one(args, "pattern"), {
          ...filter,
          fixed: opts["fixed-strings"],
          context: opts.context === undefined ? undefined : lineCount(opts.context),
        });
      } catch (error) {
        if (error instanceof SyntaxError) throw new UsageError(`invalid pattern: ${error.message}`);
        throw error;
      }
      return emitNotes(vault, hits, hits, () => formatGrep(hits));
    }
    case "search": {
      if (args.length === 0) throw new UsageError("search needs a query");
      const hits = await vault.search(args.join(" "), { ...filter, limit: count("limit", opts.limit) });
      return emitNotes(vault, hits, hits, () =>
        hits.length === 0
          ? "no matches"
          : hits.map((hit) => `${hit.score}\t${hit.path}\t${hit.title}\n\t${hit.snippet}`).join("\n"),
      );
    }
    case "find": {
      if (args.length === 0) throw new UsageError("find needs a query");
      const hits = await vault.suggest(args.join(" "), { ...filter, limit: count("limit", opts.limit) });
      return emitNotes(vault, hits, hits, () =>
        hits.length === 0 ? "no matches" : hits.map((hit) => `${hit.score}\t${hit.path}\t${hit.title}`).join("\n"),
      );
    }
    case "tags": {
      if (args.length > 0) throw new UsageError("tags takes no arguments; narrow it with the filters");
      const counts = await vault.tags(filter);
      return emit(counts, () => counts.map(({ tag, notes }) => `${notes}\t${tag}`).join("\n"));
    }
    case "list": {
      const sort = opts.sort;
      if (sort !== undefined && !(SORT_KEYS as readonly string[]).includes(sort)) {
        throw new UsageError(`--sort takes ${SORT_KEYS.join(", ")}`);
      }
      const notes = await vault.list({
        ...filter,
        sort: sort as (typeof SORT_KEYS)[number] | undefined,
        desc: opts.desc,
        limit: count("limit", opts.limit),
      });
      return emitNotes(vault, notes, notes, () => notes.map((note) => `${note.path}\t${note.title}`).join("\n"));
    }
    case "nav": {
      if (args.length > 1) throw new UsageError("nav takes at most one folder");
      const view = await vault.nav(args[0]);
      const notes = view.index ? [view.index, ...view.notes] : view.notes;
      return emitNotes(vault, notes, view, () =>
        [
          view.index
            ? `${view.index.path}\t${view.index.title}\n${view.index.headings.map((h) => `  # ${h}`).join("\n")}`
            : "",
          ...view.folders.map((folder) => `${folder.path}/\t${folder.title}\t(${folder.notes})`),
          ...view.notes.map((note) => `${note.path}\t${note.title}`),
        ]
          .filter((line) => line !== "")
          .join("\n"),
      );
    }
    case "links": {
      const links = await vault.links(one(args, "note"));
      return emit(links, () =>
        links
          .map(({ target, resolution }) => {
            if (resolution.status === "resolved") return `${target}\t-> ${resolution.path}`;
            if (resolution.status === "ambiguous") return `${target}\tambiguous: ${resolution.candidates.join(", ")}`;
            return `${target}\t${resolution.status}`;
          })
          .join("\n"),
      );
    }
    case "orphans": {
      if (args.length > 0) throw new UsageError("orphans takes no arguments; narrow it with the filters");
      const notes = await vault.orphans(filter);
      return emitNotes(vault, notes, notes, () => notes.map((note) => `${note.path}\t${note.title}`).join("\n"));
    }
    case "outline": {
      const headings = await vault.outline(one(args, "note"));
      return emit(headings, () =>
        headings.map(({ level, text, line }) => `${line}\t${"#".repeat(level)} ${text}`).join("\n"),
      );
    }
    case "prop": {
      const [action, ref, key, ...rest] = args;
      if (action === "set" && ref && key && rest.length > 0) {
        return emitWrite(await vault.setProperty(ref, key, propertyValue(rest.join(" ")), writeOptions()));
      }
      if (action !== "get" || !ref || !key || rest.length > 0) {
        throw new UsageError("usage: prop get <note> <key>, or prop set <note> <key> <value>");
      }
      const value = await vault.property(ref, key);
      return emit(value, () => (typeof value === "string" ? value : JSON.stringify(value)));
    }
    case "delete": {
      const note = one(args, "note");
      const result = await vault.delete(note, writeOptions());
      return emit(result, () => `${result.path}\t${result.trashed}${result.written ? "" : "\t(dry run)"}`);
    }
    case "move": {
      const [ref, to, ...rest] = args;
      if (!ref || !to || rest.length > 0) throw new UsageError("usage: move <note> <path>");
      return emitMove(await vault.move(ref, to, writeOptions()));
    }
    case "write":
    case "put": {
      const [target, ...words] = args;
      if (!target) throw new UsageError(`${command} needs a ${command === "write" ? "vault path" : "note"}`);
      if (opts.file && words.length > 0) throw new UsageError(`${command} takes text or --file, not both`);
      const content = opts.file ? readFileSync(opts.file, "utf8") : await inputText(words);
      if (command === "write") return emitWrite(await vault.write(target, content, { dryRun: opts["dry-run"] }));
      return emitWrite(await vault.put(target, content, writeOptions()));
    }
    case "backlinks": {
      const notes = await vault.backlinks(one(args, "note"));
      return emitNotes(vault, notes, notes, () => notes.map((note) => `${note.path}\t${note.title}`).join("\n"));
    }
    case "unresolved": {
      const links = await vault.unresolved();
      return emit(links, () =>
        links.map((link) => `${link.from}\t${link.target}\t${link.resolution.status}`).join("\n"),
      );
    }
    case "append": {
      const [ref, ...words] = args;
      if (!ref) throw new UsageError("append needs a note");
      return emitWrite(await vault.append(ref, await inputText(words), sectionOptions()));
    }
    case "section": {
      const [action, ref, ...words] = args;
      if (action !== "put" || !ref || !opts.heading)
        throw new UsageError("usage: section put <note> --heading H [text]");
      return emitWrite(await vault.putSection(ref, opts.heading, await inputText(words), sectionOptions()));
    }
    case "new": {
      const [type, ...words] = args;
      if (!type || words.length === 0) throw new UsageError("usage: new <type> <title>");
      const result = await vault.create(type, words.join(" "), {
        tags: opts.tag,
        dryRun: opts["dry-run"],
      });
      return emit(result, () => (result.written ? result.path : `${result.path} (dry run)\n\n${result.content}`));
    }
    case "capture": {
      if (opts.file && args.length > 0) throw new UsageError("capture takes text or --file, not both");
      const base = opts.file
        ? captureInputFromMarkdown(readFileSync(opts.file, "utf8"), opts.file)
        : { text: args.length > 0 ? args.join(" ") : await text(process.stdin) };
      const result = await vault.capture(
        {
          ...base,
          title: opts.title ?? base.title,
          tags: [...(base.tags ?? []), ...(opts.tag ?? [])],
          source: opts.source ?? base.source,
        },
        { dryRun: opts["dry-run"] },
      );
      return emit(result, () => (result.written ? result.path : `${result.path} (dry run)\n\n${result.content}`));
    }
    default:
      throw new UsageError(`unknown command "${command}"`);
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof UsageError) fail(error, 2);
  if (error instanceof TsuzuriError) fail(error, 1);
  throw error;
}
