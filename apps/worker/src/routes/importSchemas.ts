import { getImportSchemas } from "@prepdeck/shared";
import { createRouter } from "../context";

// Read-only discovery for any authenticated user. Import mutations remain admin-only.
export const importSchemasRouter = createRouter();
importSchemasRouter.get("/", (c) => c.json(getImportSchemas()));
