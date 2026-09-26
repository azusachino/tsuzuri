/**
 * The prelude is the SDK's contract (ADR 0009). These lists fail on any change to it, so adding, renaming, or
 * removing an export is a decision someone makes on purpose, recorded in the changelog.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const RUNTIME = [
  "CaptureError",
  "ConfigError",
  "InputError",
  "LineRangeError",
  "TsuzuriError",
  "NotFoundError",
  "OPERATIONS",
  "OPERATION_KINDS",
  "PermissionError",
  "SORT_KEYS",
  "SectionError",
  "UnsupportedError",
  "Vault",
  "WriteConflictError",
  "captureInputFromMarkdown",
  "formatDate",
  "formatGrep",
  "propertyValue",
];

const TYPES = [
  "AllowRule",
  "CaptureInput",
  "CaptureOptions",
  "CaptureResult",
  "CaptureSettings",
  "Extension",
  "InputProperty",
  "OpenOptions",
  "OperationDefinition",
  "SkippedExtension",
  "Filter",
  "Frontmatter",
  "GetOptions",
  "GrepHit",
  "GrepLine",
  "GrepOptions",
  "Heading",
  "ListOptions",
  "DeleteResult",
  "MoveResult",
  "NavEntry",
  "NavView",
  "TsuzuriConfig",
  "Note",
  "NoteContent",
  "NoteSummary",
  "OperationKind",
  "OperationName",
  "OutgoingLink",
  "Resolution",
  "SearchHit",
  "SectionWriteOptions",
  "Suggestion",
  "TagCount",
  "TemplateSettings",
  "VaultOptions",
  "VaultSettings",
  "WriteOptions",
  "WriteResult",
];

test("exports exactly the prelude's runtime names", async () => {
  expect(Object.keys(await import("tsuzuri")).sort()).toEqual([...RUNTIME].sort());
});

test("exports exactly the prelude's types", () => {
  const entry = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const types = [...entry.matchAll(/export type \{([^}]*)\}/g)].flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  expect(types.sort()).toEqual([...TYPES].sort());
});

test("refuses a deep import past the prelude", async () => {
  expect(typeof (await import("tsuzuri")).Vault).toBe("function");
  // A variable, so the type checker leaves the refusal to the runtime this test is about.
  const deep = "tsuzuri/src/write.ts";
  await expect(import(deep)).rejects.toThrow();
});
