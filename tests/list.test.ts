import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { FIXTURE } from "./git.ts";

const vault = new Vault(FIXTURE);
const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const paths = (notes: { path: string }[]) => notes.map((note) => note.path);

/** The fixture plus a shelf of books, so "latest books" has something to find. */
function withBooks(): Vault {
  const root = mkdtempSync(join(tmpdir(), "tsuzuri-books-"));
  cpSync(FIXTURE, root, { recursive: true });
  const books: [string, string, string[]][] = [
    ["Dune", "2026-09-20T09:00", ["sf", "classic"]],
    ["Emma", "2026-09-10T09:00", ["classic"]],
    ["Hyperion", "2026-09-22T09:00", ["sf"]],
  ];
  for (const [title, modified, genre] of books) {
    const list = genre.map((g) => `  - ${g}`).join("\n");
    writeFileSync(join(root, "Notes", `${title}.md`), `---\ntype: book\nmodified: ${modified}\ngenre:\n${list}\n---\n`);
  }
  writeFileSync(join(root, "Notes", "Unread.md"), "---\ntype: book\n---\n");
  return new Vault(root);
}

describe("where", () => {
  test("matches any frontmatter property as text, and list properties by any item", async () => {
    expect(paths(await vault.list({ where: { born: "-428" } }))).toEqual(["People/Plato.md"]);
    const books = withBooks();
    expect(paths(await books.list({ where: { genre: "sf" } }))).toEqual(["Notes/Dune.md", "Notes/Hyperion.md"]);
    expect(paths(await books.list({ where: { genre: "sf", type: "book" } }))).toHaveLength(2);
    expect(await books.list({ where: { genre: "romance" } })).toEqual([]);
  });

  test("with a null value, asks only that the property be present", async () => {
    expect(paths(await vault.list({ where: { born: null } }))).toEqual(["People/Plato.md"]);
    expect(await vault.list({ where: { nowhere: null } })).toEqual([]);
  });
});

describe("sort and limit", () => {
  test("give the ten most recently modified books in one call", async () => {
    const latest = await withBooks().list({
      where: { type: "book" },
      under: "Notes",
      sort: "modified",
      desc: true,
      limit: 10,
    });
    expect(paths(latest)).toEqual(["Notes/Hyperion.md", "Notes/Dune.md", "Notes/Emma.md", "Notes/Unread.md"]);
  });

  test("sort notes without the value last in either direction", async () => {
    const books = withBooks();
    expect(paths(await books.list({ where: { type: "book" }, under: "Notes", sort: "modified" })).at(-1)).toBe(
      "Notes/Unread.md",
    );
    const byCreated = paths(await vault.list({ sort: "created" }));
    expect(byCreated.slice(0, 2)).toEqual(["People/Plato.md", "People/Greek/Plato.md"]);
  });

  test("sort by title or path, and limit the count", async () => {
    const titles = (await vault.list({ sort: "title", limit: 3 })).map((note) => note.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
    expect(paths(await vault.list({ sort: "path", desc: true, limit: 1 }))).toEqual(["Weekly/2026-W38.md"]);
  });

  test("are flags on the CLI", () => {
    const run = (...args: string[]) => spawnSync("node", [CLI, "--vault", FIXTURE, ...args], { encoding: "utf8" });
    const result = run("list", "--where", "type=person", "--sort", "modified", "--desc", "--format", "paths");
    expect(result.stdout).toBe("People/Plato.md\nPeople/Greek/Plato.md\n");
    expect(run("list", "--where", "born", "--format", "paths").stdout).toBe("People/Plato.md\n");
    expect(run("list", "--sort", "size").status).toBe(2);
    expect(run("list", "--where", "=x").status).toBe(2);
  });
});
