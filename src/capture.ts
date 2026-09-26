import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { stringify } from "yaml";
import { TsuzuriError } from "./errors.ts";
import { splitFrontmatter, stringList, yamlScalar } from "./frontmatter.ts";
import type { CaptureSettings } from "./settings.ts";
import { renderTemplate, slugTitle } from "./templates.ts";
import { lowercaseTitle } from "./title.ts";

export interface CaptureInput {
  /** The note body. */
  text: string;
  /** Defaults to the first line of `text`. */
  title?: string;
  tags?: string[];
  source?: string;
  /**
   * Frontmatter imported from a Markdown file or template. A `title`, `tags`, or `source` key is filled from the
   * capture's own title, tags, or source.
   */
  properties?: Record<string, unknown>;
  now?: Date;
}

export interface CaptureOptions {
  /** Build the note and report where it would go, without writing. */
  dryRun?: boolean;
}

export interface CaptureResult {
  path: string;
  content: string;
  written: boolean;
}

const TITLE_LIMIT = 80;
const FILENAME_LIMIT = 120;
// Characters Obsidian refuses in a file name, or that break a wikilink to it.
const UNSAFE_FILENAME = /[*"\\/<>:|?#^[\]\p{Cc}]/gu;

export class CaptureError extends TsuzuriError {}

/** Canonical kebab-case spelling: trimmed, lowercase, one hyphen between words, `/` kept between nested levels. */
export function canonicalTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .split("/")
    .map((part) => part.replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, ""))
    .join("/");
}

