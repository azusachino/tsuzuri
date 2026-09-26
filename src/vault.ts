import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ignore from "ignore";
import { parseDocument, stringify } from "yaml";
import {
  type CaptureInput,
  type CaptureOptions,
  type CaptureResult,
  canonicalTag,
  capture,
  captureInputFromMarkdown,
  captureTitle,
  validTags,
} from "./capture.ts";
import { formatDate } from "./dateformat.ts";
import { ConfigError, TsuzuriError } from "./errors.ts";
import { type Frontmatter, frontmatterRange, splitFrontmatter, stringList } from "./frontmatter.ts";
import { fuzzyRank } from "./fuzzy.ts";
import { type GrepHit, type GrepOptions, grep } from "./grep.ts";
import { extractLinks, frontmatterLinks, LinkIndex, type Resolution, type WikiLink } from "./links.ts";
import { planMove } from "./move.ts";
import {
  type AllowRule,
  type Extension,
  Mask,
  OPERATION_KINDS,
  OPERATIONS,
  type OperationDefinition,
  type OperationKind,
  type OperationName,
  PermissionError,
  vaultPath,
} from "./operations.ts";
import { indexDocument, rank, type SearchDocument } from "./search.ts";
import { findSection, headingsOf, SectionError, sectionContentEnd } from "./sections.ts";
import {
  CONFIG_FILE,
  listedExtensions,
  resolveSettings,
  type TsuzuriConfig,
  UnsupportedError,
  type VaultSettings,
} from "./settings.ts";
import { countTags, noteTags, type TagCount, tagMatches } from "./tags.ts";
import { renderTemplate, templateFor, templateNames } from "./templates.ts";
import { lowercaseTitle } from "./title.ts";
import {
  contentHash,
  splice,
  unifiedDiff,
  WriteConflictError,
  type WriteOptions,
  type WriteResult,
  writeNote,
} from "./write.ts";

export interface Note {
  /** Vault-relative POSIX path, e.g. `note/tech/cognitive-load.md`. */
  path: string;
  title: string;
  type?: string;
  status?: string;
  tags: string[];
  aliases: string[];
  frontmatter: Frontmatter;
  body: string;
  raw: string;
}

export interface NoteSummary {
  path: string;
  title: string;
  type?: string;
  status?: string;
  tags: string[];
  created?: string;
  modified?: string;
}

/** A search result: the note's summary, its BM25 score, and the text around the first match. */
export interface SearchHit extends NoteSummary {
  score: number;
  snippet: string;
}

export interface NoteContent extends NoteSummary {
  frontmatter: Frontmatter;
  body: string;
  /** SHA-256 of the file's bytes, for detecting a concurrent change. */
  hash: string;
  truncated: boolean;
  /** With `lines` or `around`: the first and last line returned and the file's line count; `body` holds those lines. */
  start?: number;
  end?: number;
  total?: number;
}

export interface TypeInfo {
  type: string;
  template: string;
  folder: string;
  filename: string;
}

export interface CheckResult {
  path: string;
  type: string;
  ok: boolean;
  missing: string[];
  errors: string[];
}

export interface InitResult {
  files: { path: string; content: string }[];
  written: boolean;
}

/**
 * Options for `get`. Line numbers count from 1 at the top of the file, frontmatter included, as `rg -n`, editors,
 * and Git diffs count them.
 */
export interface GetOptions {
  maxChars?: number;
  /** An inclusive range; a missing `start` or `end` runs to the first or last line. */
  lines?: { start?: number; end?: number };
  /** One line and `context` lines either side, 5 by default. */
  around?: { line: number; context?: number };
}

export interface Filter {
  type?: string;
  /** Matches Obsidian's way: case-insensitive, and `area` also matches `area/sub`. */
  tag?: string;
  /** Every one of these tags must match, each as `tag` does. */
  tags?: string[];
  status?: string;
  /** A folder prefix such as `note/tech`. */
  under?: string;
  /**
   * Frontmatter conditions that must all hold: a value compares as text, a list property matches when any item does,
   * and `null` means the property only has to be present.
   */
  where?: Record<string, string | null>;
}

export const SORT_KEYS = ["modified", "created", "title", "path"] as const;

export interface ListOptions {
  /** Dates sort as written, so ISO dates sort in time order. */
  sort?: (typeof SORT_KEYS)[number];
  desc?: boolean;
  limit?: number;
}

export interface OutgoingLink {
  target: string;
  display?: string;
  embed: boolean;
  resolution: Resolution;
}

export interface Heading {
  level: number;
  text: string;
  /** Counted from the top of the file, frontmatter included. */
  line: number;
}

export interface DeleteResult {
  /** The note's path before the delete. */
  path: string;
  /** Where the note went, or would go on a dry run: under `.trash`, its path with a timestamp added. */
  trashed: string;
  /** The hash of the deleted content, which the file in `.trash` keeps. */
  hash: string;
  written: boolean;
}

export interface MoveResult {
  from: string;
  to: string;
  /** A unified diff from the note at its old path to the note at its new one, with any of its own links rewritten. */
  diff: string;
  /** The hash of the moved note's content, for a following `ifHash`. */
  hash: string;
  written: boolean;
  /** Every other note whose links the move rewrote, or would. */
  rewritten: WriteResult[];
}

export interface SectionWriteOptions extends WriteOptions {
  /** A section to write in, by heading text; without it, `append` writes at the end of the note. */
  heading?: string;
  /** Add a missing heading at the end of the note instead of refusing. */
  createHeading?: boolean;
  /** The level of a created heading; 2 by default. */
  level?: number;
}

export interface NavEntry {
  path: string;
  title: string;
}

export interface NavView {
  folder: string;
  index?: NoteSummary & { headings: string[] };
  folders: (NavEntry & { notes: number })[];
  notes: NoteSummary[];
}

export interface VaultOptions {
  /** Settings in the shape of `tsuzuri.toml`, taking precedence over the vault's own `tsuzuri.toml`. */
  config?: TsuzuriConfig;
  /** Folder prefixes never scanned. Paths from the vault's `.gitmodules` are always excluded. */
  exclude?: string[];
  /**
   * For a long-running process: at most once per this many milliseconds, a read compares the notes' paths,
   * modification times, and sizes with the last scan and rescans when they changed. Unset, the scan is kept until
   * `reload()`; 0 checks on every read.
   */
  watch?: number;
  /**
   * The operations this `Vault` allows, by kind or name, optionally limited to folders (ADR 0018). Unset, everything
   * is allowed. A disallowed operation raises `PermissionError` before touching any file, and notes outside an
   * operation's folders are invisible to it.
   */
  allow?: AllowRule[];
  /**
   * Extensions a host passes in code (ADR 0019). `Vault.open` adds the ones the vault lists; `new Vault` loads none
   * itself, and reports the vault's listed extensions it lacks in `skipped`.
   */
  extensions?: Extension[];
}

