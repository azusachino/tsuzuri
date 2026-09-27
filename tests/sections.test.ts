import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SectionError, Vault, WriteConflictError } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { copyVault } from "./git.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const PLAN = [
  "---",
  "# a YAML comment",
  "title: Plan",
  "---",
  "",
  "# Plan",
  "",
  "Intro.",
  "",
  "## Work",
  "",
  "- ship grep",
  "",
  "### Work details",
  "",
  "```sh",
  "# a shell comment, not a heading",
  "## nor this",
  "```",
  "",
  "## Home",
  "",
  "- water the plants",
  "",
  "## Empty",
  "",
  "## Last",
  "- tail item",
].join("\n");

function planVault(): { root: string; vault: Vault; read: () => string } {
  const root = copyVault();
  writeFileSync(join(root, "Plan.md"), PLAN);
  return { root, vault: new Vault(root), read: () => readFileSync(join(root, "Plan.md"), "utf8") };
}

/** Text outside [start, end) of the original is unchanged in the edited text. */
function expectOnlyChanged(before: string, after: string, start: number, end: number): void {
  expect(after.startsWith(before.slice(0, start))).toBe(true);
  expect(after.endsWith(before.slice(end))).toBe(true);
}

describe("append", () => {
  test("adds to the end of a section with nested headings and fenced # lines, touching nothing else", async () => {
    const { vault, read } = planVault();
    await vault.append("Plan", "- write append", { heading: "Work" });
    const after = read();
    const at = PLAN.indexOf("```\n\n## Home") + "```".length;
    expect(after.slice(at, at + "\n- write append".length)).toBe("\n- write append");
    expectOnlyChanged(PLAN, after, at, at);
  });

  test("fills an empty section, keeps its blank line, and appends at the end of a note without a final newline", async () => {
    const { vault, read } = planVault();
    await vault.append("Plan", "- first", { heading: "Empty" });
    expect(read()).toContain("## Empty\n- first\n\n## Last");
    await vault.append("Plan", "- tail two", { heading: "Last" });
    expect(read().endsWith("## Last\n- tail item\n- tail two\n")).toBe(true);
    await vault.append("Plan", "Closing line.");
    expect(read().endsWith("- tail two\nClosing line.\n")).toBe(true);
  });

  test("refuses a missing heading unless told to create it", async () => {
    const { vault, read } = planVault();
    await expect(vault.append("Plan", "x", { heading: "Ideas" })).rejects.toThrow(SectionError);
    expect(read()).toBe(PLAN);
    await vault.append("Plan", "- an idea", { heading: "Ideas", createHeading: true, level: 3 });
    expect(read().endsWith("- tail item\n\n### Ideas\n\n- an idea\n")).toBe(true);
  });
});

describe("section put", () => {
  test("replaces one section's body and leaves every other section byte-identical", async () => {
    const { vault, read } = planVault();
    await vault.putSection("Plan", "Home", "- repaint the fence");
    const after = read();
    // The Home section's body: after its heading line, up to the next heading.
    const start = PLAN.indexOf("\n", PLAN.indexOf("## Home")) + 1;
    const end = PLAN.indexOf("## Empty");
    expect(after).toContain("## Home\n\n- repaint the fence\n\n## Empty");
    expect(after).not.toContain("water the plants");
    expectOnlyChanged(PLAN, after, start, end);
  });

  test("replaces a section holding nested headings and fenced code as a whole", async () => {
    const { vault, read } = planVault();
    await vault.putSection("Plan", "Work", "- only this now");
    expect(read()).toContain("## Work\n\n- only this now\n\n## Home");
    expect(read()).not.toContain("Work details");
  });

  test("creates a missing section at the end", async () => {
    const { vault, read } = planVault();
    await vault.putSection("Plan", "Review", "Went fine.");
    expect(read().endsWith("- tail item\n\n## Review\n\nWent fine.\n")).toBe(true);
  });
});

describe("guards", () => {
  test("a dry run returns the diff and writes nothing; a stale hash is refused", async () => {
    const { vault, read } = planVault();
    const preview = await vault.append("Plan", "- previewed", { heading: "Home", dryRun: true });
    expect(preview.written).toBe(false);
    expect(preview.diff.startsWith("--- a/Plan.md")).toBe(true);
    expect(preview.diff).toContain("+- previewed");
    expect(read()).toBe(PLAN);
    const { hash } = await vault.get("Plan");
    await vault.append("Plan", "- once", { ifHash: hash });
    await expect(vault.append("Plan", "- twice", { ifHash: hash })).rejects.toThrow(WriteConflictError);
  });

  test("the CLI takes bullets, stdin, and --if-hash, and refuses what it cannot do", async () => {
    const root = copyVault();
    const run = (args: string[], input?: string) =>
      spawnSync("node", [CLI, "--vault", root, ...args], { encoding: "utf8", input });
    expect(run(["append", "Weekly/2026-W38.md", "- a bullet", "--heading", "plan"]).status).toBe(0);
    expect(readFileSync(join(root, "Weekly", "2026-W38.md"), "utf8")).toContain("- a bullet");
    expect(run(["section", "put", "Weekly/2026-W38.md", "--heading", "plan"], "- from stdin\n").status).toBe(0);
    expect(readFileSync(join(root, "Weekly", "2026-W38.md"), "utf8")).toContain("## plan\n\n- from stdin\n");
    expect(run(["append", "Weekly/2026-W38.md", "x", "--if-hash", "0".repeat(64)]).status).toBe(1);
    expect(run(["append", "Weekly/2026-W38.md", "x", "--heading", "nowhere"]).status).toBe(1);
    expect(run(["section", "put", "Weekly/2026-W38.md", "x"]).status).toBe(2);
  });
});
