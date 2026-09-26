import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError } from "./errors.ts";
import { vaultPath } from "./operations.ts";
import { parseToml } from "./providers.ts";

export const CONFIG_FILE = "tsuzuri.toml";

export { UnsupportedError } from "./chain.ts";

export interface CaptureSettings {
  /** Folder for new notes, relative to the vault root; `""` is the root. */
  folder: string;
  /** A filename pattern using the same placeholders as a template. */
  filename: string;
  /** `lowercase` lowercases title words except `titleAllow` entries and spaces Latin text apart from CJK text. */
  titleStyle: "as-written" | "lowercase";
  titleAllow: string[];
  /** `kebab` canonicalizes tags to lowercase kebab-case; `as-written` keeps them, checking Obsidian's tag syntax. */
  tagStyle: "as-written" | "kebab";
  requireTags: boolean;
  rejectTags: string[];
}

/** Where note templates live and how their `{{date}}` and `{{time}}` placeholders are written. */
export interface TemplateSettings {
  folder: string;
  dateFormat: string;
  timeFormat: string;
  /** Which settings source supplied the folder. */
  source: string;
}

export interface VaultSettings {
  capture: CaptureSettings;
  types: Record<string, { folder: string; filename: string }>;
  /** Unset when no source names a template folder; `new` then raises `UnsupportedError`. */
  templates?: TemplateSettings;
  /** The extensions the settings list, as written: `tsuzuri:<name>` for a bundled one, else a vault-relative module. */
  extensions: string[];
  /** The tables the loaded extensions read, as written, with code options' tables over the file's. */
  tables: Record<string, Record<string, unknown>>;
  /** Provenance of each core setting, for `config`. */
  sources: Record<string, string>;
}

/** Which extension tables a `Vault` accepts: those its loaded extensions read, and any at all when one was skipped. */
export interface TableClaims {
  tables: ReadonlySet<string>;
  skipped: boolean;
}

/** The shape of `tsuzuri.toml`, also accepted in code. Every key is optional. */
export interface TsuzuriConfig {
  capture?: {
    folder?: string;
    filename?: string;
  };
  types?: Record<string, { folder?: string; filename?: string }>;
  tags?: { style?: "as-written" | "kebab"; require?: boolean; reject?: string[] };
  titles?: { case?: "as-written" | "lowercase"; keep?: string[] };
  templates?: { folder?: string; date_format?: string; time_format?: string };
  /** Extensions to load: `tsuzuri:<name>` for a bundled one, or a module path relative to the vault root. */
  extensions?: string[];
  /** An extension's own table, such as `[journal]`, accepted when that extension is loaded. */
  [table: string]: unknown;
}

const DEFAULT_CAPTURE: Omit<CaptureSettings, "folder"> = {
  filename: "{{title}}",
  titleStyle: "as-written",
  titleAllow: [],
  tagStyle: "as-written",
  requireTags: false,
  rejectTags: [],
};

function readToml(root: string, path: string): unknown {
  try {
    return parseToml.get()(readFileSync(join(root, path), "utf8"));
  } catch (error) {
    throw new ConfigError(`${path}: ${(error as Error).message.split("\n")[0]}`);
  }
}

/** A setting's allowed value: a type, or the strings an enum accepts. */
type Rule = "string" | "boolean" | "strings" | readonly string[];

const RULES: Record<string, Record<string, Rule>> = {
  capture: { folder: "string", filename: "string" },
  templates: { folder: "string", date_format: "string", time_format: "string" },
  tags: { style: ["as-written", "kebab"], require: "boolean", reject: "strings" },
  titles: { case: ["as-written", "lowercase"], keep: "strings" },
};

const RETIRED: Record<string, string> = {
  "capture.properties": "put those properties in templates/capture.md",
  "capture.values": "put those values in templates/capture.md",
  "capture.timestamp_format": "use {{date:FORMAT}} in templates/capture.md",
  "capture.title_style": "use [titles] case",
  "capture.title_allowlist": "use [titles] keep",
  "capture.tag_style": "use [tags] style",
  "capture.require_tags": "use [tags] require",
  "capture.reject_tags": "use [tags] reject",
};