/** For `Vault.open`: whether to run the extension modules the vault itself holds, which only a caller can decide. */
export interface OpenOptions extends VaultOptions {
  trust?: boolean;
}

/** An extension the vault lists but this `Vault` did not load, and why. */
export interface SkippedExtension {
  extension: string;
  reason: string;
}

/** The extensions shipped in the package (ADR 0020), loaded when a vault lists `tsuzuri:<name>`. */
const BUNDLED: Record<string, () => Promise<{ default: Extension }>> = {
  journal: () => import("./extensions/journal.ts"),
};

/** The vault-relative module each extension `Vault.open` loaded came from, to match it to the vault's list. */
const SOURCES = new WeakMap<Extension, string>();

/** The notes as last read, their link index, and the fingerprint `watch` compares. */
interface Scan {
  notes: Note[];
  search: Map<string, SearchDocument>;
  index: LinkIndex;
  fingerprint: string;
  /** Every note's resolved links, built on the first link query and dropped with the scan. */
  graph?: LinkGraph;
}

interface LinkGraph {
  /** Each note's links in order, each with its resolution. */
  outgoing: Map<string, OutgoingLink[]>;
  /** For each note, the other notes whose links resolve to it. */
  incoming: Map<string, Set<string>>;
}

export class NotFoundError extends TsuzuriError {
  /** The closest notes by fuzzy match, when a reference resolved to none. */
  readonly suggestions: string[];

  constructor(message: string, suggestions: string[] = []) {
    super(suggestions.length > 0 ? `${message}; closest: ${suggestions.join(", ")}` : message);
    this.suggestions = suggestions;
  }
}

/** A fuzzy `suggest` result: the note's summary, its fzf-style score, and the path, title, or alias that matched. */
export interface Suggestion extends NoteSummary {
  score: number;
  matched: string;
}

/** A line range that does not fit the note; the message gives the note's line count. */
export class LineRangeError extends TsuzuriError {}

export class Vault {
  readonly root: string;
  /** Resolved from code options, then `tsuzuri.toml`, then neutral defaults. */
  readonly settings: VaultSettings;
  private readonly exclude: string[];
  private cache?: Scan;
  /** The scan in flight, shared by every read that arrives while it runs. */
  private loading?: Promise<Scan>;
  /** Bumped by `reload`, so a scan that started before it does not become the cache. */
  private generation = 0;
  private readonly watch?: number;
  private checked = 0;
  private readonly mask: Mask;
  private skips: SkippedExtension[];
  private readonly defined = new Map<string, { definition: OperationDefinition; extension: string }>();
  private readonly extensionSettings = new Map<string, unknown>();

  constructor(root: string, options: VaultOptions = {}) {
    this.root = resolve(root);
    if (!existsSync(this.root) || !statSync(this.root).isDirectory())
      throw new NotFoundError(`no vault at ${this.root}`);
    const provided = options.extensions ?? [];
    const loads = (entry: string) =>
      provided.some((extension) => entry === `tsuzuri:${extension.name}` || SOURCES.get(extension) === entry);
    this.skips = listedExtensions(this.root, options.config)
      .filter((entry) => !loads(entry))
      .map((extension) => ({ extension, reason: "not loaded: open the vault with Vault.open to load it" }));
    const tables = new Set(provided.flatMap((extension) => (extension.table ? [extension.table] : [])));
    this.settings = resolveSettings(this.root, options.config, { tables, skipped: this.skips.length > 0 });
    for (const extension of provided) {
      const table = extension.table ? this.settings.tables[extension.table] : undefined;
      this.extensionSettings.set(extension.name, extension.settings?.(table, CONFIG_FILE));
      for (const definition of extension.operations) {
        if (definition.name in OPERATIONS || this.defined.has(definition.name)) {
          throw new ConfigError(`extension ${extension.name}: an operation named ${definition.name} already exists`);
        }
        if (!OPERATION_KINDS.includes(definition.kind)) {
          throw new ConfigError(`extension ${extension.name}: ${definition.name} has no kind ${definition.kind}`);
        }
        this.defined.set(definition.name, { definition, extension: extension.name });
      }
    }
    const extra = [...this.defined.values()].map(({ definition: { name, kind } }) => ({ name, kind }));
    this.mask = new Mask(options.allow, extra);
    this.exclude = ["node_modules", ...submodulePaths(this.root), ...(options.exclude ?? [])].map(folderPrefix);
    this.watch = options.watch;
  }

  /**
   * Open a vault with the extensions it lists (ADR 0019, 0020): a bundled `tsuzuri:<name>` always, and a module the
   * vault holds only with `trust`, since loading it runs the vault's code. An extension not loaded is reported in
   * `skipped`, and the vault opens with the rest.
   */
  static async open(root: string, options: OpenOptions = {}): Promise<Vault> {
    const at = resolve(root);
    const listed = existsSync(at) && statSync(at).isDirectory() ? listedExtensions(at, options.config) : [];
    const loaded: Extension[] = [];
    const untrusted: string[] = [];
    for (const entry of listed) {
      if (entry.startsWith("tsuzuri:")) {
        const load = BUNDLED[entry.slice("tsuzuri:".length)];
        if (!load) {
          const known = Object.keys(BUNDLED).map((name) => `tsuzuri:${name}`);
          throw new ConfigError(`${CONFIG_FILE}: no bundled extension ${entry}; there are: ${known.join(", ")}`);
        }
        loaded.push((await load()).default);
      } else if (!options.trust) {
        untrusted.push(entry);
      } else {
        if (vaultPath(entry) === undefined)
          throw new ConfigError(`${CONFIG_FILE}: extension ${entry} leaves the vault`);
        const extension = ((await import(pathToFileURL(join(at, entry)).href)) as { default?: Extension }).default;
        if (!extension || typeof extension.name !== "string" || !Array.isArray(extension.operations)) {
          throw new ConfigError(`${entry} does not export an extension as its default`);
        }
        SOURCES.set(extension, entry);
        loaded.push(extension);
      }
    }
    const vault = new Vault(root, { ...options, extensions: [...(options.extensions ?? []), ...loaded] });
    vault.skips = vault.skips.map((skip) =>
      untrusted.includes(skip.extension) ? { ...skip, reason: "the vault is not trusted to run its own code" } : skip,
    );
    return vault;
  }

