import { describe, expect, test } from "vitest";
import { renderTemplate, templateFor } from "./templates.ts";

const NOW = new Date(2026, 8, 24, 19, 5);
const SETTINGS = { folder: "Templates", dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm", source: "tsuzuri.toml" };

describe("rendering", () => {
  test("fills title, date, and time, with an optional moment-style format", () => {
    const text = "{{title}} {{date}} {{time}} {{date:YYYY}} {{ date:DD.MM }} {{time:HH}}";
    expect(renderTemplate(text, "Dune", NOW, SETTINGS)).toBe("Dune 2026-09-24 19:05 2026 24.09 19");
  });

  test("leaves other template syntaxes as written", () => {
    expect(renderTemplate("<% tp.date.now() %> {{other}}", "x", NOW, SETTINGS)).toBe("<% tp.date.now() %> {{other}}");
  });

  test("finds a template named after the type, with or without Template", () => {
    const paths = ["Templates/Book.md", "Templates/Movie Template.md", "Notes/Book.md"];
    expect(templateFor(paths, "Templates", "book")).toBe("Templates/Book.md");
    expect(templateFor(paths, "Templates", "Movie")).toBe("Templates/Movie Template.md");
    expect(templateFor(paths, "Templates", "song")).toBeUndefined();
  });
});
