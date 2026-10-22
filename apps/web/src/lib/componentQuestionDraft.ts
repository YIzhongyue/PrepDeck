import { normalizeImportFile, validateImportFile, type ValidationIssue } from "@prepdeck/shared";
import { printParseErrorCode, visit } from "jsonc-parser";
import { duplicateJsonKeyIssues } from "./jsonDuplicateKeys";
import { t } from "../i18n/runtime";

export interface JsonSyntaxDiagnostic {
  message: string;
  line?: number;
  column?: number;
}

export interface ComponentQuestionDraft {
  preview?: ReturnType<typeof normalizeImportFile>["questions"][number];
  issues: ValidationIssue[];
  syntaxError?: JsonSyntaxDiagnostic;
}

// The `authoring.json.syntax` messages, by jsonc-parser error code.
const SYNTAX_CODES = new Set([
  "InvalidSymbol", "InvalidNumberFormat", "PropertyNameExpected", "ValueExpected", "ColonExpected", "CommaExpected",
  "CloseBraceExpected", "CloseBracketExpected", "EndOfFileExpected", "InvalidCommentToken", "UnexpectedEndOfComment",
  "UnexpectedEndOfString", "UnexpectedEndOfNumber", "InvalidUnicode", "InvalidEscapeCharacter", "InvalidCharacter",
] as const);
type SyntaxCode = typeof SYNTAX_CODES extends Set<infer C> ? C : never;
const syntaxMessage = (code: string) => (SYNTAX_CODES as Set<string>).has(code) ? t(`authoring.json.syntax.${code as SyntaxCode}`) : t("authoring.json.invalid");

function locateSyntaxError(text: string): JsonSyntaxDiagnostic {
  let diagnostic: JsonSyntaxDiagnostic | undefined;
  const found = {};
  try {
    // Native JSON.parse has already rejected this text. Use only the first
    // diagnostic, never the tolerant parser's recovered value or edited text.
    visit(text, {
      onError: (code, _offset, _length, startLine, startCharacter) => {
        diagnostic = { message: syntaxMessage(printParseErrorCode(code)), line: startLine + 1, column: startCharacter + 1 };
        throw found;
      }
    }, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  } catch (error) {
    // Very deeply nested malformed JSON can exhaust the diagnostic parser.
    // Keep the draft editable and do not invent a location in that case.
    if (error !== found) return { message: t("authoring.json.unlocated") };
  }
  return diagnostic ?? { message: t("authoring.json.unlocated") };
}

export function inspectComponentQuestionDraft(text: string): ComponentQuestionDraft {
  let data: unknown;
  try { data = JSON.parse(text); }
  catch { return { issues: [], syntaxError: locateSyntaxError(text) }; }

  const duplicateIssues = duplicateJsonKeyIssues(text);
  if (duplicateIssues.length) return { issues: duplicateIssues };

  try {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { issues: validateImportFile(data).issues };
    }
    const packageData = data as Record<string, unknown>;
    // Shared import validation also accepts legacy packages. This editor has
    // always required one component question in a 2.0 package.
    if (packageData.schemaVersion !== "2.0") {
      return { issues: [{ path: "$.schemaVersion", message: t("authoring.json.schemaVersion") }] };
    }
    const issues = [...validateImportFile(data).issues];
    if (Array.isArray(packageData.questions) && packageData.questions.length !== 1) {
      issues.push({ path: "$.questions", message: t("authoring.json.oneQuestion") });
    }
    if (issues.length) return { issues };
    return { issues, preview: normalizeImportFile(data).questions[0] };
  } catch {
    return { issues: [{ path: "$", message: t("authoring.json.validateFailed") }] };
  }
}