  /** The extensions the vault lists that this `Vault` did not load, and why. */
  get skipped(): readonly SkippedExtension[] {
    return this.skips;
  }

  /** Every operation this vault offers: the core table's, then each loaded extension's, with its command. */
  operations(): { name: string; kind: OperationKind; command?: string; extension?: string }[] {
    return [
      ...(Object.entries(OPERATIONS) as [string, OperationKind][]).map(([name, kind]) => ({ name, kind })),
      ...[...this.defined.values()].map(({ definition: { name, kind, command }, extension }) => ({
        name,
        kind,
        command,
        extension,
      })),
    ];
  }

  /** A loaded extension's operation, by name. */
  definition(name: string): OperationDefinition | undefined {
    return this.defined.get(name)?.definition;
  }

  /**
   * Run a loaded extension's operation. The mask must allow it, and every call it makes through this vault is checked
   * by the mask too, so an extension never does more than the host allowed.
   */
  async run(name: string, input: Record<string, unknown>): Promise<unknown> {
    const entry = this.defined.get(name);
    if (!entry)
      throw new NotFoundError(
        `no extension operation ${name}; loaded: ${[...this.defined.keys()].join(", ") || "none"}`,
      );
    this.mask.check(name);
    return entry.definition.run(this, input, { settings: this.extensionSettings.get(entry.extension) });
  }

  /** Forget the scanned notes, e.g. after a `git pull`. */
  reload(): void {
    this.cache = undefined;
    this.loading = undefined;
    this.generation++;
  }

  /** Whether this vault's mask allows `op` anywhere, as `agentTools` asks before offering a tool. */
  allows(op: OperationName | (string & {})): boolean {
    return this.mask.allows(op);
  }

  async notes(): Promise<Note[]> {
    return this.reachable("notes");
  }

  async get(ref: string, options: GetOptions = {}): Promise<NoteContent> {
    const note = await this.resolve("get", ref);
    const range = lineRange(note, options);
    const text = range ? range.text : note.body;
    const max = options.maxChars;
    const truncated = max !== undefined && text.length > max;
    return {
      ...summarize(note),
      frontmatter: note.frontmatter,
      body: truncated ? text.slice(0, max) : text,
      hash: contentHash(note.raw),
      truncated,
      ...(range ? { start: range.start, end: range.end, total: range.total } : {}),
    };
  }

  async list(filter: Filter & ListOptions = {}): Promise<NoteSummary[]> {
    const notes = filtered(await this.reachable("list"), filter).map(summarize);
    if (filter.sort) {
      const key = filter.sort;
      const direction = filter.desc ? -1 : 1;
      notes.sort((a, b) => {
        const left = a[key];
        const right = b[key];
        // Notes without the value sort last in either direction, as a spreadsheet does.
        if (left === undefined || right === undefined) return left === right ? 0 : left === undefined ? 1 : -1;
        return direction * left.localeCompare(right) || a.path.localeCompare(b.path);
      });
    }
    return filter.limit === undefined ? notes : notes.slice(0, filter.limit);
  }

  async search(query: string, filter: Filter & { limit?: number } = {}): Promise<SearchHit[]> {
    this.mask.check("search");
    const scan = await this.load();
    const visible = this.mask.scope("search").everywhere
      ? scan.notes
      : scan.notes.filter((note) => this.mask.reaches("search", note.path));
    const docs = filtered(visible, filter).map((note) => scan.search.get(note.path) as SearchDocument);
    return rank(docs, query, filter.limit ?? 10).map(({ note, score, snippet }) => ({
      ...summarize(note),
      score,
      snippet,
    }));
  }

  /** Lines matching a regular expression (or literal text with `fixed`), with ripgrep's smart case. */
  async grep(pattern: string, options: Filter & GrepOptions = {}): Promise<GrepHit[]> {
    return grep(filtered(await this.reachable("grep"), options), pattern, options);
  }

  /** Every tag in the filtered notes with its note count, so a writer can reuse a tag instead of inventing one. */
  async tags(filter: Filter = {}): Promise<TagCount[]> {
    return countTags(filtered(await this.reachable("tags"), filter));
  }

  /** A note's links, each resolved; under a mask, a link to a note the mask hides is left out. */
  async links(ref: string): Promise<OutgoingLink[]> {
    const note = await this.resolve("links", ref);
    const outgoing = (await this.graph()).outgoing.get(note.path) ?? [];
    return outgoing.flatMap((link) => {
      const resolution = this.visibleResolution("links", link.resolution);
      return resolution ? [{ ...link, resolution }] : [];
    });
  }

  async backlinks(ref: string): Promise<NoteSummary[]> {
    const target = await this.resolve("backlinks", ref);
    const sources = (await this.graph()).incoming.get(target.path) ?? new Set();
    return (await this.reachable("backlinks")).filter((note) => sources.has(note.path)).map(summarize);
  }

  /**
   * Notes no other note links to or embeds, narrowed by the filters; a note linking only to itself is an orphan.
   * Under a mask, only the links of notes the mask shows count.
   */
  async orphans(filter: Filter = {}): Promise<NoteSummary[]> {
    const { incoming } = await this.graph();
    const notes = await this.reachable("orphans");
    const shown = new Set(notes.map((note) => note.path));
    const linked = (note: Note) => [...(incoming.get(note.path) ?? [])].some((source) => shown.has(source));
    return filtered(notes, filter)
      .filter((note) => !linked(note))
      .map(summarize);
  }

  /** A note's ATX headings with their line numbers, counted as `get --lines` counts; fenced code is skipped. */
  async outline(ref: string): Promise<Heading[]> {
    const note = await this.resolve("outline", ref);
    return headingsOf(note.raw).map(({ level, text, line }) => ({ level, text, line }));
  }

