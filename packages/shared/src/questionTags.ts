import { IMPORT_LIMITS } from "./import-validate.ts";

export interface QuestionTagsResponse {
  tags: string[];
}

const MAX_TAG_NAME_LENGTH = IMPORT_LIMITS.maxTagLength;

// Question-bank tags have their own identity and length limit, separate
// from personal Knowledge Point tags. Keep this ASCII-only whitespace
// normalization in sync with migration 0026_question_tag_links.sql:
// Unicode whitespace such as NBSP and U+3000 is an ordinary character.
const ASCII_WHITESPACE_RE = /[ \t\n\r]+/g;
const LEADING_ASCII_WHITESPACE_RE = /^[ \t\n\r]+/;
const TRAILING_ASCII_WHITESPACE_RE = /[ \t\n\r]+$/;

function trimAsciiWhitespace(value: string): string {
  return value.replace(LEADING_ASCII_WHITESPACE_RE, "").replace(TRAILING_ASCII_WHITESPACE_RE, "");
}

export function normalizeTagName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let name = trimAsciiWhitespace(raw);
  if (name.startsWith("#")) name = trimAsciiWhitespace(name.slice(1));
  name = name.replace(ASCII_WHITESPACE_RE, " ");
  if (!name || name.length > MAX_TAG_NAME_LENGTH) return null;
  return name;
}

// Call after normalizeTagName; display spelling is preserved separately.
export function normalizeTagKey(name: string): string {
  return name.toLowerCase();
}
