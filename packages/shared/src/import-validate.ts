import { validateComponentPackage, normalizeImportFile, validateQuestionContent } from "./question-components.ts";
import type { QuestionImportRow } from "./import-schema.ts";
// Validation for the Question Import JSON Schema (docs/requirements/data-model-and-import-format.md#import-contract) and for
// individual question rows (also reused when editing a single question — FR-2.3).
// Hand-rolled rather than a generic JSON-Schema validator so error messages can
// point at the exact row/field an Admin needs to fix (FR-2.2).

const VALID_TYPES: string[] = ["single_choice", "multiple_choice", "true_false", "fill_blank", "ordering", "matching"];
const CHOICE_BASED_TYPES: string[] = ["single_choice", "multiple_choice", "true_false", "ordering"];
const VALID_DIFFICULTIES: string[] = ["easy", "medium", "hard"];

// These limits are deliberately exported so the Worker and companion tooling
// can advertise/test the exact same import contract.
export const IMPORT_LIMITS = {
  maxQuestions: 1_000,
  maxStemLength: 20_000,
  maxOptionTextLength: 10_000,
  maxOptions: 20,
  maxTags: 50,
  maxTagLength: 200,
  maxExplanationLength: 50_000,
  // Points must be greater than 0 and at most this. Fractions are allowed.
  maxPoints: 100,
} as const;

function nonempty(value: unknown): value is string {
  return typeof value === "string" && /[^\s\u0085\u001c-\u001f\ufeff]/.test(value);
}

function validTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1]!
    && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60
    && Number(offsetHour ?? 0) < 24 && Number(offsetMinute ?? 0) < 60;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateQuestionRow(row: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return [{ path, message: "must be an object" }];
  }
  const r = row as Record<string, unknown>;

  if (typeof r.type !== "string" || !VALID_TYPES.includes(r.type)) {
    issues.push({ path: `${path}.type`, message: `must be one of ${VALID_TYPES.join(", ")}` });
  }
  const type = typeof r.type === "string" ? r.type : undefined;
  const isChoiceBased = !!type && CHOICE_BASED_TYPES.includes(type);

  if (!nonempty(r.stem)) {
    issues.push({ path: `${path}.stem`, message: "must be a non-empty string" });
  } else if (r.stem.length > IMPORT_LIMITS.maxStemLength) {
    issues.push({ path: `${path}.stem`, message: `must be at most ${IMPORT_LIMITS.maxStemLength} characters` });
  }

  if (r.externalId !== undefined && !nonempty(r.externalId)) {
    issues.push({ path: `${path}.externalId`, message: "must be a non-empty string" });
  }

  let optionIds: Set<string> | null = null;
  if (isChoiceBased) {
    if (!Array.isArray(r.options) || r.options.length === 0) {
      issues.push({ path: `${path}.options`, message: `required for type "${type}"` });
    } else {
      // One option is not a question: its only choice is always correct, which
      // inflates accuracy and readiness (issue #54). multiple_choice already
      // needs two correct answers, and true_false exactly two options.
      if (type === "single_choice" && r.options.length < 2) {
        issues.push({ path: `${path}.options`, message: "single_choice requires at least two options" });
      }
      if (r.options.length > IMPORT_LIMITS.maxOptions) {
        issues.push({ path: `${path}.options`, message: `must contain at most ${IMPORT_LIMITS.maxOptions} options` });
      }
      optionIds = new Set();
      // Once the count limit is exceeded, inspecting the permitted prefix is
      // enough to report useful row errors without amplifying issue output.
      r.options.slice(0, IMPORT_LIMITS.maxOptions).forEach((opt: unknown, i: number) => {
        if (
          typeof opt !== "object" ||
          opt === null ||
          Array.isArray(opt) ||
          !nonempty((opt as Record<string, unknown>).id) ||
          !nonempty((opt as Record<string, unknown>).text)
        ) {
          issues.push({ path: `${path}.options[${i}]`, message: "id and text must be non-empty strings" });
          return;
        }
        const id = (opt as Record<string, unknown>).id as string;
        const optionText = (opt as Record<string, unknown>).text as string;
        if (optionText.length > IMPORT_LIMITS.maxOptionTextLength) {
          issues.push({
            path: `${path}.options[${i}].text`,
            message: `must be at most ${IMPORT_LIMITS.maxOptionTextLength} characters`,
          });
        }
        if (optionIds!.has(id)) {
          issues.push({ path: `${path}.options[${i}].id`, message: `duplicate option id "${id}"` });
        }
        optionIds!.add(id);
      });
    }
  } else if (type === "fill_blank" && r.options !== undefined) {
    issues.push({ path: `${path}.options`, message: 'must be omitted for type "fill_blank"' });
  }

  if (!Array.isArray(r.correctAnswers) || r.correctAnswers.length === 0) {
    issues.push({ path: `${path}.correctAnswers`, message: "must be a non-empty array" });
  } else {
    r.correctAnswers.forEach((ans: unknown, i: number) => {
      if (!nonempty(ans)) {
        issues.push({ path: `${path}.correctAnswers[${i}]`, message: "must be a non-empty string" });
        return;
      }
      if (isChoiceBased && optionIds && !optionIds.has(ans)) {
        issues.push({ path: `${path}.correctAnswers[${i}]`, message: `"${ans}" does not match any options[].id` });
      }
      if (type === "true_false" && ans !== "true" && ans !== "false") {
        issues.push({ path: `${path}.correctAnswers[${i}]`, message: 'must be "true" or "false"' });
      }
    });
    if (new Set(r.correctAnswers).size !== r.correctAnswers.length) {
      issues.push({ path: `${path}.correctAnswers`, message: "must not contain duplicates" });
    }
    if ((type === "single_choice" || type === "true_false") && r.correctAnswers.length !== 1) {
      issues.push({ path: `${path}.correctAnswers`, message: `${type} requires exactly one answer` });
    }
    if (type === "multiple_choice" && r.correctAnswers.length < 2) {
      issues.push({ path: `${path}.correctAnswers`, message: "multiple_choice requires at least two answers" });
    }
  }
  if (type === "true_false" && (!optionIds || optionIds.size !== 2 || !optionIds.has("true") || !optionIds.has("false"))) {
    issues.push({ path: `${path}.options`, message: 'true_false requires exactly ids "true" and "false"' });
  }

  if (r.explanation !== undefined && r.explanation !== null && typeof r.explanation !== "string") {
    issues.push({ path: `${path}.explanation`, message: "must be a string or null" });
  } else if (typeof r.explanation === "string" && r.explanation.length > IMPORT_LIMITS.maxExplanationLength) {
    issues.push({
      path: `${path}.explanation`,
      message: `must be at most ${IMPORT_LIMITS.maxExplanationLength} characters`,
    });
  }

  if (r.difficulty !== undefined && r.difficulty !== null) {
    if (typeof r.difficulty !== "string" || !VALID_DIFFICULTIES.includes(r.difficulty)) {
      issues.push({ path: `${path}.difficulty`, message: `must be one of ${VALID_DIFFICULTIES.join(", ")}, or null` });
    }
  }

  if (r.tags !== undefined) {
    if (!Array.isArray(r.tags) || r.tags.some((t) => typeof t !== "string")) {
      issues.push({ path: `${path}.tags`, message: "must be an array of strings" });
    } else {
      if (r.tags.length > IMPORT_LIMITS.maxTags) {
        issues.push({ path: `${path}.tags`, message: `must contain at most ${IMPORT_LIMITS.maxTags} tags` });
      }
      r.tags.slice(0, IMPORT_LIMITS.maxTags).forEach((tag, i) => {
        if (tag.length > IMPORT_LIMITS.maxTagLength) {
          issues.push({
            path: `${path}.tags[${i}]`,
            message: `must be at most ${IMPORT_LIMITS.maxTagLength} characters`,
          });
        }
      });
    }
  }

  // Review state is a plain flag, not a tag (issue #15). Omitting it means
  // "does not need review"; null is not accepted, so a producer that cannot
  // decide leaves the field out rather than guessing.
  if (r.needsReview !== undefined && typeof r.needsReview !== "boolean") {
    issues.push({ path: `${path}.needsReview`, message: "must be a boolean" });
  }

  // Scores count correct answers today, but points are shown in the catalog
  // and editor, and a weighted score would inherit whatever is stored here.
  if (r.points !== undefined && (typeof r.points !== "number" || !Number.isFinite(r.points) || r.points <= 0 || r.points > IMPORT_LIMITS.maxPoints)) {
    issues.push({ path: `${path}.points`, message: `must be a number greater than 0 and at most ${IMPORT_LIMITS.maxPoints}` });
  }

  if (r.type === "ordering" && optionIds && Array.isArray(r.correctAnswers) && r.correctAnswers.length !== optionIds.size) issues.push({ path, message: "ordering requires every option exactly once" });
  if ((r.type === "ordering" || r.type === "matching") && !r.content) issues.push({ path, message: "this interaction requires component content" });
  if (r.content !== undefined) issues.push(...validateQuestionContent(r.content, r as unknown as QuestionImportRow).map(i => ({ ...i, path: path + i.path.slice(1) })));
  return issues;
}

