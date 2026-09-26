/**
 * tsuzuri's prelude: the one public entry, and the whole of the SDK's contract (ADR 0009). `Vault`, the types its
 * methods take and return, the errors, and the helpers the CLI needs; everything else is internal, and the package's
 * `exports` refuses a deep import. A test snapshots this list, so a change to it is always deliberate.
 */

export type { CaptureInput, CaptureOptions, CaptureResult } from "./capture.ts";
export { CaptureError, captureInputFromMarkdown } from "./capture.ts";
export { formatDate } from "./dateformat.ts";
export { ConfigError, InputError, TsuzuriError } from "./errors.ts";
export type { Frontmatter } from "./frontmatter.ts";
export { propertyValue } from "./frontmatter.ts";
export type { GrepHit, GrepLine, GrepOptions } from "./grep.ts";
export { formatGrep } from "./grep.ts";
export type { Resolution } from "./links.ts";
export type {
  AllowRule,
  Extension,
  InputProperty,
  OperationDefinition,
  OperationKind,
  OperationName,
} from "./operations.ts";
export { OPERATION_KINDS, OPERATIONS, PermissionError } from "./operations.ts";
export { SectionError } from "./sections.ts";
export type {
  CaptureSettings,
  TemplateSettings,
  TsuzuriConfig,
  VaultSettings,
} from "./settings.ts";
export { UnsupportedError } from "./settings.ts";
export type { TagCount } from "./tags.ts";
export type {
  CheckResult,
  DeleteResult,
  Filter,
  GetOptions,
  Heading,
  InitResult,
  ListOptions,
  MoveResult,
  NavEntry,
  NavView,
  Note,
  NoteContent,
  NoteSummary,
  OpenOptions,
  OutgoingLink,
  SearchHit,
  SectionWriteOptions,
  SkippedExtension,
  Suggestion,
  TypeInfo,
  VaultOptions,
} from "./vault.ts";
export { LineRangeError, NotFoundError, SORT_KEYS, Vault } from "./vault.ts";
export type { WriteOptions, WriteResult } from "./write.ts";
export { WriteConflictError } from "./write.ts";