  /**
   * Add text to the end of a note, or to the end of section `heading`. A missing heading is an error unless
   * `createHeading` is set, which adds it at the end of the note.
   */
  async append(ref: string, text: string, options: SectionWriteOptions = {}): Promise<WriteResult> {
    const note = await this.resolve("append", ref);
    return this.change(note.path, options, (current) => {
      const addition = text.replace(/\s+$/, "");
      if (options.heading === undefined) return `${withNewline(current)}${addition}\n`;
      const section = findSection(current, options.heading);
      if (!section) return createSection(current, options, addition);
      // After the section's last character, on a line of its own; an empty section keeps its blank line below.
      const at = sectionContentEnd(current, section);
      const lead = current[at - 1] === "\n" ? "" : "\n";
      const tail = at === current.length || at === section.heading.bodyStart ? "\n" : "";
      return splice(current, at, at, `${lead}${addition}${tail}`);
    });
  }

  /** Replace section `heading`'s body, or add the section at the end of the note when it is missing. */
  async putSection(ref: string, heading: string, text: string, options: WriteOptions & { level?: number } = {}) {
    const note = await this.resolve("putSection", ref);
    return this.change(note.path, options, (current) => {
      const body = text.replace(/^\s+|\s+$/g, "");
      const section = findSection(current, heading);
      if (!section) return createSection(current, { ...options, heading, createHeading: true }, body);
      const old = current.slice(section.heading.bodyStart, section.end);
      const atEnd = section.end === current.length;
      const lead = /^\s*/.exec(old)?.[0] ?? "";
      const trail = /\s*$/.exec(old)?.[0] ?? "";
      const blank = old.trim() === "";
      const replacement = blank ? `\n${body}\n${atEnd ? "" : "\n"}` : `${lead}${body}${trail === "" ? "\n" : trail}`;
      return splice(current, section.heading.bodyStart, section.end, replacement);
    });
  }

  /**
   * Set one frontmatter key, adding it after the others when new. Comments, key order, quoting, and every other
   * line of the frontmatter are kept; a note without frontmatter gains a block.
   */
  async setProperty(ref: string, key: string, value: unknown, options: WriteOptions = {}): Promise<WriteResult> {
    const note = await this.resolve("setProperty", ref);
    return this.change(note.path, options, (current) => {
      const range = frontmatterRange(current);
      if (!range) return `---\n${stringify({ [key]: value }, { lineWidth: 0 })}---\n${current}`;
      const doc = parseDocument(current.slice(range.start, range.end));
      if (doc.errors.length > 0) {
        throw new WriteConflictError(`${note.path} has frontmatter YAML cannot parse: ${doc.errors[0]?.message}`);
      }
      doc.set(key, value);
      const yaml = doc.toString({ flowCollectionPadding: false, lineWidth: 0 }).replace(/\n$/, "");
      // An empty block has no line break of its own before the closing fence.
      return splice(current, range.start, range.end, range.start === range.end ? `${yaml}\n` : yaml);
    });
  }

  /** Create a note at any `.md` path in the vault, with this content; an existing file is refused. */
  async write(path: string, content: string, options: Pick<WriteOptions, "dryRun"> = {}): Promise<WriteResult> {
    const target = notePath(path, "write");
    this.mask.check("write", [target]);
    return this.recorded(
      writeNote(
        this.root,
        target,
        (current) => {
          if (current !== undefined) throw new WriteConflictError(`${target} exists; write only creates, put replaces`);
          return content;
        },
        options,
      ),
    );
  }

  /**
   * Move or rename a note to a `.md` path, making missing folders; an existing file there is refused. Every link that
   * resolved to a note before the move is rewritten where it would no longer resolve to that note, so the move leaves
   * no link broken (see `planMove`). Under a mask, the move needs its rule for both paths, and every note it rewrites
   * must be editable. `ifHash` guards the moved note; every rewritten note is refused if it changed since the scan.
   */
  async move(ref: string, to: string, options: WriteOptions = {}): Promise<MoveResult> {
    const note = await this.resolve("move", ref);
    const target = notePath(to, "move");
    if (target === note.path) throw new WriteConflictError(`${note.path} is already at ${target}`);
    this.mask.check("move", [note.path, target]);
    // A case-only target may be this file on one disk, but a different file on another.
    const existing = lstatSync(join(this.root, target), { throwIfNoEntry: false });
    if (existing) {
      const original = lstatSync(join(this.root, note.path));
      if (
        existing.dev !== original.dev ||
        existing.ino !== original.ino ||
        readdirSync(join(this.root, dirname(target))).includes(basename(target))
      ) {
        throw new WriteConflictError(`${target} exists; move does not overwrite`);
      }
    }
    const { notes } = await this.load();
    const plan = planMove(notes, note.path, target);
    const editable = [...plan.keys()].filter((path) => path !== note.path);
    const locked = editable.find((path) => !this.mask.kindReaches("edit", path));
    if (locked) {
      throw new PermissionError(
        `moving ${note.path} rewrites links in ${locked}, which this vault's mask does not allow editing`,
      );
    }
    const onDisk = (path: string) => contentHash(new TextDecoder().decode(readFileSync(join(this.root, path))));
    if (options.ifHash !== undefined && onDisk(note.path) !== options.ifHash) {
      throw new WriteConflictError(`${note.path} changed since it was read: its hash is now ${onDisk(note.path)}`);
    }
    // Every file the move rewrites must still be as scanned, since its new text was planned from that.
    const scanned = new Map(notes.map((scannedNote) => [scannedNote.path, scannedNote.raw]));
    const stale = [...plan.keys()].find((path) => onDisk(path) !== contentHash(scanned.get(path) as string));
    if (stale) throw new WriteConflictError(`${stale} changed since tsuzuri read it; reload and move again`);

    const moved = plan.get(note.path) ?? note.raw;
    const result = {
      from: note.path,
      to: target,
      diff: unifiedDiff(note.path, target, note.raw, moved),
      hash: contentHash(moved),
    };
    const rewrite = (path: string, dryRun: boolean) =>
      writeNote(this.root, path, () => plan.get(path) as string, {
        dryRun,
        ifHash: contentHash(scanned.get(path) as string),
      });
    if (options.dryRun) {
      const rewritten = await Promise.all(editable.map((path) => rewrite(path, true)));
      return { ...result, written: false, rewritten };
    }
    const rewritten: WriteResult[] = [];
    for (const path of editable) rewritten.push(await rewrite(path, false));
    mkdirSync(dirname(join(this.root, target)), { recursive: true });
    renameSync(join(this.root, note.path), join(this.root, target));
    if (moved !== note.raw) await writeNote(this.root, target, () => moved, {});
    this.reload();
    return { ...result, written: true, rewritten };
  }

