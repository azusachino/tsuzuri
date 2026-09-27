/** Obsidian's core Templates: find a template by type and fill its `{{title}}`, `{{date}}`, and `{{time}}`. */
import { posix } from "node:path";
import { formatDate } from "./dateformat.ts";
import type { TemplateSettings } from "./settings.ts";

const PLACEHOLDER = /\{\{\s*(title|date|time|slug)(?::([^}]*?))?\s*\}\}/gi;

/** ASCII slug for a filename or template, falling back to the capture timestamp. */
export function slugTitle(title: string, now: Date): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  if (slug.length >= 3) return slug;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `capture-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** The template for a type: a note in the template folder named `<type>` or `<type> Template`, in any case. */
export function templateFor(paths: string[], folder: string, type: string): string | undefined {
  const prefix = `${folder}/`;
  const wanted = type.trim().toLowerCase();
  return paths.find((path) => {
    if (!path.startsWith(prefix)) return false;
    if (path.slice(prefix.length).includes("/")) return false;
    const stem = posix.basename(path, ".md").toLowerCase();
    return stem === wanted || stem === `${wanted} template`;
  });
}

/** The template names available in the folder, for an error that says what exists. */
export function templateNames(paths: string[], folder: string): string[] {
  return paths
    .filter((path) => path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes("/"))
    .map((path) => posix.basename(path, ".md").replace(/ template$/i, ""));
}

/**
 * Fill the placeholders Obsidian's core Templates plugin knows: `{{title}}`, and `{{date}}` and `{{time}}` with an
 * optional moment-style format such as `{{date:YYYY-MM-DD}}`. Other syntaxes (Templater, Foam) are left as written.
 */
export function renderTemplate(text: string, title: string, now: Date, settings: TemplateSettings): string {
  const frontmatterEnd = text.startsWith("---\n") ? text.indexOf("\n---", 4) : -1;
  return text.replace(PLACEHOLDER, (match, name: string, format: string | undefined, offset: number) => {
    const kind = name.toLowerCase();
    const value =
      kind === "title"
        ? title
        : kind === "slug"
          ? slugTitle(title, now)
          : formatDate(now, format?.trim() || (kind === "date" ? settings.dateFormat : settings.timeFormat));
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    const lineEnd = text.indexOf("\n", offset + match.length);
    const before = text.slice(lineStart, offset);
    const after = text.slice(offset + match.length, lineEnd < 0 ? undefined : lineEnd);
    if (frontmatterEnd >= 0 && offset < frontmatterEnd) {
      if (/^\s*[\w-]+:\s*$/.test(before) && /^\s*$/.test(after)) return JSON.stringify(value);
      if (/^\s*[\w-]+:\s*"[^"]*$/.test(before) && /^[^"]*"\s*$/.test(after)) {
        return JSON.stringify(value).slice(1, -1);
      }
      if (/^\s*[\w-]+:\s*'[^']*$/.test(before) && /^[^']*'\s*$/.test(after)) {
        return value.replaceAll("'", "''");
      }
    }
    return value;
  });
}
