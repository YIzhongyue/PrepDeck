// Request bodies for exam management (POST and PATCH /api/exams, FR-2.1),
// and the official mock format check Admin MCP's exam tools share with them.

import { z } from "zod";
import { MAX_ATTEMPT_QUESTIONS } from "./attempts.ts";
import { MAX_MOCK_MINUTES } from "./examFormat.ts";
import { EXAM_SLUG_PATTERN } from "./exams.ts";

const SLUG = "slug must be lowercase alphanumeric segments separated by hyphens";
const QUESTION_COUNT = `officialFormat.questionCount must be a whole number from 1 to ${MAX_ATTEMPT_QUESTIONS}`;
const TIME_LIMIT = `officialFormat.timeLimitMinutes must be a whole number from 1 to ${MAX_MOCK_MINUTES}`;
const PASS_CORRECT = "officialFormat.passCorrectCount must be a whole number from 1 to questionCount";
const PASS_MARK = "passMarkPct must be a number from 0 to 100, or null";
const SLUG_AND_NAME = "slug and name are required";

/** An exam's official mock format (see examFormat.ts); null clears it. */
export const officialFormatSchema = z.object({
  questionCount: z.int(QUESTION_COUNT).min(1, QUESTION_COUNT).max(MAX_ATTEMPT_QUESTIONS, QUESTION_COUNT),
  timeLimitMinutes: z.int(TIME_LIMIT).min(1, TIME_LIMIT).max(MAX_MOCK_MINUTES, TIME_LIMIT),
  passCorrectCount: z.int(PASS_CORRECT).min(1, PASS_CORRECT),
}, "officialFormat must be an object or null").refine(
  (format) => format.passCorrectCount <= format.questionCount,
  { message: PASS_CORRECT, path: ["passCorrectCount"] },
).nullable();

// Same limits as Admin MCP's exam tools (mcp/admin/server.ts), so the Admin
// UI's metadata form and an MCP client are refused for the same inputs. Text
// fields other than slug and name may be null, which clears them.
const slug = z.string(SLUG).regex(EXAM_SLUG_PATTERN, SLUG);
const name = z.string("name must be a string")
  .refine((value) => value.trim() !== "", "name cannot be empty")
  .max(200, "name must be at most 200 characters");
const text = (field: string, max: number) => z.string(`${field} must be a string`)
  .max(max, `${field} must be at most ${max} characters`).nullable().optional();
const optionalFields = {
  subject: text("subject", 200),
  description: text("description", 2000),
  language: text("language", 50),
  passMarkPct: z.number(PASS_MARK).min(0, PASS_MARK).max(100, PASS_MARK).nullable().optional(),
  /** Written as its three columns together; null clears all three. */
  officialFormat: officialFormatSchema.optional(),
};

const createExamFieldsSchema = z.object({ slug, name, ...optionalFields });

// POST /api/exams. A missing or empty slug or name is refused before any
// field is checked.
export const createExamRequestSchema = z.looseObject({ slug: z.unknown().optional(), name: z.unknown().optional() }, SLUG_AND_NAME)
  .refine((body) => !!body.slug && !!body.name, SLUG_AND_NAME)
  .pipe(createExamFieldsSchema);

// PATCH /api/exams/:id. Only the fields sent are changed.
export const updateExamRequestSchema = z.object({
  slug: slug.optional(),
  name: name.optional(),
  ...optionalFields,
}, "Invalid JSON body");

export type CreateExamRequest = z.input<typeof createExamFieldsSchema>;
