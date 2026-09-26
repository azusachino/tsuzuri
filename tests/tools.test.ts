import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OPERATIONS, TsuzuriError, Vault } from "tsuzuri";
import { agentTools, TOOLS, ToolInputError, validateInput } from "tsuzuri/tools";
import { describe, expect, test } from "vitest";
import { copyVault, FIXTURE } from "./git.ts";

const tool = (name: string) => {
  const found = TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};
const call = (vault: Vault, name: string, input: Record<string, unknown>) =>
  tool(name).run(vault, validateInput(tool(name), input));

describe("tool definitions", () => {
  test("have unique names every tool-calling API accepts, and descriptions", () => {
    const names = TOOLS.map((definition) => definition.name);
    expect(new Set(names).size).toBe(names.length);
    for (const definition of TOOLS) {
      expect(definition.name).toMatch(/^tsuzuri_[a-z_]{1,58}$/);
      expect(definition.description.length).toBeGreaterThan(20);
    }
  });

  test("have valid JSON Schemas: closed objects whose required inputs are declared and described", () => {
    const types = new Set(["string", "integer", "boolean", "array", "object"]);
    for (const { name, inputSchema } of TOOLS) {
      expect(inputSchema.type).toBe("object");
      expect(inputSchema.additionalProperties).toBe(false);
      for (const key of inputSchema.required) expect(Object.keys(inputSchema.properties)).toContain(key);
      for (const [key, property] of Object.entries(inputSchema.properties)) {
        expect(types.has(property.type), `${name}.${key}`).toBe(true);
        expect(property.description.length, `${name}.${key}`).toBeGreaterThan(3);
        if (property.type === "array") expect(property.items).toEqual({ type: "string" });
        if (property.enum) expect(property.enum.length).toBeGreaterThan(0);
      }
      // Round-trips as JSON, as it must to reach any model API.
      expect(JSON.parse(JSON.stringify(inputSchema))).toEqual(inputSchema);
    }
  });

  test("hint consistently: a tool is read-only exactly when its operation reads, and reads are never destructive", () => {
    for (const { name, annotations, operation } of TOOLS) {
      expect(annotations.readOnlyHint, name).toBe(OPERATIONS[operation as keyof typeof OPERATIONS] === "read");
      if (annotations.readOnlyHint) expect(annotations.destructiveHint, name).toBe(false);
    }
  });

  test("are offered as the vault's mask allows, and all of them without a vault", () => {
    const names = (tools: { name: string }[]) => tools.map((tool) => tool.name);
    expect(names(agentTools())).toEqual(names(TOOLS));
    expect(names(agentTools(new Vault(FIXTURE)))).toEqual(names(TOOLS));
    const bot = names(agentTools(new Vault(FIXTURE, { allow: ["read", "capture"] })));
    expect(bot).toContain("tsuzuri_get");
    expect(bot).toContain("tsuzuri_capture");
    for (const writer of [
      "tsuzuri_append",
      "tsuzuri_put",
      "tsuzuri_write",
      "tsuzuri_move",
      "tsuzuri_delete",
      "tsuzuri_new",
    ]) {
      expect(bot).not.toContain(writer);
    }
    expect(names(agentTools(new Vault(FIXTURE, { allow: [] })))).toEqual([]);
  });

  test("write creates, and move rewrites the links it would break", async () => {
    const vault = new Vault(copyVault());
    const run = (name: string, input: Record<string, unknown>) => {
      const found = tool(name);
      return found.run(vault, validateInput(found, input));
    };
    expect(await run("tsuzuri_write", { path: "Notes/By tool.md", content: "x\n" })).toMatchObject({ created: true });
    const moved = await run("tsuzuri_move", { note: "Working memory", to: "Topics/Short-term memory.md" });
    expect(moved).toMatchObject({ written: true, rewritten: [{ path: "Topics/Cognitive load.md" }] });
  });

  test("capture and new tools use the vault's templates and type routes", async () => {
    const root = copyVault();
    writeFileSync(
      join(root, "Templates", "capture.md"),
      "---\nkind: capture\nsource: https://example.com/template\n---\n\n# {{title}}\n",
    );
    const vault = new Vault(root, {
      config: { types: { capture: { folder: "Queue", filename: "{{slug}}" }, book: { folder: "Books" } } },
    });
    const captured = (await call(vault, "tsuzuri_capture", { text: "An idea", dryRun: true })) as {
      path: string;
      content: string;
    };
    expect(captured.path).toBe("Queue/an-idea.md");
    expect(captured.content).toContain("kind: capture");
    expect(captured.content).toContain("source: https://example.com/template");
    const created = (await call(vault, "tsuzuri_new", { type: "book", title: "Dune", dryRun: true })) as {
      path: string;
    };
    expect(created.path).toBe("Books/Dune.md");
  });
});

