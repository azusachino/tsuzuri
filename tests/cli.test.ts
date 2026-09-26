import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { copyVault, FIXTURE } from "./git.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

function run(...args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, "--vault", FIXTURE, ...args], { encoding: "utf8" });
  return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

describe("cli", () => {
  test("emits JSON with --json", () => {
    const { code, stdout } = run("list", "--type", "person", "--json");
    expect(code).toBe(0);
    expect(JSON.parse(stdout).map((note: { path: string }) => note.path)).toEqual([
      "People/Greek/Plato.md",
      "People/Plato.md",
    ]);
  });

  test("reports a malformed or retired tsuzuri.toml in one line", () => {
    for (const toml of ["capture = [\n", '[journal.day]\nformat = "YYYY-MM-DD"\n']) {
      const root = mkdtempSync(join(tmpdir(), "tsuzuri-badtoml-"));
      writeFileSync(join(root, "tsuzuri.toml"), toml);
      const result = spawnSync("node", [CLI, "--vault", root, "list"], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr.startsWith("tsuzuri: tsuzuri.toml: ")).toBe(true);
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
    }
  });

  test("dry-runs a capture from stdin", () => {
    const result = spawnSync("node", [CLI, "--vault", FIXTURE, "capture", "--dry-run", "--json"], {
      input: "- from stdin\n",
      encoding: "utf8",
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ path: "Inbox/from stdin.md", written: false });
  });

  test("exits 1 for a missing note and 2 for bad usage", () => {
    expect(run("get", "nothing-here").code).toBe(1);
    expect(run("journal", "day").code).toBe(2);
    expect(run("nope").code).toBe(2);
    expect(run("list", "--bogus").code).toBe(2);
    expect(run("search").code).toBe(2);
    expect(run("search", "x", "--limit", "0").code).toBe(2);
  });
});

describe("cli get by line", () => {
  test("takes an rg -n result for --around unchanged", () => {
    const hit = "Topics/Cognitive load.md:9:Cognitive load theory explains why working memory limits learning.";
    const { code, stdout } = run("get", "--around", hit, "--context", "0", "--json");
    expect(code).toBe(0);
    const slice = JSON.parse(stdout);
    expect(slice).toMatchObject({ path: "Topics/Cognitive load.md", start: 9, end: 9, total: 27 });
    expect(slice.body).toBe(hit.split(":").slice(2).join(":"));
  });

  test("reads --lines ranges, open-ended or one line", () => {
    expect(run("get", "clt", "--lines", "1:2").stdout).toBe("Topics/Cognitive load.md:1-2 of 27\n\n---\naliases:\n");
    expect(JSON.parse(run("get", "clt", "--lines", "26:", "--json").stdout)).toMatchObject({ start: 26, end: 27 });
    expect(JSON.parse(run("get", "clt", "--lines", "9", "--json").stdout)).toMatchObject({ start: 9, end: 9 });
  });

  test("exits 1 for a range past the note and 2 for malformed options", () => {
    expect(run("get", "clt", "--lines", "99").code).toBe(1);
    expect(run("get", "clt", "--lines", "a:b").code).toBe(2);
    expect(run("get", "clt", "--context", "3").code).toBe(2);
    expect(run("get", "clt", "--around", "Topics/Cognitive load.md:9").code).toBe(2);
    expect(run("get", "--around", "nowhere").code).toBe(2);
  });
});

describe("cli output shapes", () => {
  test("--fields keeps the named fields, in JSON or as tab-separated text", () => {
    const json = run("list", "--type", "person", "--fields", "path,born", "--json");
    expect(JSON.parse(json.stdout)).toEqual([
      { path: "People/Greek/Plato.md", born: null },
      { path: "People/Plato.md", born: -428 },
    ]);
    expect(run("get", "People/Plato.md", "--fields", "title,tags").stdout).toBe('Plato\t["philosophy"]\n');
  });

  test("--format paths prints one path per line", () => {
    expect(run("list", "--type", "person", "--format", "paths").stdout).toBe(
      "People/Greek/Plato.md\nPeople/Plato.md\n",
    );
    expect(run("nav", "Topics", "--format", "paths").stdout).toBe(
      "Topics/index.md\nTopics/Cognitive load.md\nTopics/Working memory.md\n",
    );
  });

  test("refuses a shape a command cannot produce", () => {
    expect(run("unresolved", "--format", "paths").code).toBe(2);
    expect(run("links", "clt", "--fields", "path").code).toBe(2);
    expect(run("list", "--format", "yaml").code).toBe(2);
  });
});

