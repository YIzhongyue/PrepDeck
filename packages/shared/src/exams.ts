// Exam fields shared by the Admin UI's exam forms and the Worker routes and
// Admin MCP tools that store them (docs/requirements/question-bank-management.md, FR-2.1).

/** An exam slug: lowercase letters and digits in hyphen-separated groups, e.g. aws-sap-c02. */
export const EXAM_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
