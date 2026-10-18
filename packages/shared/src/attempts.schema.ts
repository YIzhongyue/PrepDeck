// Request bodies for a mock attempt's draft answers and review flags (PUT
// /api/attempts/:id/answers/:questionId and /flags/:questionId). See
// attempts.ts. Starting an attempt and answering in practice are checked by
// the Worker's attempt mutations, which User MCP shares.

import { z } from "zod";

const SELECTED_ANSWER = "selectedAnswer is required";

export const saveDraftAnswerRequestSchema = z.object({
  // Not merely "an array": a non-string element survives the draft write and
  // then throws inside grading at submission, leaving an attempt that cannot be
  // completed at all. The size limits are checked by the route (answerSizeProblem).
  selectedAnswer: z.array(z.string("selectedAnswer must be an array of strings"), SELECTED_ANSWER),
}, SELECTED_ANSWER);

export const saveFlagRequestSchema = z.object({
  flagged: z.boolean("flagged is required"),
}, "flagged is required");
