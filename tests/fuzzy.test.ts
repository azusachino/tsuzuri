import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { NotFoundError, Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { FIXTURE } from "./git.ts";

const vault = new Vault(FIXTURE);
const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

describe("find", () => {
  test("ranks Latin titles, aliases, and paths", async () => {
    expect((await vault.suggest("cogld"))[0]?.path).toBe("Topics/Cognitive load.md");
    expect((await vault.suggest("wm"))[0]?.path).toBe("Topics/Working memory.md");
    expect((await vault.suggest("clt"))[0]).toMatchObject({ path: "Topics/Cognitive load.md", matched: "CLT" });
    expect((await vault.suggest("tpcs tmln"))[0]?.path).toBe("Topics/History/Timeline.md");
  });

  test("ranks CJK titles", async () => {
    expect((await vault.suggest("乌龙"))[0]?.path).toBe("Notes/乌龙茶.md");
    expect((await vault.suggest("茶"))[0]?.path).toBe("Notes/乌龙茶.md");
  });

  test("matches the words of a CJK phrase written without spaces in any order, as spaced words are", async () => {
    expect((await vault.suggest("茶乌龙"))[0]?.path).toBe("Notes/乌龙茶.md");
    expect((await vault.suggest("乌龙Notes"))[0]?.path).toBe("Notes/乌龙茶.md");
    expect(await vault.suggest("红茶乌龙")).toEqual([]);
  });

  test("returns summaries narrowed by the filters and the limit", async () => {
    const hits = await vault.suggest("plato", { under: "People/Greek" });
    expect(hits.map((hit) => hit.path)).toEqual(["People/Greek/Plato.md"]);
    expect(hits[0]).toMatchObject({ title: "Plato", type: "person", tags: ["philosophy"] });
    expect(await vault.suggest("o", { limit: 2 })).toHaveLength(2);
  });
});

describe("a failed get", () => {
  test("suggests the closest notes, even through a typo", async () => {
    const error = await vault.find("cognitve laod").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).suggestions[0]).toBe("Topics/Cognitive load.md");
    expect((error as NotFoundError).message).toContain("closest: Topics/Cognitive load.md");
  });

  test("says only not found when nothing is close", async () => {
    const error = (await vault.find("zzzzqq").catch((caught: unknown) => caught)) as NotFoundError;
    expect(error.suggestions).toEqual([]);
    expect(error.message).toBe('no note matches "zzzzqq"');
  });

  test("prints the suggestions from the CLI and exits 1", () => {
    const result = spawnSync("node", [CLI, "--vault", FIXTURE, "get", "wrkng mem"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("closest: Topics/Working memory.md");
    const found = spawnSync("node", [CLI, "--vault", FIXTURE, "find", "wrkng mem", "--json"], { encoding: "utf8" });
    expect(JSON.parse(found.stdout)[0]).toMatchObject({ path: "Topics/Working memory.md" });
  });
});
