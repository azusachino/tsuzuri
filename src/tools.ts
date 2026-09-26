/**
 * Ready-made agent tools over a `Vault`: a name, the operation it runs, a JSON Schema for the input, MCP-style hints, and a
 * `run` bound to the SDK. A consumer registers `agentTools()` with its model and routes calls to `run`.
 */
import { InputError, type OperationName, propertyValue, SORT_KEYS, type Vault } from "./index.ts";

export interface PropertySchema {
  type: "string" | "integer" | "boolean" | "array" | "object";
  description: string;
  enum?: readonly string[];
  items?: { type: "string" };
  minimum?: number;
  /** For an object: the JSON types its values may take. */
  additionalProperties?: { type: readonly ("string" | "null")[] };
}

export interface InputSchema {
  type: "object";
  properties: Record<string, PropertySchema>;
  required: string[];
  additionalProperties: false;
}

export interface ToolDefinition {
  /** `tsuzuri_` and a snake_case verb, valid for every major tool-calling API. */
  name: string;
  /** The vault operation the tool runs, so a mask's kinds and names apply to it. */
  operation: OperationName | (string & {});
  description: string;
  inputSchema: InputSchema;
  /** The Model Context Protocol's tool annotations. */
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
  run(vault: Vault, input: Record<string, unknown>): Promise<unknown>;
}

export class ToolInputError extends InputError {}

const str = (description: string): PropertySchema => ({ type: "string", description });
const int = (description: string): PropertySchema => ({ type: "integer", description, minimum: 1 });
const OFFSET: PropertySchema = { type: "integer", description: "Skip this many results in order", minimum: 0 };
const bool = (description: string): PropertySchema => ({ type: "boolean", description });
const list = (description: string): PropertySchema => ({ type: "array", description, items: { type: "string" } });

function schema(properties: Record<string, PropertySchema>, required: string[] = []): InputSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

const NOTE = str("A note: its vault path, file name, title, or alias");
const FILTERS = {
  type: str("Only notes whose type property is this"),
  tags: list("Only notes carrying every one of these tags; a parent tag matches its nested tags"),
  status: str("Only notes whose status property is this"),
  under: str("Only notes in this folder, such as note/tech"),
};
const GUARDS = {
  dryRun: bool("Return the unified diff without writing"),
  ifHash: str("Write only if the note still has this hash, as get returned it"),
};
/** The longest pattern `tsuzuri_grep` takes from a model. */
const GREP_PATTERN_LIMIT = 200;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };

/** Check `input` against a tool's schema, so a model's mistake comes back as a clear error, not a crash. */
export function validateInput(tool: ToolDefinition, input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ToolInputError(`${tool.name} takes an object`);
  }
  const record = input as Record<string, unknown>;
  const { properties, required } = tool.inputSchema;
  for (const key of required) {
    if (record[key] === undefined) throw new ToolInputError(`${tool.name} needs ${key}`);
  }
  for (const [key, value] of Object.entries(record)) {
    const property = properties[key];
    if (!property) throw new ToolInputError(`${tool.name} has no input ${key}`);
    if (value === undefined) continue;
    const ok =
      property.type === "array"
        ? Array.isArray(value) && value.every((item) => typeof item === "string")
        : property.type === "integer"
          ? Number.isInteger(value) && (value as number) >= (property.minimum ?? Number.NEGATIVE_INFINITY)
          : property.type === "object"
            ? typeof value === "object" && value !== null && !Array.isArray(value)
            : typeof value === property.type;
    if (!ok) throw new ToolInputError(`${tool.name}: ${key} must be ${property.type}`);
    const values = property.additionalProperties?.type;
    if (
      values &&
      !Object.values(value as object).every((item) =>
        values.includes(item === null ? "null" : (typeof item as "string")),
      )
    ) {
      throw new ToolInputError(`${tool.name}: ${key} values must be ${values.join(" or ")}`);
    }
    if (property.enum && !property.enum.includes(value as string)) {
      throw new ToolInputError(`${tool.name}: ${key} must be one of ${property.enum.join(", ")}`);
    }
  }
  return record;
}

const s = (input: Record<string, unknown>, key: string) => input[key] as string;
const o = <T>(input: Record<string, unknown>, key: string) => input[key] as T | undefined;
const filterOf = (input: Record<string, unknown>) => ({
  type: o<string>(input, "type"),
  tags: o<string[]>(input, "tags"),
  status: o<string>(input, "status"),
  under: o<string>(input, "under"),
});

