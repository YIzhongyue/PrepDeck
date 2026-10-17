import { normalizeImportFile, validateImportFile, type ValidationIssue } from "@prepdeck/shared";
import { printParseErrorCode, visit } from "jsonc-parser";
import { duplicateJsonKeyIssues } from "./jsonDuplicateKeys";

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

const syntaxMessages: Record<string, string> = {
  InvalidSymbol: "Unexpected symbol. Use a JSON value or punctuation.",
  InvalidNumberFormat: "Invalid JSON number.",
  PropertyNameExpected: "Expected a double-quoted property name.",
  ValueExpected: "Expected a JSON value.",
  ColonExpected: "Expected a colon after the property name.",
  CommaExpected: "Expected a comma between values or properties.",
  CloseBraceExpected: "Expected a closing brace (}).",
  CloseBracketExpected: "Expected a closing bracket (]).",
  EndOfFileExpected: "Unexpected content after the JSON value.",
  InvalidCommentToken: "Comments are not allowed in JSON.",
  UnexpectedEndOfComment: "Comments are not allowed in JSON.",
  UnexpectedEndOfString: "This string is missing its closing double quote.",
  UnexpectedEndOfNumber: "This number is incomplete.",
  InvalidUnicode: "This string contains an invalid Unicode escape.",
  InvalidEscapeCharacter: "This string contains an invalid escape sequence.",
  InvalidCharacter: "This string contains an unescaped control character."
};

function locateSyntaxError(text: string): JsonSyntaxDiagnostic {
  let diagnostic: JsonSyntaxDiagnostic | undefined;
  const found = {};
  try {
    // Native JSON.parse has already rejected this text. Use only the first
    // diagnostic, never the tolerant parser's recovered value or edited text.
    visit(text, {
      onError: (code, _offset, _length, startLine, startCharacter) => {
        diagnostic = { message: syntaxMessages[printParseErrorCode(code)] ?? "Invalid JSON syntax.", line: startLine + 1, column: startCharacter + 1 };
        throw found;
      }
    }, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  } catch (error) {
    // Very deeply nested malformed JSON can exhaust the diagnostic parser.
    // Keep the draft editable and do not invent a location in that case.
    if (error !== found) return { message: "Check the JSON syntax; its error location could not be determined." };
  }
  return diagnostic ?? { message: "Check the JSON syntax; its error location could not be determined." };
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
      return { issues: [{ path: "$.schemaVersion", message: 'must be "2.0"' }] };
    }
    const issues = [...validateImportFile(data).issues];
    if (Array.isArray(packageData.questions) && packageData.questions.length !== 1) {
      issues.push({ path: "$.questions", message: "must contain exactly one question in this editor" });
    }
    if (issues.length) return { issues };
    return { issues, preview: normalizeImportFile(data).questions[0] };
  } catch {
    return { issues: [{ path: "$", message: "Could not validate this package. Check its structure and try again." }] };
  }
}
