import { questionImportJsonSchema } from "./import-schema.ts";
import { componentImportSchema, componentCapabilities } from "./question-components.ts";

// Discovery describes the question contract, independent of PDF providers.
export function getImportSchemas() {
  return {
    version: "2.0", importSchema: questionImportJsonSchema, componentImportSchema,
    capabilities: componentCapabilities,
    workflow: "Prepare native or scanned documents locally, review source evidence, then preview and import JSON through the same Web UI or MCP services.",
    importPermission: "admin", acceptsPdfUpload: false,
  };
}