describe("validateInput", () => {
  test("rejects missing, unknown, and mistyped inputs with clear messages", () => {
    expect(() => validateInput(tool("tsuzuri_get"), {})).toThrow("tsuzuri_get needs note");
    expect(() => validateInput(tool("tsuzuri_get"), { note: "x", bogus: 1 })).toThrow("has no input bogus");
    expect(() => validateInput(tool("tsuzuri_search"), { query: "x", limit: 0 })).toThrow(ToolInputError);
    expect(() => validateInput(tool("tsuzuri_list"), { sort: "size" })).toThrow("must be one of");
    expect(() => validateInput(tool("tsuzuri_capture"), { text: "x", tags: ["a", 2] })).toThrow("must be array");
    expect(() => validateInput(tool("tsuzuri_get"), "note")).toThrow("takes an object");
    expect(() => validateInput(tool("tsuzuri_list"), { where: { status: 3 } })).toThrow(
      "values must be string or null",
    );
    expect(validateInput(tool("tsuzuri_list"), { where: { status: "done", source: null } })).toBeDefined();
  });

  test("refuses a malformed line range instead of reading the whole note", async () => {
    const vault = new Vault(copyVault());
    await expect(call(vault, "tsuzuri_get", { note: "Home", lines: "abc:def" })).rejects.toThrow(ToolInputError);
    expect(await call(vault, "tsuzuri_get", { note: "Home", lines: "2" })).toMatchObject({ start: 2, end: 2 });
  });
});

describe("running tools", () => {
  test("reads go through the SDK", async () => {
    const vault = new Vault(copyVault());
    expect(await call(vault, "tsuzuri_get", { note: "clt", lines: "1:2" })).toMatchObject({ start: 1, end: 2 });
    expect(((await call(vault, "tsuzuri_find", { query: "wm" })) as { path: string }[])[0]?.path).toBe(
      "Topics/Working memory.md",
    );
    expect(await call(vault, "tsuzuri_list", { where: { born: "-428" } })).toMatchObject([{ path: "People/Plato.md" }]);
    expect(await call(vault, "tsuzuri_prop_get", { note: "People/Plato.md", key: "born" })).toBe(-428);
  });

  test("grep reads a model's pattern as literal text unless regex is set, and caps its length", async () => {
    const vault = new Vault(copyVault());
    const literal = (await call(vault, "tsuzuri_grep", { pattern: "load." })) as unknown[];
    const regex = (await call(vault, "tsuzuri_grep", { pattern: "load.", regex: true })) as unknown[];
    expect(regex.length).toBeGreaterThan(literal.length);
    await expect(call(vault, "tsuzuri_grep", { pattern: "x".repeat(201) })).rejects.toThrow(ToolInputError);
    await expect(call(vault, "tsuzuri_grep", { pattern: "(", regex: true })).rejects.toThrow(ToolInputError);
  });

  test("writes take the model's guards and change only the files", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    const preview = (await call(vault, "tsuzuri_append", { note: "Home", text: "- x", dryRun: true })) as {
      diff: string;
    };
    expect(preview.diff).toContain("+- x");
    await call(vault, "tsuzuri_capture", { text: "From a tool", tags: ["tools"] });
    expect(readFileSync(join(root, "Inbox", "From a tool.md"), "utf8")).toContain("From a tool");
    await call(vault, "tsuzuri_prop_set", { note: "People/Plato.md", key: "rating", value: "5" });
    expect(readFileSync(join(root, "People", "Plato.md"), "utf8")).toContain("rating: 5");
  });
});

describe("the tsuzuri-tools command", () => {
  const CLI = join(import.meta.dirname, "..", "src", "tools-cli.ts");
  const run = (...args: string[]) => spawnSync("node", [CLI, ...args], { encoding: "utf8" });

  test("prints the definitions, the SDK's without run", () => {
    const { status, stdout } = run("--json");
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual(
      JSON.parse(JSON.stringify(TOOLS.map(({ run: _, ...definition }) => definition))),
    );
    expect(run().stdout).toContain("tsuzuri_capture\tcapture\tadds\t");
    expect(run("--bogus").status).toBe(2);
  });
});

test("a malformed call is a ToolInputError, and so a TsuzuriError", () => {
  const error = new ToolInputError("x");
  expect(error).toBeInstanceOf(TsuzuriError);
  expect(error.name).toBe("ToolInputError");
});