export interface ImportFileValidationResult {
  issues: ValidationIssue[];
  duplicateExternalIdsInFile: string[];
  questionCount: number;
}

export function validateImportFile(data: unknown): ImportFileValidationResult {
  return validateImportEnvelope(data);
}

function validateImportEnvelope(data: unknown, normalized = false): ImportFileValidationResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { issues: [{ path: "$", message: "must be an object" }], duplicateExternalIdsInFile: [], questionCount: 0 };
  }
  if ((data as Record<string, unknown>).schemaVersion === "2.0") {
    const issues = validateComponentPackage(data);
    if (issues.length) return { issues, duplicateExternalIdsInFile: [], questionCount: Array.isArray((data as any).questions) ? (data as any).questions.length : 0 };
    return validateImportEnvelope(normalizeImportFile(data), true);
  }
  const d = data as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  if (d.schemaVersion !== "1.0") {
    issues.push({ path: "$.schemaVersion", message: 'must be "1.0"' });
  }

  if (typeof d.exam !== "object" || d.exam === null || Array.isArray(d.exam)) {
    issues.push({ path: "$.exam", message: "is required" });
  } else {
    const exam = d.exam as Record<string, unknown>;
    if (!nonempty(exam.id)) {
      issues.push({ path: "$.exam.id", message: "must be a non-empty string" });
    }
    if (!nonempty(exam.name)) {
      issues.push({ path: "$.exam.name", message: "must be a non-empty string" });
    }
    for (const field of ["subject", "language"]) {
      if (exam[field] !== undefined && typeof exam[field] !== "string") {
        issues.push({ path: `$.exam.${field}`, message: "must be a string" });
      }
    }
  }
  if (d.source !== undefined) {
    if (typeof d.source !== "object" || d.source === null || Array.isArray(d.source)) {
      issues.push({ path: "$.source", message: "must be an object" });
    } else {
      const source = d.source as Record<string, unknown>;
      for (const field of ["originalFileName", "extractedBy", "extractedAt"]) {
        if (source[field] !== undefined && typeof source[field] !== "string") {
          issues.push({ path: `$.source.${field}`, message: "must be a string" });
        }
      }
      if (typeof source.extractedAt === "string" && !validTimestamp(source.extractedAt)) {
        issues.push({ path: "$.source.extractedAt", message: "must be an RFC 3339 date-time" });
      }
    }
  }

  const duplicateExternalIdsInFile: string[] = [];
  let questionCount = 0;

  if (!Array.isArray(d.questions) || d.questions.length === 0) {
    issues.push({ path: "$.questions", message: "must be a non-empty array" });
  } else {
    questionCount = d.questions.length;
    if (questionCount > IMPORT_LIMITS.maxQuestions) {
      issues.push({
        path: "$.questions",
        message: `must contain at most ${IMPORT_LIMITS.maxQuestions} questions`,
      });
      // Do not walk an attacker-controlled, unbounded array after recording
      // the file-level error. The request will be rejected regardless.
      return { issues, duplicateExternalIdsInFile, questionCount };
    }
    const seen = new Map<string, number>();
    d.questions.forEach((q, i) => {
      if (!normalized && q && typeof q === "object" && ("content" in q || q.type === "ordering" || q.type === "matching")) issues.push({ path: `$.questions[${i}]`, message: "structured content requires schemaVersion 2.0" });
      issues.push(...validateQuestionRow(q, `$.questions[${i}]`));
      const extId = typeof q === "object" && q !== null ? (q as Record<string, unknown>).externalId : undefined;
      if (typeof extId === "string" && extId) {
        if (seen.has(extId)) issues.push({ path: `$.questions[${i}].externalId`, message: `duplicate "${extId}" within file` });
        seen.set(extId, (seen.get(extId) ?? 0) + 1);
      }
    });
    for (const [id, count] of seen) {
      if (count > 1) duplicateExternalIdsInFile.push(id);
    }
  }

  return { issues, duplicateExternalIdsInFile, questionCount };
}
