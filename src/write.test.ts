import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { contentHash, splice, WriteConflictError, writeNote } from "./write.ts";

const NOTE = "Topics/Cognitive load.md";
const TEXT = "---\ntags:\n  - psychology\n---\n\nCognitive load theory explains why working memory limits learning.\n";

/** A folder holding one note, as writeNote sees a vault: a root and a relative path. */
function folder(): string {
  const root = mkdtempSync(join(tmpdir(), "tsuzuri-write-"));
  mkdirSync(join(root, "Topics"));
  writeFileSync(join(root, NOTE), TEXT);
  return root;
}

describe("splice", () => {
  test("changes only the target range", () => {
    expect(splice("abcdef", 2, 4, "XY")).toBe("abXYef");
    expect(splice("abc", 3, 3, "!")).toBe("abc!");
    expect(() => splice("abc", 2, 1, "")).toThrow(RangeError);
  });
});

describe("writeNote", () => {
  test("leaves every byte outside the target unchanged", async () => {
    const root = folder();
    const before = readFileSync(join(root, NOTE));
    const target = "working memory limits learning";
    const result = await writeNote(
      root,
      NOTE,
      (text = "") => splice(text, text.indexOf(target), text.indexOf(target) + target.length, "limits learning"),
      {},
    );
    const after = readFileSync(join(root, NOTE));
    const start = before.indexOf(target);
    expect(result).toMatchObject({ written: true, created: false });
    expect(after.subarray(0, start)).toEqual(before.subarray(0, start));
    expect(after.subarray(start + "limits learning".length)).toEqual(before.subarray(start + target.length));
  });

  test("refuses a stale hash and accepts the current one", async () => {
    const root = folder();
    const hash = contentHash(TEXT);
    const edit = (text = "") => `${text}one more line\n`;
    expect((await writeNote(root, NOTE, edit, { ifHash: hash })).written).toBe(true);
    await expect(writeNote(root, NOTE, edit, { ifHash: hash })).rejects.toThrow(WriteConflictError);
    await expect(writeNote(root, "Nowhere.md", edit, { ifHash: hash })).rejects.toThrow("does not exist");
  });

  test("returns a unified diff and writes nothing on a dry run", async () => {
    const root = folder();
    const result = await writeNote(root, NOTE, (text = "") => `${text}appended\n`, { dryRun: true });
    expect(result.written).toBe(false);
    expect(result.diff).toContain(`--- a/${NOTE}`);
    expect(result.diff).toContain("+appended");
    expect(readFileSync(join(root, NOTE), "utf8")).toBe(TEXT);
  });

  test("keeps a byte order mark, and creates a missing note", async () => {
    const root = folder();
    writeFileSync(join(root, "Marked.md"), "\uFEFFfirst\n");
    await writeNote(root, "Marked.md", (text = "") => `${text}second\n`, {});
    expect(readFileSync(join(root, "Marked.md"))[0]).toBe(0xef);
    expect(readFileSync(join(root, "Marked.md"), "utf8")).toBe("\uFEFFfirst\nsecond\n");
    const created = await writeNote(root, "New/Fresh.md", () => "fresh\n", {});
    expect(created).toMatchObject({ created: true, written: true });
  });

  test("replaces a note whole, keeping its mode and any symbolic link, with no temporary file left", async () => {
    const root = folder();
    chmodSync(join(root, NOTE), 0o640);
    await writeNote(root, NOTE, (text = "") => `${text}more\n`, {});
    expect(statSync(join(root, NOTE)).mode & 0o777).toBe(0o640);
    writeFileSync(join(root, "Real.md"), "real\n");
    symlinkSync("Real.md", join(root, "Link.md"));
    await writeNote(root, "Link.md", () => "through the link\n", {});
    expect(lstatSync(join(root, "Link.md")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(root, "Real.md"), "utf8")).toBe("through the link\n");
    const leftovers = [root, join(root, "Topics")].flatMap((dir) =>
      readdirSync(dir).filter((name) => name.endsWith(".tmp")),
    );
    expect(leftovers).toEqual([]);
  });
});
