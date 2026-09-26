import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";

describe("portability", () => {
  test("reads frontmatter after a byte order mark", async () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-bom-"));
    writeFileSync(join(root, "note.md"), "\uFEFF---\ntitle: Marked\n---\n\nBody\n");
    expect((await new Vault(root).find("note")).title).toBe("Marked");
  });
});
