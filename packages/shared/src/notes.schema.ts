// Request bodies for the Question Notes API (docs/requirements/review-notes-and-annotations.md).
// See notes.ts for the response DTOs and MAX_NOTE_LENGTH.

import { z } from "zod";
import { MAX_NOTE_LENGTH } from "./notes.ts";

const TOO_LONG = `content must be ${MAX_NOTE_LENGTH.toLocaleString("en")} characters or fewer`;
const VISIBILITY = "visibility must be private or shared";

// Content is stored, and its length checked, trimmed.

// POST /api/questions/:questionId/notes.
export const createNoteRequestSchema = z.object({
  content: z.string("content is required").trim().min(1, "content is required").max(MAX_NOTE_LENGTH, TOO_LONG),
  visibility: z.enum(["private", "shared"], VISIBILITY),
}, "Invalid JSON body");

// PATCH /api/notes/:id. An omitted or null field keeps its current value.
export const updateNoteRequestSchema = z.object({
  content: z.string("content must be a non-empty string").trim()
    .min(1, "content must be a non-empty string").max(MAX_NOTE_LENGTH, TOO_LONG).nullish(),
  visibility: z.enum(["private", "shared"], VISIBILITY).nullish(),
}, "Invalid JSON body");
