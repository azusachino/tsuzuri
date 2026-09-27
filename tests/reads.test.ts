import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotFoundError, Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { FIXTURE } from "./git.ts";

const vault = new Vault(FIXTURE);
const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const run = (root: string, ...args: string[]) =>
  spawnSync("node", [CLI, "--vault", root, ...args], { encoding: "utf8" });

const OUTLINED = [
  "---",
  "# a YAML comment, not a heading",
  "title: Outlined",
  "---",
  "",
  "# Top",
  "",
  "Text.",
  "",
  "## Second level ##",
  "",
  "```md",
  "# fenced, not a heading",
  "```",
  "",
  "~~~",
  "## also fenced",
  "~~~",
  "",
  "   ### Indented three spaces",
  "#no-space is a tag, not a heading",
  "###### Six",
  "",
].join("\n");

function outlinedVault(): string {
  const root = mkdtempSync(join(tmpdir(), "tsuzuri-outline-"));
  cpSync(FIXTURE, root, { recursive: true });
  writeFileSync(join(root, "Notes", "Outlined.md"), OUTLINED);
  writeFileSync(join(root, "Notes", "Self.md"), "Only [[Self]] links here.\n");
  writeFileSync(join(root, "Notes", "Embedder.md"), "![[Outlined]]\n");
  return root;
}

describe("orphans", () => {
  test("lists notes no other note links to", async () => {
    const orphans = (await vault.orphans()).map((note) => note.path);
    expect(orphans).toContain("Home.md");
    expect(orphans).toContain("Notes/乌龙茶.md");
    expect(orphans).not.toContain("Topics/Working memory.md");
    // [[Plato]] matches two notes, so it resolves to neither.
    expect(orphans).toContain("People/Plato.md");
  });

  test("counts embeds as links and self-links as nothing, narrowed by the filters", async () => {
    const outlined = new Vault(outlinedVault());
    const orphans = (await outlined.orphans({ under: "Notes" })).map((note) => note.path);
    expect(orphans).not.toContain("Notes/Outlined.md");
    expect(orphans).toContain("Notes/Self.md");
    expect(orphans.every((path) => path.startsWith("Notes/"))).toBe(true);
  });
});

describe("outline", () => {
  test("lists ATX headings with file line numbers, skipping frontmatter and fenced code", async () => {
    expect(await new Vault(outlinedVault()).outline("Outlined")).toEqual([
      { level: 1, text: "Top", line: 6 },
      { level: 2, text: "Second level", line: 10 },
      { level: 3, text: "Indented three spaces", line: 20 },
      { level: 6, text: "Six", line: 22 },
    ]);
  });

  test("gives line numbers that get --lines reads back", async () => {
    const outlined = new Vault(outlinedVault());
    const [, second] = await outlined.outline("Outlined");
    const slice = await outlined.get("Outlined", { lines: { start: second?.line, end: second?.line } });
    expect(slice.body).toBe("## Second level ##");
  });

  test("prints line, marks, and text from the CLI", () => {
    expect(run(outlinedVault(), "outline", "Outlined").stdout.split("\n")[0]).toBe("6\t# Top");
    expect(run(FIXTURE, "outline", "Topics/index.md").stdout).toContain("## reading order");
  });
});

describe("prop get", () => {
  test("returns one frontmatter value as parsed", async () => {
    expect(await vault.property("People/Plato.md", "born")).toBe(-428);
    expect(await vault.property("clt", "aliases")).toEqual(["CLT"]);
    await expect(vault.property("clt", "nope")).rejects.toThrow(NotFoundError);
  });

  test("prints text or JSON, and exits 1 for a missing property and 2 for bad usage", () => {
    expect(run(FIXTURE, "prop", "get", "People/Plato.md", "type").stdout).toBe("person\n");
    expect(JSON.parse(run(FIXTURE, "prop", "get", "clt", "aliases", "--json").stdout)).toEqual(["CLT"]);
    expect(run(FIXTURE, "prop", "get", "clt", "nope").status).toBe(1);
    expect(run(FIXTURE, "prop", "set", "clt", "x").status).toBe(2);
  });
});
