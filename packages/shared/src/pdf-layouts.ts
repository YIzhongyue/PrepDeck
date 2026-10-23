import { questionImportJsonSchema } from "./import-schema.ts";
import { componentImportSchema, componentCapabilities } from "./question-components.ts";

// Shared advice for discovery and question-add/import tool descriptions.
export const QUESTION_IMPORT_GUIDANCE = "For plain-text single_choice or multiple_choice questions with no tables, charts, diagrams or images, prefer the existing Markdown-compatible representation when it preserves the complete content and answer structure faithfully. For imports, use schemaVersion 1.0 with Markdown in question text inside the required JSON envelope, retaining exam metadata and required fields; do not send a raw .md file. For direct question creation, keep the discovered JSON payload schema. Preserve source wording, option IDs/labels/order, correct-answer mappings, explanations and required metadata. For visual/structured content, other question types or any content this representation cannot preserve reliably, use the appropriate existing supported format, including 2.0 components; never discard content to fit Markdown. This is format-selection advice only: retain validation, preview, approval, conflict handling, revision checks and replay safeguards.";

// Discovery describes the question contract, independent of PDF providers.
export function getImportSchemas() {
  return {
    version: "2.0", importSchema: questionImportJsonSchema, componentImportSchema,
    capabilities: componentCapabilities,
    workflow: "Prepare native or scanned documents locally, review source evidence, then preview and import JSON through the same Web UI or MCP services. " + QUESTION_IMPORT_GUIDANCE,
    importPermission: "admin", acceptsPdfUpload: false,
  };
}