  /**
   * Delete a note by moving it into the vault's `.trash` folder, keeping its path and adding a local timestamp:
   * `Topics/x.md` becomes `.trash/Topics/x.md.20260926112233`, with `-2` and on added when that name is taken. The
   * file keeps every byte, and restoring it is a rename. A mask checks the source path; the fixed trash destination is
   * part of that deletion (ADR 0021). Reads skip dot folders, and the name no longer ends in `.md`,
   * so nothing reads it as a note; links to it become unresolved. `ifHash` refuses a note changed since it was read.
   */
  async delete(ref: string, options: WriteOptions & { now?: Date } = {}): Promise<DeleteResult> {
    const note = await this.resolve("delete", ref);
    this.mask.check("delete", [note.path]);
    const file = join(this.root, note.path);
    const hash = contentHash(new TextDecoder().decode(readFileSync(file)));
    if (options.ifHash !== undefined && hash !== options.ifHash) {
      throw new WriteConflictError(`${note.path} changed since it was read: its hash is now ${hash}`);
    }
    const stamp = formatDate(options.now ?? new Date(), "YYYYMMDDHHmmss");
    let trashed = `.trash/${note.path}.${stamp}`;
    for (let n = 2; existsSync(join(this.root, trashed)); n++) trashed = `.trash/${note.path}.${stamp}-${n}`;
    if (options.dryRun) return { path: note.path, trashed, hash, written: false };
    mkdirSync(dirname(join(this.root, trashed)), { recursive: true });
    renameSync(file, join(this.root, trashed));
    this.reload();
    return { path: note.path, trashed, hash, written: true };
  }

  /** Replace a whole note. With `ifHash`, a note that changed since `get` returned that hash is refused. */
  async put(ref: string, content: string, options: WriteOptions = {}): Promise<WriteResult> {
    const note = await this.resolve("put", ref);
    return this.change(note.path, options, () => content);
  }

  /** Change an existing note through the shared write guards, then forget the scan so reads see the change. */
  private async change(path: string, options: WriteOptions, next: (current: string) => string): Promise<WriteResult> {
    return this.recorded(
      writeNote(
        this.root,
        path,
        (current) => {
          if (current === undefined) throw new NotFoundError(`${path} no longer exists`);
          return next(current);
        },
        options,
      ),
    );
  }

  /** Forget the scan after a write, so reads see the file. */
  private async recorded<T extends { written: boolean }>(write: Promise<T>): Promise<T> {
    const result = await write;
    if (result.written) this.reload();
    return result;
  }

  /** One frontmatter value of a note, as parsed; a note without the property raises `NotFoundError`. */
  async property(ref: string, key: string): Promise<unknown> {
    const note = await this.resolve("property", ref);
    if (!(key in note.frontmatter)) throw new NotFoundError(`${note.path} has no property "${key}"`);
    return note.frontmatter[key];
  }

  /**
   * Links that point at no note, or at more than one. Attachments are not checked. Under a mask, only the notes it
   * shows are checked, and an ambiguous link names only the candidates it shows.
   */
  async unresolved(): Promise<{ from: string; target: string; resolution: Resolution }[]> {
    const notes = await this.reachable("unresolved");
    const { outgoing } = await this.graph();
    return notes.flatMap((note) =>
      (outgoing.get(note.path) ?? []).flatMap(({ target, resolution }) => {
        if (resolution.status !== "missing" && resolution.status !== "ambiguous") return [];
        const shown = this.visibleResolution("unresolved", resolution) ?? resolution;
        return [{ from: note.path, target, resolution: shown }];
      }),
    );
  }