const isTable = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function fits(value: unknown, rule: Rule): boolean {
  if (Array.isArray(rule)) return rule.includes(value as string);
  if (rule === "strings") return Array.isArray(value) && value.every((item) => typeof item === "string");
  return typeof value === rule;
}

function checkTable(value: unknown, rules: Record<string, Rule>, path: string, source: string): void {
  if (!isTable(value)) throw new ConfigError(`${source}: ${path} must be a table`);
  for (const [key, setting] of Object.entries(value)) {
    const rule = rules[key];
    if (!rule) {
      if (RETIRED[`${path}.${key}`])
        throw new ConfigError(`${source}: ${path}.${key} was removed; ${RETIRED[`${path}.${key}`]}`);
      throw new ConfigError(`${source}: unknown key ${path}.${key}; ${path} takes ${Object.keys(rules).join(", ")}`);
    }
    if (!fits(setting, rule)) {
      const wanted = Array.isArray(rule)
        ? `one of ${rule.join(", ")}`
        : `a ${rule === "strings" ? "list of strings" : rule}`;
      throw new ConfigError(`${source}: ${path}.${key} must be ${wanted}`);
    }
    if (key === "folder" && typeof setting === "string" && vaultPath(setting) === undefined) {
      throw new ConfigError(`${source}: ${path}.folder must stay inside the vault`);
    }
    if (key === "filename" && typeof setting === "string" && setting.trim() === "") {
      throw new ConfigError(`${source}: ${path}.filename must not be empty`);
    }
  }
}

/** Check settings against the shape of `tsuzuri.toml`, so a misspelled key or value fails instead of being ignored. */
function checkConfig(config: unknown, source: string, claims: TableClaims): TsuzuriConfig {
  if (!isTable(config)) throw new ConfigError(`${source}: settings must be a table`);
  for (const [section, value] of Object.entries(config)) {
    if (section === "extensions") {
      if (!fits(value, "strings")) throw new ConfigError(`${source}: extensions must be a list of strings`);
      continue;
    }
    if (section === "types") {
      if (!isTable(value)) throw new ConfigError(`${source}: types must be a table`);
      for (const [type, route] of Object.entries(value))
        checkTable(route, RULES.capture as Record<string, Rule>, `types.${type}`, source);
      continue;
    }
    const rules = RULES[section];
    if (rules) {
      checkTable(value, rules, section, source);
      continue;
    }
    if (claims.tables.has(section)) {
      if (!isTable(value)) throw new ConfigError(`${source}: ${section} must be a table`);
      continue;
    }
    // A table may belong to an extension that was listed but not loaded; that extension checks it once it loads.
    if (claims.skipped) continue;
    if (section === "journal") {
      throw new ConfigError(
        `${source}: [journal] needs the journal extension: add extensions = ["tsuzuri:journal"] (ADR 0020)`,
      );
    }
    throw new ConfigError(
      `${source}: unknown key ${section}; settings take capture, types, tags, titles, templates, extensions`,
    );
  }
  return config as TsuzuriConfig;
}

/** The extensions `tsuzuri.toml` and code options list, the file's first, before any are loaded. */
export function listedExtensions(root: string, code: TsuzuriConfig = {}): string[] {
  const file = existsSync(join(root, CONFIG_FILE)) ? readToml(root, CONFIG_FILE) : {};
  const listed = [...((file as TsuzuriConfig).extensions ?? []), ...(code.extensions ?? [])];
  if (!fits(listed, "strings")) throw new ConfigError(`${CONFIG_FILE}: extensions must be a list of strings`);
  return [...new Set(listed)];
}

/**
 * Resolve settings by precedence: options passed in code, then `tsuzuri.toml`, then neutral defaults (ADR 0011).
 * An extension's table is accepted only when a loaded extension reads it (ADR 0019).
 */
