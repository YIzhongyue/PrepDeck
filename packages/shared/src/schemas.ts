// Zod schemas for the JSON request bodies the web app sends and the Worker
// validates, imported as "@prepdeck/shared/schemas". The request types in
// index.ts are inferred from these, so the client and the server share one
// definition; the schemas themselves stay out of index.ts so the web bundle
// does not take on zod.
//
// Each schema sets its own messages, including its root object's for a body
// that is missing or not an object: the Worker answers a failure with the
// first issue's message (apps/worker/src/lib/requestBody.ts), and these are
// the messages the routes returned before the schemas existed, which the web
// client and the browser tests show and assert.
export * from "./ai.schema.ts";
export * from "./annotations.schema.ts";
export * from "./annotationSettings.schema.ts";
export * from "./attempts.schema.ts";
export * from "./dailyEmailSettings.schema.ts";
export * from "./examPreferences.schema.ts";
export * from "./knowledgePoints.schema.ts";
export * from "./mcp.schema.ts";
export * from "./notes.schema.ts";
export * from "./profile.schema.ts";
export * from "./settings.schema.ts";