  /** A folder's own `index.md` or `README.md`, its subfolders, and its direct notes. */
  async nav(folder = ""): Promise<NavView> {
    const prefix = folderPrefix(folder);
    const notes = (await this.reachable("nav")).filter((note) => note.path.startsWith(prefix));
    const indexNote =
      notes.find((note) => note.path.toLowerCase() === `${prefix}index.md`.toLowerCase()) ??
      notes.find((note) => note.path.toLowerCase() === `${prefix}readme.md`.toLowerCase());
    const folders = new Map<string, number>();
    const direct: NoteSummary[] = [];
    for (const note of notes) {
      const rest = note.path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        if (note !== indexNote) direct.push(summarize(note));
      } else {
        const child = `${prefix}${rest.slice(0, slash)}`;
        folders.set(child, (folders.get(child) ?? 0) + 1);
      }
    }
    const titled = new Map(notes.map((note) => [note.path.toLowerCase(), note.title]));
    return {
      folder: prefix.replace(/\/$/, ""),
      ...(indexNote
        ? {
            index: {
              ...summarize(indexNote),
              headings: headingsOf(indexNote.raw).map((heading) => heading.text),
            },
          }
        : {}),
      folders: [...folders.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, count]) => ({
          path,
          title:
            titled.get(`${path}/index.md`.toLowerCase()) ??
            titled.get(`${path}/readme.md`.toLowerCase()) ??
            posix.basename(path),
          notes: count,
        })),
      notes: direct.sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  /** Template-backed types and their effective routes. */
  async types(): Promise<TypeInfo[]> {
    this.mask.check("types");
    const settings = this.settings.templates;
    if (!settings) return [];
    const paths = (await this.reachable("types")).map((note) => note.path);
    return [...new Set(templateNames(paths, settings.folder).map((name) => name.toLowerCase()))].sort().map((type) => ({
      type,
      template: templateFor(paths, settings.folder, type) as string,
      folder: this.settings.types[type]?.folder ?? this.settings.capture.folder,
      filename: this.settings.types[type]?.filename ?? this.settings.capture.filename,
    }));
  }

  /** Check a note against its template's frontmatter keys and vault-wide title/tag rules. */
  async check(ref: string): Promise<CheckResult> {
    const note = await this.resolve("check", ref);
    const type = note.type?.toLowerCase() ?? "capture";
    const settings = this.settings.templates;
    const visible = settings ? await this.reachable("check") : [];
    const paths = visible.map((each) => each.path);
    const template = settings && templateFor(paths, settings.folder, type);
    const missing: string[] = [];
    const errors: string[] = [];
    if (!template) errors.push(`no template for type "${type}"`);
    else {
      const raw = (visible.find((each) => each.path === template) as Note).raw;
      const expected = splitFrontmatter(raw).data;
      for (const key of Object.keys(expected)) if (!(key in note.frontmatter)) missing.push(key);
    }
    const rules = this.settings.capture;
    try {
      validTags(note.tags, rules);
    } catch (error) {
      errors.push((error as Error).message);
    }
    if (rules.tagStyle === "kebab") {
      for (const tag of note.tags) if (tag !== canonicalTag(tag)) errors.push(`tag "${tag}" is not kebab-case`);
    }
    if (rules.titleStyle === "lowercase" && note.title !== lowercaseTitle(note.title, new Set(rules.titleAllow))) {
      errors.push(`title "${note.title}" does not follow [titles] case`);
    }
    return { path: note.path, type, ok: missing.length === 0 && errors.length === 0, missing, errors };
  }

  /** Effective core settings and where each value came from. */
  config(): { root: string; settings: { name: string; value: unknown; source: string }[] } {
    this.mask.check("config");
    const { capture, templates, types, extensions, tables, sources } = this.settings;
    const values: Record<string, unknown> = {
      "capture.folder": capture.folder,
      "capture.filename": capture.filename,
      "tags.style": capture.tagStyle,
      "tags.require": capture.requireTags,
      "tags.reject": capture.rejectTags,
      "titles.case": capture.titleStyle,
      "titles.keep": capture.titleAllow,
      "templates.folder": templates?.folder ?? null,
      "templates.date_format": templates?.dateFormat ?? null,
      "templates.time_format": templates?.timeFormat ?? null,
      extensions,
    };
    for (const [type, route] of Object.entries(types)) {
      values[`types.${type}.folder`] = route.folder;
      values[`types.${type}.filename`] = route.filename;
    }
    const addTable = (name: string, value: unknown) => {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const entries = Object.entries(value);
        if (entries.length === 0) values[name] = {};
        for (const [key, nested] of entries) addTable(`${name}.${key}`, nested);
      } else values[name] = value;
    };
    for (const [name, table] of Object.entries(tables)) addTable(name, table);
    return {
      root: this.root,
      settings: Object.entries(values).map(([name, value]) => ({
        name,
        value,
        source: sources[name] ?? sources[name.split(".")[0] as string] ?? "default",
      })),
    };
  }

  /** Prepare or write a starter config and capture template, refusing any existing target. */
  init(options: { dryRun?: boolean } = {}): InitResult {
    const files = [
      {
        path: CONFIG_FILE,
        content:
          '# tsuzuri vault settings\n# [capture]\n# folder = "Inbox"\n# filename = "{{title}}"\n\n# [tags]\n# style = "as-written"\n# require = false\n\n# [titles]\n# case = "as-written"\n\n[templates]\nfolder = "templates"\n',
      },
      {
        path: "templates/capture.md",
        content: '---\ntitle: "{{title}}"\ncreated: "{{date:YYYY-MM-DD}}"\ntags:\n---\n\n{{title}}\n',
      },
    ];
    this.mask.check(
      "init",
      files.map((file) => file.path),
    );
    if (!options.dryRun) {
      if (lstatSync(join(this.root, "templates"), { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new WriteConflictError("templates is a symbolic link");
      }
      for (const file of files) {
        if (lstatSync(join(this.root, file.path), { throwIfNoEntry: false })) {
          throw new WriteConflictError(`${file.path} already exists`);
        }
      }
      mkdirSync(join(this.root, "templates"), { recursive: true });
      for (const file of files) writeFileSync(join(this.root, file.path), file.content, { flag: "wx" });
      this.reload();
    }
    return { files, written: !options.dryRun };
  }

  /**
   * Create a note from the vault's template for `type`, through `capture`: the template's placeholders are filled,
   * its properties and tags kept, and the note placed and styled by the vault's capture settings.
   */
  async create(
    type: string,
    title: string,
    options: CaptureOptions & { tags?: string[]; now?: Date } = {},
  ): Promise<CaptureResult> {
    this.mask.check("create");
    const settings = this.settings.templates;
    if (!settings) {
      throw new UnsupportedError("no template folder: set [templates] folder in tsuzuri.toml");
    }
    // Reading the template is part of creating from it, so the mask's read rules do not apply to it.
    const { notes } = await this.load();
    const paths = notes.map((note) => note.path);
    const path = templateFor(paths, settings.folder, type);
    if (!path) {
      const names = templateNames(paths, settings.folder);
      throw new NotFoundError(
        `no template for "${type}" in ${settings.folder}; there are: ${names.join(", ") || "none"}`,
      );
    }
    const now = options.now ?? new Date();
    const styledTitle = captureTitle({ text: title, title }, this.settings.capture);
    const template = (notes.find((note) => note.path === path) as Note).raw;
    const input = captureInputFromMarkdown(renderTemplate(template, styledTitle, now, settings), path);
    const tags = [...(input.tags ?? []), ...(options.tags ?? [])];
    return this.captureAs("create", { ...input, title: styledTitle, tags, now }, options, type);
  }

  async capture(input: CaptureInput, options: CaptureOptions = {}): Promise<CaptureResult> {
    const settings = this.settings.templates;
    const { notes } = await this.load();
    const path =
      settings &&
      templateFor(
        notes.map((note) => note.path),
        settings.folder,
        "capture",
      );
    if (!path || !settings) return this.captureAs("capture", input, options, "capture");
    const now = input.now ?? new Date();
    const title = captureTitle(input, this.settings.capture);
    const template = (notes.find((note) => note.path === path) as Note).raw;
    const base = captureInputFromMarkdown(renderTemplate(template, title, now, settings), path);
    return this.captureAs(
      "capture",
      {
        ...base,
        ...input,
        title,
        tags: [...(base.tags ?? []), ...(input.tags ?? [])],
        source: input.source ?? base.source,
        properties: { ...base.properties, ...input.properties },
        text: [base.text.trim(), input.text.trim()].filter(Boolean).join("\n\n"),
        now,
      },
      options,
      "capture",
    );
  }

  /** Capture under `op`: the note's path is planned first, and written only when the mask reaches it. */
  private async captureAs(
    op: OperationName,
    input: CaptureInput,
    options: CaptureOptions,
    type?: string,
  ): Promise<CaptureResult> {
    this.mask.check(op);
    const planned = { ...input, now: input.now ?? new Date() };
    const settings = { ...this.settings.capture, ...(type ? this.settings.types[type.toLowerCase()] : undefined) };
    const plan = await capture(this.root, planned, settings, { dryRun: true });
    this.mask.check(op, [plan.path]);
    return options.dryRun ? plan : this.recorded(capture(this.root, planned, settings, options));
  }

  /**
   * Keep only the named fields of each result, in order: the result's own field, such as `score`, or else the note's
   * frontmatter key. A field neither has is `null`.
   */
  async select(items: { path: string }[], fields: string[]): Promise<Record<string, unknown>[]> {
    const byPath = new Map((await this.reachable("select")).map((note) => [note.path, note]));
    return items.map((item) =>
      Object.fromEntries(
        fields.map((field) => [
          field,
          (field in item ? (item as Record<string, unknown>)[field] : byPath.get(item.path)?.frontmatter[field]) ??
            null,
        ]),
      ),
    );
  }

  /** Resolve a reference: a vault path (with or without `.md`), a unique filename stem, title, or alias. */
  async find(ref: string): Promise<Note> {
    return this.resolve("find", ref);
  }

  /** Notes ranked by fuzzy match of the query over their path, title, and aliases, with fzf's scoring rules. */
  async suggest(query: string, options: Filter & { limit?: number; anyTerm?: boolean } = {}): Promise<Suggestion[]> {
    return suggestAmong(await this.reachable("suggest"), query, options);
  }

  /** The notes `op` may see: every note, or those in its folders. An operation the mask forbids is refused. */
  private async reachable(op: OperationName): Promise<Note[]> {
    this.mask.check(op);
    const { notes } = await this.load();
    return this.mask.scope(op).everywhere ? notes : notes.filter((note) => this.mask.reaches(op, note.path));
  }

  /** Resolve a reference among the notes `op` may see; a path outside them is refused by name, not reported missing. */
  private async resolve(op: OperationName, ref: string): Promise<Note> {
    const notes = await this.reachable(op);
    const wanted = ref.trim().replace(/^\.?\//, "");
    if (/[/\\]/.test(wanted) && !this.mask.reaches(op, wanted)) {
      throw new PermissionError(`this vault's mask does not allow ${op} on ${wanted}`);
    }
    const lower = wanted.toLowerCase();
    const byPath = notes.find((note) => note.path.toLowerCase() === lower || note.path.toLowerCase() === `${lower}.md`);
    if (byPath) return byPath;
    const matchers: ((note: Note) => boolean)[] = [
      (note) => posix.basename(note.path, ".md").toLowerCase() === lower,
      (note) => note.title.toLowerCase() === lower,
      (note) => note.aliases.some((alias) => alias.toLowerCase() === lower),
    ];
    for (const matches of matchers) {
      const found = notes.filter(matches);
      if (found.length === 1) return found[0] as Note;
      if (found.length > 1) {
        throw new NotFoundError(`"${ref}" matches ${found.length} notes: ${found.map((note) => note.path).join(", ")}`);
      }
    }
    // A typo can break one word's subsequence; then any word that still matches is enough to suggest.
    let closest = suggestAmong(notes, wanted, { limit: 3 });
    if (closest.length === 0) closest = suggestAmong(notes, wanted, { limit: 3, anyTerm: true });
    throw new NotFoundError(
      `no note matches "${ref}"`,
      closest.map((hit) => hit.path),
    );
  }

  /** A link's resolution as `op` may see it: a hidden note is not shown, and an ambiguous link names what is. */
  private visibleResolution(op: OperationName, resolution: Resolution): Resolution | undefined {
    if (resolution.status === "resolved") return this.mask.reaches(op, resolution.path) ? resolution : undefined;
    if (resolution.status === "ambiguous") {
      return { status: "ambiguous", candidates: resolution.candidates.filter((path) => this.mask.reaches(op, path)) };
    }
    return resolution;
  }

  private async load(): Promise<Scan> {
    if (this.cache && this.watch !== undefined && Date.now() - this.checked >= this.watch) {
      this.checked = Date.now();
      if ((await this.fingerprint()) !== this.cache.fingerprint) this.cache = undefined;
    }
    if (this.cache) return this.cache;
    if (!this.loading) {
      const generation = this.generation;
      this.loading = this.scan().then(
        (scan) => {
          if (generation === this.generation) [this.cache, this.loading] = [scan, undefined];
          return scan;
        },
        (error) => {
          if (generation === this.generation) this.loading = undefined;
          throw error;
        },
      );
    }
    return this.loading;
  }

  /** The scan's link graph: every note's links resolved once, then reused until the next rescan. */
  private async graph(): Promise<LinkGraph> {
    const scan = await this.load();
    if (!scan.graph) {
      const outgoing = new Map<string, OutgoingLink[]>();
      const incoming = new Map<string, Set<string>>();
      for (const note of scan.notes) {
        const links = linksOf(note).map((link) => ({
          ...link,
          resolution: scan.index.resolve(note.path, link.target),
        }));
        outgoing.set(note.path, links);
        for (const { resolution } of links) {
          if (resolution.status !== "resolved" || resolution.path === note.path) continue;
          const sources = incoming.get(resolution.path) ?? new Set<string>();
          incoming.set(resolution.path, sources.add(note.path));
        }
      }
      scan.graph = { outgoing, incoming };
    }
    return scan.graph;
  }

  private async scan(): Promise<Scan> {
    const paths = await this.paths();
    // TextDecoder drops a leading byte order mark, so frontmatter after one is still found.
    const decoder = new TextDecoder();
    const notes = await Promise.all(
      paths.map(async (path) => parseNote(path, decoder.decode(await readFile(join(this.root, path))))),
    );
    const fingerprint = this.watch === undefined ? "" : await this.fingerprint(paths);
    this.checked = Date.now();
    return {
      notes,
      search: new Map(notes.map((note) => [note.path, indexDocument(note)])),
      index: new LinkIndex(paths),
      fingerprint,
    };
  }

  private async paths(): Promise<string[]> {
    const ignored = gitignore(this.root);
    const paths = (await markdownFiles(this.root)).filter(
      (path) => !this.exclude.some((prefix) => path.startsWith(prefix)) && !ignored(path),
    );
    return paths.sort();
  }

  /** Every note's path, modification time, and size: a change to any of them means the files changed. */
  private async fingerprint(paths?: string[]): Promise<string> {
    const current = paths ?? (await this.paths());
    const stats = await Promise.all(current.map((path) => stat(join(this.root, path))));
    return current.map((path, i) => `${path}\0${stats[i]?.mtimeMs}\0${stats[i]?.size}`).join("\n");
  }
}

function parseNote(path: string, raw: string): Note {
  const { data, body } = splitFrontmatter(raw);
  const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value : undefined);
  const firstLine = body.split(/\r?\n/).find((line) => line.trim() !== "");
  const heading = firstLine && /^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(firstLine)?.[1]?.trim();
  return {
    path,
    title: text(data.title) ?? heading ?? posix.basename(path, ".md"),
    type: text(data.type),
    status: text(data.status),
    tags: noteTags(data.tags),
    aliases: stringList(data.aliases),
    frontmatter: data,
    body,
    raw,
  };
}

/** The requested lines of the file; a range may run past either end, but its anchor line must exist. */
function lineRange(note: Note, options: GetOptions) {
  if (!options.lines && !options.around) return undefined;
  if (options.lines && options.around) throw new LineRangeError("give lines or around, not both");
  const lines = note.raw.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const total = lines.length;
  let start: number;
  let end: number;
  if (options.around) {
    const { line, context = 5 } = options.around;
    if (!Number.isInteger(line) || line < 1 || line > total || !Number.isInteger(context) || context < 0) {
      throw new LineRangeError(`${note.path} has ${total} lines; cannot read around line ${line}`);
    }
    start = line - context;
    end = line + context;
  } else {
    start = options.lines?.start ?? 1;
    end = options.lines?.end ?? total;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > total || end < start) {
      throw new LineRangeError(`${note.path} has ${total} lines; cannot read lines ${start}:${end}`);
    }
  }
  start = Math.max(1, start);
  end = Math.min(total, end);
  return { start, end, total, text: lines.slice(start - 1, end).join("\n") };
}

