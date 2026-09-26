/**
 * Every vault operation, named with its kind, and the mask a host sets over them (ADR 0018). tsuzuri ships no policy:
 * a `Vault` opened without `allow` permits everything.
 */
import { posix } from "node:path";
import { ConfigError, TsuzuriError } from "./errors.ts";
import type { Vault } from "./vault.ts";

export type OperationKind = "read" | "create" | "edit" | "move" | "delete";

export const OPERATION_KINDS: readonly OperationKind[] = ["read", "create", "edit", "move", "delete"];

/** Each `Vault` method that touches the vault's files, by name, with its kind. */
export const OPERATIONS = {
  notes: "read",
  get: "read",
  find: "read",
  suggest: "read",
  list: "read",
  search: "read",
  grep: "read",
  tags: "read",
  links: "read",
  backlinks: "read",
  orphans: "read",
  unresolved: "read",
  outline: "read",
  property: "read",
  nav: "read",
  select: "read",
  types: "read",
  check: "read",
  config: "read",
  init: "create",
  capture: "create",
  write: "create",
  move: "move",
  delete: "delete",
  create: "create",
  append: "edit",
  putSection: "edit",
  setProperty: "edit",
  put: "edit",
} as const satisfies Record<string, OperationKind>;

export type OperationName = keyof typeof OPERATIONS;

/** One input of an operation an extension defines, in the JSON Schema terms an agent tool takes. */
export interface InputProperty {
  type: "string" | "integer" | "boolean" | "array";
  description: string;
  enum?: readonly string[];
  /** Required inputs are the command's arguments, in order; the others are its options, `--kebab-case`. */
  required?: boolean;
}

/**
 * An operation an extension adds (ADR 0019): it becomes a CLI command, an agent tool, and an entry the mask covers
 * by its name and kind. `run` works through the `Vault` it is given, whose mask applies to every call it makes.
 */
export interface OperationDefinition {
  /** A camelCase name, unique among the core operations and every extension's. */
  name: string;
  kind: OperationKind;
  /** The command's words, such as `journal append`. */
  command: string;
  summary: string;
  input: Record<string, InputProperty>;
  run(vault: Vault, input: Record<string, unknown>, context: { settings: unknown }): Promise<unknown>;
  /** The command's text output; JSON when unset. */
  format?(result: unknown): string;
}

export interface Extension {
  name: string;
  /** The `tsuzuri.toml` table the extension reads, such as `journal`; `settings` checks and parses it. */
  table?: string;
  /** Parse the table, raising `ConfigError` for a key or value the extension does not take. */
  settings?(table: Record<string, unknown> | undefined, source: string): unknown;
  operations: OperationDefinition[];
}

/**
 * One rule of a mask: a kind or an operation name, or several with `under`, the folders they are limited to.
 * `"read"`, `"capture"`, and `{ ops: ["edit"], under: ["Inbox"] }` are rules. Extension operations accept only
 * unscoped rules; their inner Vault calls may be scoped.
 */
export type AllowRule = OperationKind | OperationName | (string & {}) | { ops: string[]; under?: string[] };

/** Raised when a `Vault`'s mask does not allow an operation, or a path it would touch. Nothing is touched first. */
export class PermissionError extends TsuzuriError {}

/** Where an operation may reach: everywhere, or only inside these folder prefixes (lowercase, ending in `/`). */
export type Scope = { everywhere: true } | { everywhere: false; folders: string[] };

/**
 * A vault-relative path, normalized, lowercase for comparison, or `undefined` when it leaves the vault. Compared
 * without case, so `inbox/` cannot slip past a rule for `Inbox/` on a case-insensitive disk.
 */
export function vaultPath(path: string): string | undefined {
  const normalized = posix.normalize(path.replaceAll("\\", "/").trim()).replace(/^\.\//, "");
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized.toLowerCase();
}

function folder(under: string, rule: number): string {
  const path = vaultPath(under);
  if (path === undefined) throw new ConfigError(`allow rule ${rule}: under "${under}" leaves the vault`);
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" || trimmed === "." ? "" : `${trimmed}/`;
}

export class Mask {
  private readonly kinds: Map<string, OperationKind>;
  private readonly scopes = new Map<string, Scope>();

  /** Over the core operations and any `extra` an extension adds; without rules, everything is allowed everywhere. */
  constructor(rules?: AllowRule[], extra: { name: string; kind: OperationKind }[] = []) {
    const extensionNames = new Set(extra.map(({ name }) => name));
    this.kinds = new Map<string, OperationKind>([
      ...(Object.entries(OPERATIONS) as [string, OperationKind][]),
      ...extra.map(({ name, kind }) => [name, kind] as [string, OperationKind]),
    ]);
    for (const name of this.kinds.keys()) {
      this.scopes.set(name, rules ? { everywhere: false, folders: [] } : { everywhere: true });
    }
    rules?.forEach((rule, i) => {
      const { ops, under } = typeof rule === "string" ? { ops: [rule], under: undefined } : rule;
      const folders = under?.map((path) => folder(path, i));
      for (const op of ops) {
        const named = [...this.kinds].filter(([name, kind]) => name === op || kind === op).map(([name]) => name);
        if (named.length === 0) {
          throw new ConfigError(
            `allow rule ${i}: "${op}" is neither a kind (${OPERATION_KINDS.join(", ")}) nor an operation`,
          );
        }
        const extension = folders && named.find((name) => extensionNames.has(name));
        if (extension) {
          throw new ConfigError(
            `allow rule ${i}: extension operation ${extension} cannot have under; scope the Vault methods it calls`,
          );
        }
        for (const name of named) this.widen(name, folders);
      }
    });
  }

  private widen(name: string, folders: string[] | undefined): void {
    const scope = this.scopes.get(name) as Scope;
    if (scope.everywhere) return;
    // A folder of "" is the vault root, which is everywhere.
    if (!folders || folders.includes("")) this.scopes.set(name, { everywhere: true });
    else scope.folders.push(...folders);
  }

  scope(op: string): Scope {
    return this.scopes.get(op) ?? { everywhere: false, folders: [] };
  }

  /** Whether `op` may run at all, anywhere. */
  allows(op: string): boolean {
    const scope = this.scope(op);
    return scope.everywhere || scope.folders.length > 0;
  }

  /** Whether some operation of `kind` may reach this path, as a move's link rewrites need for `edit`. */
  kindReaches(kind: OperationKind, path: string): boolean {
    return [...this.kinds].some(([op, opKind]) => opKind === kind && this.reaches(op, path));
  }

  /** Whether `op` may reach this vault-relative path. */
  reaches(op: string, path: string): boolean {
    const scope = this.scope(op);
    if (scope.everywhere) return true;
    const normalized = vaultPath(path);
    return normalized !== undefined && scope.folders.some((prefix) => normalized.startsWith(prefix));
  }

  /** Refuse `op` unless it may run, and reach every path given, before anything is touched. */
  check(op: string, paths: string[] = []): void {
    if (!this.allows(op)) throw new PermissionError(`this vault's mask does not allow ${op}`);
    const outside = paths.find((path) => !this.reaches(op, path));
    if (outside !== undefined) throw new PermissionError(`this vault's mask does not allow ${op} on ${outside}`);
  }
}