/** A write's guards, from the model's input. */
function writeOf(input: Record<string, unknown>) {
  return { dryRun: o<boolean>(input, "dryRun"), ifHash: o<string>(input, "ifHash") };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "tsuzuri_types",
    operation: "types",
    description: "List template-backed note types, with each template and effective folder and filename route.",
    inputSchema: schema({}),
    annotations: READ,
    run: (vault) => vault.types(),
  },
  {
    name: "tsuzuri_check",
    operation: "check",
    description: "Check a note for missing template frontmatter keys and failed title or tag rules.",
    inputSchema: schema({ note: NOTE }, ["note"]),
    annotations: READ,
    run: (vault, input) => vault.check(s(input, "note")),
  },
  {
    name: "tsuzuri_get",
    operation: "get",
    description: "Read one note: its summary, frontmatter, body, and hash. lines or around read part of it by line.",
    inputSchema: schema(
      {
        note: NOTE,
        lines: str("An inclusive line range such as 20:60, 20:, or :60, counted from the top of the file"),
        around: int("A line to read around, as rg -n or tsuzuri_grep numbers it"),
        context: { type: "integer", description: "Lines either side of around; 5 by default", minimum: 0 },
        maxChars: int("Truncate the returned body to this many characters"),
      },
      ["note"],
    ),
    annotations: READ,
    run: async (vault, input) => {
      const lines = o<string>(input, "lines");
      if (lines !== undefined && !/^(?:\d+:\d*|:\d+|\d+)$/.test(lines)) {
        throw new ToolInputError(`tsuzuri_get: lines must be a:b, a:, :b, or a line, not "${lines}"`);
      }
      const span = lines?.split(":");
      const around = o<number>(input, "around");
      return vault.get(s(input, "note"), {
        maxChars: o<number>(input, "maxChars"),
        lines: span ? { start: Number(span[0]) || undefined, end: Number(span[1] ?? span[0]) || undefined } : undefined,
        around: around === undefined ? undefined : { line: around, context: o<number>(input, "context") },
      });
    },
  },
  {
    name: "tsuzuri_search",
    operation: "search",
    description: "Rank notes by relevance to words (BM25; CJK matches as substrings). Returns summaries with snippets.",
    inputSchema: schema(
      { query: str("Words to look for"), limit: int("Most results; 10 by default"), offset: OFFSET, ...FILTERS },
      ["query"],
    ),
    annotations: READ,
    run: (vault, input) =>
      vault.search(s(input, "query"), {
        ...filterOf(input),
        limit: o<number>(input, "limit"),
        offset: o<number>(input, "offset"),
      }),
  },
  {
    name: "tsuzuri_grep",
    operation: "grep",
    description:
      "Lines containing text, as path, line, and text; smart case. Literal unless regex is set. Read around a hit next.",
    inputSchema: schema(
      {
        pattern: str(`Text to find, at most ${GREP_PATTERN_LIMIT} characters; a regular expression with regex`),
        regex: bool("Read the pattern as a JavaScript regular expression instead of literal text"),
        context: { type: "integer", description: "Lines of context either side", minimum: 0 },
        offset: OFFSET,
        ...FILTERS,
      },
      ["pattern"],
    ),
    annotations: READ,
    run: async (vault, input) => {
      const pattern = s(input, "pattern");
      // A model's regular expression runs in the host's process; literal text by default and a length cap keep a
      // backtracking pattern from stalling it.
      if (pattern.length > GREP_PATTERN_LIMIT) {
        throw new ToolInputError(`tsuzuri_grep: pattern is longer than ${GREP_PATTERN_LIMIT} characters`);
      }
      try {
        return await vault.grep(pattern, {
          ...filterOf(input),
          fixed: o<boolean>(input, "regex") !== true,
          context: o<number>(input, "context"),
          offset: o<number>(input, "offset"),
        });
      } catch (error) {
        if (error instanceof SyntaxError) throw new ToolInputError(`tsuzuri_grep: ${error.message}`);
        throw error;
      }
    },
  },
  {
    name: "tsuzuri_find",
    operation: "suggest",
    description: "Fuzzy-match notes by path, title, or alias, for a loose reference such as a half-remembered name.",
    inputSchema: schema(
      { query: str("A loose name, abbreviation, or typo"), limit: int("Most results"), offset: OFFSET },
      ["query"],
    ),
    annotations: READ,
    run: (vault, input) =>
      vault.suggest(s(input, "query"), { limit: o<number>(input, "limit"), offset: o<number>(input, "offset") }),
  },
  {
    name: "tsuzuri_list",
    operation: "list",
    description: "List note summaries, filtered on any frontmatter property and sorted, such as the latest books.",
    inputSchema: schema({
      ...FILTERS,
      where: {
        type: "object",
        description: "Frontmatter key to required text value; null asks only for presence",
        additionalProperties: { type: ["string", "null"] },
      },
      sort: { type: "string", description: "Sort key", enum: SORT_KEYS },
      desc: bool("Sort descending"),
      limit: int("Most results"),
      offset: OFFSET,
    }),
    annotations: READ,
    run: (vault, input) =>
      vault.list({
        ...filterOf(input),
        where: o<Record<string, string | null>>(input, "where"),
        sort: o<(typeof SORT_KEYS)[number]>(input, "sort"),
        desc: o<boolean>(input, "desc"),
        limit: o<number>(input, "limit"),
        offset: o<number>(input, "offset"),
      }),
  },
  {
    name: "tsuzuri_nav",
    operation: "nav",
    description: "A folder's index note and headings, subfolders, and notes: how the vault is laid out.",
    inputSchema: schema({ folder: str("A folder; the vault root by default") }),
    annotations: READ,
    run: (vault, input) => vault.nav(o<string>(input, "folder")),
  },
  {
    name: "tsuzuri_links",
    operation: "links",
    description:
      "A note's outgoing links (wikilinks, Markdown links, and frontmatter links) and what each resolves to.",
    inputSchema: schema({ note: NOTE }, ["note"]),
    annotations: READ,
    run: (vault, input) => vault.links(s(input, "note")),
  },
  {
    name: "tsuzuri_backlinks",
    operation: "backlinks",
    description: "Notes that link to a note.",
    inputSchema: schema({ note: NOTE }, ["note"]),
    annotations: READ,
    run: (vault, input) => vault.backlinks(s(input, "note")),
  },
  {
    name: "tsuzuri_tags",
    operation: "tags",
    description: "Every tag with its note count. Reuse one of these instead of inventing a near-duplicate.",
    inputSchema: schema({ ...FILTERS }),
    annotations: READ,
    run: (vault, input) => vault.tags(filterOf(input)),
  },
  {
    name: "tsuzuri_outline",
    operation: "outline",
    description: "A note's headings with their levels and line numbers.",
    inputSchema: schema({ note: NOTE }, ["note"]),
    annotations: READ,
    run: (vault, input) => vault.outline(s(input, "note")),
  },
  {
    name: "tsuzuri_prop_get",
    operation: "property",
    description: "One frontmatter value of a note.",
    inputSchema: schema({ note: NOTE, key: str("The property") }, ["note", "key"]),
    annotations: READ,
    run: (vault, input) => vault.property(s(input, "note"), s(input, "key")),
  },
  {
    name: "tsuzuri_capture",
    operation: "capture",
    description: "Create one new note in the vault's inbox or capture folder. Never edits an existing note.",
    inputSchema: schema(
      {
        text: str("The note body"),
        title: str("A title; the first line of text by default"),
        tags: list("Tags, preferably ones tsuzuri_tags lists"),
        source: str("Where the note came from, such as a URL"),
        dryRun: GUARDS.dryRun,
      },
      ["text"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    run: (vault, input) =>
      vault.capture(
        { text: s(input, "text"), title: o(input, "title"), tags: o(input, "tags"), source: o(input, "source") },
        { dryRun: o(input, "dryRun") },
      ),
  },
  {
    name: "tsuzuri_append",
    operation: "append",
    description: "Add text to the end of a note, or to the end of one section. Changes nothing else.",
    inputSchema: schema(
      {
        note: NOTE,
        text: str("Text to add"),
        heading: str("The section to add under"),
        createHeading: bool("Add the heading at the end of the note when it is missing"),
        ...GUARDS,
      },
      ["note", "text"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    run: (vault, input) =>
      vault.append(s(input, "note"), s(input, "text"), {
        ...writeOf(input),
        heading: o(input, "heading"),
        createHeading: o(input, "createHeading"),
      }),
  },
  {
    name: "tsuzuri_section_put",
    operation: "putSection",
    description: "Replace one section's body, or add the section. Every other section stays byte-identical.",
    inputSchema: schema({ note: NOTE, heading: str("The section"), text: str("The new body"), ...GUARDS }, [
      "note",
      "heading",
      "text",
    ]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    run: (vault, input) => vault.putSection(s(input, "note"), s(input, "heading"), s(input, "text"), writeOf(input)),
  },
  {
    name: "tsuzuri_prop_set",
    operation: "setProperty",
    description: "Set one frontmatter property, keeping comments, key order, and every other line.",
    inputSchema: schema(
      {
        note: NOTE,
        key: str("The property"),
        value: str("The value, read as YAML: 4 is a number, [a, b] a list"),
        ...GUARDS,
      },
      ["note", "key", "value"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    run: (vault, input) =>
      vault.setProperty(s(input, "note"), s(input, "key"), propertyValue(s(input, "value")), writeOf(input)),
  },
  {
    name: "tsuzuri_new",
    operation: "create",
    description: "Create a note from the vault's template for a type, placed as a capture is.",
    inputSchema: schema(
      {
        type: str("The template type, such as book"),
        title: str("The new note's title"),
        tags: list("Extra tags"),
        dryRun: GUARDS.dryRun,
      },
      ["type", "title"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    run: (vault, input) =>
      vault.create(s(input, "type"), s(input, "title"), {
        tags: o(input, "tags"),
        dryRun: o(input, "dryRun"),
      }),
  },
  {
    name: "tsuzuri_put",
    operation: "put",
    description: "Replace a whole existing note. Pass the hash get returned as ifHash to refuse a note changed since.",
    inputSchema: schema({ note: NOTE, content: str("The whole new note"), ...GUARDS }, ["note", "content"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    run: (vault, input) => vault.put(s(input, "note"), s(input, "content"), writeOf(input)),
  },
  {
    name: "tsuzuri_write",
    operation: "write",
    description: "Create a note at a vault path ending in .md, with this content. An existing file is refused.",
    inputSchema: schema(
      { path: str("A vault path ending in .md"), content: str("The whole note"), dryRun: GUARDS.dryRun },
      ["path", "content"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    run: (vault, input) => vault.write(s(input, "path"), s(input, "content"), { dryRun: o(input, "dryRun") }),
  },
  {
    name: "tsuzuri_move",
    operation: "move",
    description:
      "Move or rename a note to a vault path ending in .md, rewriting every link the move would break. Run with dryRun first: it returns every note it rewrites.",
    inputSchema: schema({ note: NOTE, to: str("The new vault path, ending in .md"), ...GUARDS }, ["note", "to"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    run: (vault, input) => vault.move(s(input, "note"), s(input, "to"), writeOf(input)),
  },
  {
    name: "tsuzuri_delete",
    operation: "delete",
    description:
      "Delete a note by moving it into the vault's .trash folder, where it can be restored. Links to it become unresolved; check backlinks first.",
    inputSchema: schema({ note: NOTE, ...GUARDS }, ["note"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    run: (vault, input) => vault.delete(s(input, "note"), writeOf(input)),
  },
];

/** The tool for an extension's operation: `tsuzuri_` and its name in snake_case, run through `vault.run`. */
function extensionTool(vault: Vault, name: string): ToolDefinition {
  const definition = vault.definition(name);
  if (!definition) throw new ToolInputError(`no extension operation ${name}`);
  const entries = Object.entries(definition.input);
  const properties = Object.fromEntries(
    entries.map(([key, { required: _, ...property }]) => [
      key,
      property.type === "array" ? { ...property, items: { type: "string" as const } } : property,
    ]),
  );
  const required = entries.filter(([, property]) => property.required).map(([key]) => key);
  const { kind } = definition;
  return {
    name: `tsuzuri_${name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`,
    operation: name,
    description: definition.summary,
    inputSchema: schema(properties, required),
    annotations: {
      readOnlyHint: kind === "read",
      destructiveHint: kind === "move" || kind === "delete",
      idempotentHint: kind === "read",
    },
    run: (target, input) => target.run(name, input),
  };
}

/**
 * The tools to offer an agent for `vault`: each whose operation the vault's mask allows (ADR 0018), the core's and
 * then those of the extensions it loaded (ADR 0019). tsuzuri decides no more than that; which of them to confirm with
 * a human is the host's choice, and the hints say what each does. Without a vault, every core tool.
 */
export function agentTools(vault?: Vault): ToolDefinition[] {
  if (!vault) return [...TOOLS];
  const extensions = vault
    .operations()
    .filter((operation) => operation.extension !== undefined && vault.allows(operation.name))
    .map((operation) => extensionTool(vault, operation.name));
  return [...TOOLS.filter((tool) => vault.allows(tool.operation)), ...extensions];
}