/** A frontmatter value against a `where` condition; `null` asks only that the property be present. */
function propertyMatches(actual: unknown, wanted: string | null): boolean {
  if (actual === undefined) return false;
  if (wanted === null) return true;
  if (Array.isArray(actual)) return actual.some((item) => propertyMatches(item, wanted));
  return actual !== null && typeof actual !== "object" && String(actual) === wanted;
}

function withNewline(text: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}

/** Add `## heading` and its body at the end of the note, or refuse when `createHeading` is not set. */
function createSection(current: string, options: SectionWriteOptions, body: string): string {
  if (!options.createHeading) {
    throw new SectionError(`no section "${options.heading}"; pass createHeading to add it at the end`);
  }
  const heading = `${"#".repeat(options.level ?? 2)} ${options.heading}`;
  const gap = current.trim() === "" ? "" : "\n";
  return `${withNewline(current)}${gap}${heading}\n\n${body}\n`;
}

function filtered(notes: Note[], filter: Filter): Note[] {
  const prefix = filter.under ? folderPrefix(filter.under) : "";
  return notes.filter(
    (note) =>
      note.path.startsWith(prefix) &&
      (!filter.type || note.type === filter.type) &&
      (!filter.status || note.status === filter.status) &&
      [...(filter.tag ? [filter.tag] : []), ...(filter.tags ?? [])].every((tag) => tagMatches(note.tags, tag)) &&
      Object.entries(filter.where ?? {}).every(([key, value]) => propertyMatches(note.frontmatter[key], value)),
  );
}

