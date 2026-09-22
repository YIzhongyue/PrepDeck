// Also shipped inside the standalone converter skill: one catalog for all clients.
import catalog from "../../../skills/pdf-to-quiz/references/pdf-layouts.json" with { type: "json" };
import subjectBCaseSchema from "../../../skills/pdf-to-quiz/references/subject-b-case.schema.json" with { type: "json" };
import { questionImportJsonSchema } from "./import-schema.ts";

export type PdfLayout = (typeof catalog.layouts)[number];
export const pdfLayouts = catalog.layouts;

export function getImportSchemas() {
  return {
    ...catalog,
    importSchema: questionImportJsonSchema,
    caseSchemas: { "ja-sg-subject-b": subjectBCaseSchema },
    workflow: "Extract PDF locally with pdf-to-quiz, review evidence, build schemaVersion 1.0 JSON, then preview and import.",
    importPermission: "admin",
    acceptsPdfUpload: false,
  };
}
