import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { FIXTURE } from "./git.ts";

const vault = new Vault(FIXTURE);
const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

describe("reading tags", () => {
  test("normalizes each fixture tag form", async () => {
    expect((await vault.find("History/Overview.md")).tags).toEqual(["History", "overview"]);
    expect((await vault.find("Topics/History/Timeline.md")).tags).toEqual(["history/timeline", "overview"]);
  });
});

describe("matching tags", () => {
  test("requires every tag in a filter", async () => {
    const paths = async (tags: string[]) => (await vault.list({ tags })).map((note) => note.path);
    expect(await paths(["history"])).toEqual(["History/Overview.md", "Topics/History/Timeline.md"]);
    expect(await paths(["history", "overview"])).toEqual(["History/Overview.md", "Topics/History/Timeline.md"]);
    expect(await paths(["history/timeline", "OVERVIEW"])).toEqual(["Topics/History/Timeline.md"]);
    expect(await paths(["history", "tea"])).toEqual([]);
  });
});

describe("counting tags", () => {
  test("lists the fixture's tags with counts, narrowed by the filters", async () => {
    expect(await vault.tags()).toContainEqual({ tag: "History", notes: 2 });
    expect(await vault.tags()).toContainEqual({ tag: "psychology", notes: 2 });
    expect(await vault.tags({ under: "People" })).toEqual([{ tag: "philosophy", notes: 2 }]);
  });

  test("prints counts from the CLI, and --tag may repeat", () => {
    const run = (...args: string[]) => spawnSync("node", [CLI, "--vault", FIXTURE, ...args], { encoding: "utf8" });
    expect(JSON.parse(run("tags", "--under", "People", "--json").stdout)).toEqual([{ tag: "philosophy", notes: 2 }]);
    expect(run("tags", "--under", "Notes").stdout).toBe("1\ttea\n");
    expect(run("list", "--tag", "history", "--tag", "overview", "--format", "paths").stdout.trim().split("\n")).toEqual(
      ["History/Overview.md", "Topics/History/Timeline.md"],
    );
    expect(run("tags", "extra").status).toBe(2);
  });
});