describe("cli capture --file", () => {
  const draft = join(mkdtempSync(join(tmpdir(), "tsuzuri-draft-")), "Weekend plan.md");
  writeFileSync(draft, "---\ntags:\n  - planning\n---\n\n- buy tea\n- read a book\n");

  test("imports a Markdown file, merging --tag", () => {
    const { code, stdout } = run("capture", "--file", draft, "--tag", "home", "--dry-run", "--json");
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.path).toBe("Inbox/Weekend plan.md");
    expect(result.content).toBe("---\ntags:\n  - planning\n  - home\n---\n\n- buy tea\n- read a book\n");
  });

  test("refuses text and --file together", () => {
    expect(run("capture", "--file", draft, "extra text").code).toBe(2);
  });
});

describe("errors under --json", () => {
  const errorOf = (...args: string[]) => {
    const { code, stderr } = run(...args, "--json");
    return { code, error: JSON.parse(stderr.trim()).error };
  };

  test("name the error and carry its own fields, such as the closest notes", () => {
    const { code, error } = errorOf("get", "cognitive laod");
    expect(code).toBe(1);
    expect(error.name).toBe("NotFoundError");
    expect(error.message.startsWith('no note matches "cognitive laod"')).toBe(true);
    expect(error.suggestions[0]).toBe("Topics/Cognitive load.md");
  });

  test("report a usage error, and an option that fails to parse, as UsageError with exit 2", () => {
    expect(errorOf("get", "Home", "--limit", "3")).toMatchObject({ code: 2, error: { name: "UsageError" } });
    const parsed = errorOf("get", "--bogus");
    expect(parsed).toMatchObject({ code: 2, error: { name: "UsageError" } });
    expect(parsed.error.message).toContain("--bogus");
  });
});

describe("help", () => {
  interface HelpJson {
    commands: { name: string; options: { name: string }[]; example: string }[];
  }
  const help = (): HelpJson => JSON.parse(run("help", "--json").stdout);

  test("runs every command's example without a usage error", () => {
    const root = copyVault();
    for (const { name, example } of help().commands) {
      const words = [...example.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? "").slice(1);
      const result = spawnSync("node", [CLI, "--vault", root, ...words], { encoding: "utf8" });
      expect(result.status, `${name}: ${result.stderr}`).not.toBe(2);
    }
  });

  test("gives one command's help for <command> --help and help <command>", () => {
    const direct = run("get", "--help");
    expect(direct.code).toBe(0);
    expect(direct.stdout).toBe(run("help", "get").stdout);
    expect(direct.stdout.startsWith("usage: tsuzuri get <note>")).toBe(true);
    expect(direct.stdout).toContain("--lines <a:b>");
    expect(direct.stdout).not.toContain("--limit");
    expect(run("help", "prop").stdout).toContain("usage: tsuzuri prop set");
  });

  test("lists every command with its options as JSON", () => {
    const commands = help().commands;
    expect(commands.map((command) => command.name)).toContain("section put");
    expect(commands.find((command) => command.name === "grep")?.options.map((option) => option.name)).toContain(
      "--fixed-strings",
    );
  });

  test("docs/cli.md names every command and each of its options, and nothing else", () => {
    const page = readFileSync(join(import.meta.dirname, "..", "docs", "cli.md"), "utf8");
    const sections = new Map(
      page
        .split(/^### /m)
        .slice(1)
        .map((section) => [section.slice(0, section.indexOf("\n")), section] as const),
    );
    const commands = help().commands;
    expect([...sections.keys()].sort()).toEqual(commands.map((command) => command.name).sort());
    for (const { name, options } of commands) {
      for (const option of options) expect(sections.get(name), `${name} ${option.name}`).toContain(`${option.name}`);
    }
  });

  test("the skill names only commands and options the CLI takes", () => {
    const skill = readFileSync(join(import.meta.dirname, "..", "skills", "tsuzuri", "SKILL.md"), "utf8");
    const commands = new Map(help().commands.map((command) => [command.name, command] as const));
    const global = ["--json", "--vault", "--format", "--help", "--version"];
    // A code span naming a command: its first two words when they are one, such as `prop set`, else its first.
    const calls = [...skill.matchAll(/`([^`]+)`/g)].flatMap((match) => {
      const span = match[1] ?? "";
      const words = span.split(/\s+/);
      const name = commands.has(words.slice(0, 2).join(" ")) ? words.slice(0, 2).join(" ") : (words[0] ?? "");
      return commands.has(name) ? [[name, span] as const] : [];
    });
    expect(calls.length).toBeGreaterThan(15);
    for (const [name, span] of calls) {
      const command = commands.get(name);
      const allowed = new Set([...global, ...(command?.options.map((option) => option.name) ?? [])]);
      for (const flag of span.match(/--[a-z-]+/g) ?? []) expect(allowed.has(flag), `${name} ${flag}`).toBe(true);
    }
  });

  test("refuses an option the command does not take", () => {
    const { code, stderr } = run("get", "Home", "--limit", "3");
    expect(code).toBe(2);
    expect(stderr.startsWith("tsuzuri: get does not take --limit; run tsuzuri help get")).toBe(true);
  });
});