function suggestAmong(
  notes: Note[],
  query: string,
  options: Filter & { limit?: number; anyTerm?: boolean },
): Suggestion[] {
  const candidates = filtered(notes, options).map((note) => ({
    item: note,
    texts: [note.path, note.title, ...note.aliases],
  }));
  const ranked = fuzzyRank(query, candidates, options.limit ?? 10, { anyTerm: options.anyTerm });
  return ranked.map(({ item, score, matched }) => ({ ...summarize(item), score, matched }));
}

function summarize(note: Note): NoteSummary {
  const { created, modified } = note.frontmatter;
  return {
    path: note.path,
    title: note.title,
    ...(note.type ? { type: note.type } : {}),
    ...(note.status ? { status: note.status } : {}),
    tags: note.tags,
    ...(created !== undefined ? { created: String(created) } : {}),
    ...(modified !== undefined ? { modified: String(modified) } : {}),
  };
}

/** A `.md` path inside the vault, normalized, or `WriteConflictError` naming the verb that was given it. */
function notePath(path: string, verb: string): string {
  const target = posix.normalize(path.replaceAll("\\", "/").trim()).replace(/^\.\//, "");
  if (target.startsWith("/") || target === ".." || target.startsWith("../") || !target.endsWith(".md")) {
    throw new WriteConflictError(`${verb} takes a .md path inside the vault, not "${path}"`);
  }
  return target;
}

function folderPrefix(folder: string): string {
  const trimmed = folder
    .trim()
    .replace(/^\.?\/+/, "")
    .replace(/\/+$/, "");
  return trimmed === "" ? "" : `${trimmed}/`;
}

/** The vault root's `.gitignore`, as ripgrep honors it; a vault without one ignores nothing. */
function gitignore(root: string): (path: string) => boolean {
  const file = join(root, ".gitignore");
  if (!existsSync(file)) return () => false;
  const rules = ignore().add(readFileSync(file, "utf8"));
  return (path) => rules.ignores(path);
}

function submodulePaths(root: string): string[] {
  const file = join(root, ".gitmodules");
  if (!existsSync(file)) return [];
  return [...readFileSync(file, "utf8").matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((match) => match[1] as string);
}

/**
 * Vault-relative POSIX paths of every `.md` file outside dot folders, unsorted; symbolic links are skipped. This walk
 * measured two to three times faster than Bun's own glob scanner, so listing needs no fallback chain.
 */
async function markdownFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(prefix ? join(root, prefix) : root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      if (entry.name.startsWith(".")) return [];
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return markdownFiles(root, path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    }),
  );
  return nested.flat();
}

/** A note's links as Obsidian counts them: wikilinks in its frontmatter values, then links in its body. */
function linksOf(note: Note): WikiLink[] {
  return [...frontmatterLinks(note.frontmatter), ...extractLinks(note.body)];
}