export function resolveSettings(
  root: string,
  code: TsuzuriConfig = {},
  claims: TableClaims = { tables: new Set(), skipped: false },
): VaultSettings {
  const file = existsSync(join(root, CONFIG_FILE)) ? checkConfig(readToml(root, CONFIG_FILE), CONFIG_FILE, claims) : {};
  checkConfig(code, "options", claims);
  const tables: Record<string, Record<string, unknown>> = {};
  for (const table of claims.tables) {
    const value = code[table] ?? file[table];
    if (isTable(value)) tables[table] = value;
  }
  const capture = { ...file.capture, ...code.capture };
  const tags = { ...file.tags, ...code.tags };
  const titles = { ...file.titles, ...code.titles };
  const template = templates(root, file, code);
  const types = new Map<string, { folder?: string; filename?: string }>();
  for (const [name, route] of Object.entries(file.types ?? {})) types.set(name.toLowerCase(), route);
  for (const [name, route] of Object.entries(code.types ?? {})) {
    types.set(name.toLowerCase(), { ...types.get(name.toLowerCase()), ...route });
  }
  const source = (key: string, codeValue: unknown, fileValue: unknown) =>
    [key, codeValue !== undefined ? "options" : fileValue !== undefined ? CONFIG_FILE : "default"] as const;
  const routeIn = (routes: TsuzuriConfig["types"], name: string) =>
    Object.entries(routes ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
  const sources: Record<string, string> = Object.fromEntries([
    source("capture.folder", code.capture?.folder, file.capture?.folder),
    source("capture.filename", code.capture?.filename, file.capture?.filename),
    source("tags.style", code.tags?.style, file.tags?.style),
    source("tags.require", code.tags?.require, file.tags?.require),
    source("tags.reject", code.tags?.reject, file.tags?.reject),
    source("titles.case", code.titles?.case, file.titles?.case),
    source("titles.keep", code.titles?.keep, file.titles?.keep),
    source("templates.folder", code.templates?.folder, file.templates?.folder),
    source("templates.date_format", code.templates?.date_format, file.templates?.date_format),
    source("templates.time_format", code.templates?.time_format, file.templates?.time_format),
    source("extensions", code.extensions, file.extensions),
    ...[...claims.tables].map((name) => source(name, code[name], file[name])),
    ...[...types.keys()].flatMap((name) => [
      source(`types.${name}.folder`, routeIn(code.types, name)?.folder, routeIn(file.types, name)?.folder),
      source(`types.${name}.filename`, routeIn(code.types, name)?.filename, routeIn(file.types, name)?.filename),
    ]),
  ]);
  for (const [name, route] of types) {
    if (route.folder === undefined) sources[`types.${name}.folder`] = sources["capture.folder"] ?? "default";
    if (route.filename === undefined) sources[`types.${name}.filename`] = sources["capture.filename"] ?? "default";
  }
  if (code.extensions !== undefined && file.extensions !== undefined) {
    sources.extensions = `${CONFIG_FILE} + options`;
  }

  return {
    capture: {
      folder: capture.folder ?? "",
      filename: capture.filename ?? DEFAULT_CAPTURE.filename,
      titleStyle: titles.case ?? DEFAULT_CAPTURE.titleStyle,
      titleAllow: titles.keep ?? DEFAULT_CAPTURE.titleAllow,
      tagStyle: tags.style ?? DEFAULT_CAPTURE.tagStyle,
      requireTags: tags.require ?? DEFAULT_CAPTURE.requireTags,
      rejectTags: tags.reject ?? DEFAULT_CAPTURE.rejectTags,
    },
    types: Object.fromEntries(
      [...types].map(([name, route]) => [
        name,
        {
          folder: route.folder ?? capture.folder ?? "",
          filename: route.filename ?? capture.filename ?? DEFAULT_CAPTURE.filename,
        },
      ]),
    ),
    ...(template ? { templates: template } : {}),
    extensions: listedExtensions(root, code),
    tables,
    sources,
  };
}

/** `[templates]` in code options or `tsuzuri.toml`; no folder is assumed. */
function templates(root: string, file: TsuzuriConfig, code: TsuzuriConfig): TemplateSettings | undefined {
  const folder =
    code.templates?.folder ??
    file.templates?.folder ??
    (readdirSync(root).includes("templates") ? "templates" : undefined);
  if (folder === undefined || folder.trim() === "") return undefined;
  return {
    folder: folder.replace(/^\/+|\/+$/g, ""),
    // Obsidian's own defaults for a template's {{date}} and {{time}}.
    dateFormat: code.templates?.date_format ?? file.templates?.date_format ?? "YYYY-MM-DD",
    timeFormat: code.templates?.time_format ?? file.templates?.time_format ?? "HH:mm",
    source: code.templates?.folder ? "options" : file.templates?.folder ? CONFIG_FILE : "default",
  };
}