export function validTags(tags: string[], settings: CaptureSettings): string[] {
  const spelled = tags.map((tag) => (settings.tagStyle === "kebab" ? canonicalTag(tag) : tag.trim().replace(/^#/, "")));
  const unique = [...new Set(spelled.filter((tag) => tag !== ""))];
  if (settings.requireTags && unique.length === 0) throw new CaptureError("this vault requires at least one tag");
  const shape =
    settings.tagStyle === "kebab"
      ? /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*(?:\/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)*$/u
      : // Obsidian allows any character in a tag except whitespace and punctuation such as # , . : ; ! ? and brackets;
        // letters, digits, _, -, /, and emoji are all fine.
        /^[^\s#,.:;!?'"`()[\]{}<>|@$%^&*=+~\\]+$/u;
  const rejected = new Set(settings.rejectTags.map((tag) => tag.toLowerCase()));
  for (const tag of unique) {
    // Obsidian requires a tag to contain at least one character that is not a digit.
    if (!shape.test(tag) || /^[\d/]+$/.test(tag)) throw new CaptureError(`"${tag}" is not a valid tag`);
    if (rejected.has(tag.toLowerCase())) throw new CaptureError(`this vault does not allow the tag "${tag}"`);
  }
  return unique;
}

export function captureTitle(input: CaptureInput, settings: CaptureSettings): string {
  const explicit = input.title?.trim();
  const firstLine = input.text
    .split("\n")
    // A heading, quote, or list marker is Markdown syntax, not part of the title.
    .map((line) => line.replace(/^\s*(?:#+|>|[-*+]|\d+[.)])\s+/, "").trim())
    .find((line) => line !== "");
  const raw = (explicit || firstLine || "").replace(/\s+/g, " ");
  if (raw === "") throw new CaptureError("a capture needs text or a title");
  const styled = settings.titleStyle === "lowercase" ? lowercaseTitle(raw, new Set(settings.titleAllow)) : raw;
  // Counted in code points, so the cut never splits an emoji or other astral character in half.
  const chars = [...styled];
  return chars.length > TITLE_LIMIT ? `${chars.slice(0, TITLE_LIMIT).join("").trimEnd()}…` : styled;
}

const pad = (value: number) => String(value).padStart(2, "0");

function fallbackStem(now: Date): string {
  return `capture-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** The file name stem for a title: the title itself as Obsidian names files, or an ASCII kebab-case slug. */
export function fileStem(title: string, filename: "title" | "slug", now: Date): string {
  if (filename === "title") {
    const stem = title
      .replace(UNSAFE_FILENAME, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/, "")
      .slice(0, FILENAME_LIMIT);
    return stem === "" ? fallbackStem(now) : stem;
  }
  return slugTitle(title, now);
}

export function renderCapture(input: CaptureInput, settings: CaptureSettings): { title: string; content: string } {
  const title = captureTitle(input, settings);
  const tags = validTags(input.tags ?? [], settings);
  const source = input.source?.trim();

  const lines: string[] = [];
  // Capture fills these from its own inputs wherever the key comes from: a template or an imported note.
  const own = (key: string): boolean => {
    if (key === "title") lines.push(`title: ${yamlScalar(title)}`);
    else if (key === "tags") {
      if (tags.length > 0) lines.push("tags:", ...tags.map((tag) => `  - ${yamlScalar(tag)}`));
      else if (key in (input.properties ?? {})) lines.push("tags:");
    } else if (key === "source") {
      if (source) lines.push(`source: ${yamlScalar(source)}`);
      else if (key in (input.properties ?? {})) lines.push("source:");
    } else return false;
    return true;
  };
  const declared = new Set(Object.keys(input.properties ?? {}));
  for (const [key, value] of Object.entries(input.properties ?? {})) {
    if (value === undefined || own(key)) continue;
    // An empty property is kept as Obsidian writes it, `key:`, such as a template's blank to fill in later.
    lines.push(value === null ? `${key}:` : stringify({ [key]: value }, { lineWidth: 0 }).trimEnd());
  }
  if (!declared.has("tags") && tags.length > 0) own("tags");
  if (!declared.has("source") && source) own("source");
  const text = input.text.trim();
  const block = lines.length > 0 ? `---\n${lines.join("\n")}\n---\n` : "";
  const content = text === "" ? block : `${block}${block ? "\n" : ""}${text}\n`;

  const { data } = splitFrontmatter(content);
  const wroteTags = declared.has("tags") || tags.length > 0;
  if (
    ("title" in data && data.title !== title) ||
    stringList(data.tags).join("\n") !== (wroteTags ? tags : []).join("\n")
  ) {
    throw new CaptureError("rendered frontmatter did not round-trip");
  }
  return { title, content };
}

function freePath(root: string, folder: string, stem: string, filename: "title" | "slug"): string {
  const separator = filename === "title" ? " " : "-";
  for (let n = 1; ; n++) {
    const path = posix.join(folder, `${n === 1 ? stem : `${stem}${separator}${n}`}.md`);
    if (!existsSync(join(root, path))) return path;
  }
}

/** Create one new note in the capture folder. It never edits an existing file, so it cannot conflict with the owner's work. */
export async function capture(
  root: string,
  input: CaptureInput,
  settings: CaptureSettings,
  options: CaptureOptions = {},
): Promise<CaptureResult> {
  const now = input.now ?? new Date();
  const { title, content } = renderCapture({ ...input, now }, settings);
  const pattern =
    settings.filename === "title" ? "{{title}}" : settings.filename === "slug" ? "{{slug}}" : settings.filename;
  const rendered = renderTemplate(pattern, title, now, {
    folder: "",
    dateFormat: "YYYY-MM-DD",
    timeFormat: "HH:mm",
    source: "default",
  }).replace(/\.md$/i, "");
  const stem = fileStem(rendered, "title", now);
  const path = freePath(root, settings.folder, stem, pattern.includes("{{slug}}") ? "slug" : "title");
  if (options.dryRun) return { path, content, written: false };

  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content, { flag: "wx" });
  return { path, content, written: true };
}

/**
 * Capture input from a whole Markdown document, such as a draft file. Its `title`, `tags`, and `source` properties
 * become capture inputs and every property is kept. Without a `title` property, the title is the first
 * heading, then the file name. The body is unchanged. This parses text only; reading files is the caller's choice.
 */
export function captureInputFromMarkdown(raw: string, fileName?: string): CaptureInput {
  const { data, body } = splitFrontmatter(raw);
  const { title, tags, source } = data;
  const firstLine = body.split("\n").find((line) => line.trim() !== "");
  const heading = firstLine?.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
  const named = fileName ? posix.basename(fileName.replaceAll("\\", "/")).replace(/\.md$/i, "") : undefined;
  return {
    text: body,
    title: (typeof title === "string" && title.trim()) || heading || named,
    tags: stringList(tags),
    source: typeof source === "string" ? source : undefined,
    // Kept whole, so a `title`, `tags`, or `source` the file declares is written even when the settings leave it out.
    properties: data,
  };
}
