import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotFoundError, Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { copyVault, FIXTURE } from "./git.ts";

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
    // A copy, so a write that bad usage should have refused cannot edit the shared fixture.
    const root = copyVault();
    expect(run(root, "prop", "get", "People/Plato.md", "type").stdout).toBe("person\n");
    expect(JSON.parse(run(root, "prop", "get", "clt", "aliases", "--json").stdout)).toEqual(["CLT"]);
    expect(run(root, "prop", "get", "clt", "nope").status).toBe(1);
    expect(run(root, "prop", "set", "clt", "x").status).toBe(2);
    expect(readFileSync(join(root, "Topics", "Cognitive load.md"), "utf8")).toBe(
      readFileSync(join(FIXTURE, "Topics", "Cognitive load.md"), "utf8"),
    );
  });
});

describe("the declared templates folder", () => {
  test("is left out of the browsing reads, while get and notes still reach it", async () => {
    const paths = (notes: { path: string }[]) => notes.map((note) => note.path);
    expect(paths(await vault.list({}))).not.toContain("Templates/Book.md");
    expect((await vault.tags()).map((tag) => tag.tag)).not.toContain("reading");
    expect((await vault.nav()).folders.map((folder) => folder.path)).not.toContain("Templates");
    expect(paths(await vault.orphans())).not.toContain("Templates/Book.md");
    expect((await vault.search("Started")).map((hit) => hit.path)).not.toContain("Templates/Book.md");
    // The primitive enumerates every file, and an explicit read still reaches one.
    expect(paths(await vault.notes())).toContain("Templates/Book.md");
    expect((await vault.get("Templates/Book.md")).path).toBe("Templates/Book.md");
  });

  test("shows as ordinary notes when the vault declares no templates folder", async () => {
    const root = copyVault();
    try {
      const config = readFileSync(join(root, "tsuzuri.toml"), "utf8").replace(
        '[templates]\nfolder = "Templates"\n',
        "",
      );
      writeFileSync(join(root, "tsuzuri.toml"), config);
      const plain = new Vault(root);
      expect((await plain.list({})).map((note) => note.path)).toContain("Templates/Book.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
