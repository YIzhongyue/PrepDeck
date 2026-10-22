import { visit } from "jsonc-parser";
import type { ValidationIssue } from "@prepdeck/shared";
import { t } from "../i18n/runtime";

// Called only after strict JSON.parse succeeds. Decoded names are compared
// within each object, including unknown fields; no parsed winner is returned.
export function duplicateJsonKeyIssues(text: string): ValidationIssue[] {
  const objects: Map<string, string>[] = [];
  const issues: ValidationIssue[] = [];
  const limit = {};
  try {
    visit(text, {
      onObjectBegin: () => { objects.push(new Map()); },
      onObjectEnd: () => { objects.pop(); },
      onObjectProperty: (name, _offset, _length, line, column, path) => {
        const keys = objects.at(-1)!;
        const location = t("authoring.json.location", { line: String(line + 1), column: String(column + 1) });
        const first = keys.get(name);
        if (first) {
          issues.push({ path: "$" + [...path(), name].map(part => typeof part === "number" ? `[${part}]` : `[${JSON.stringify(part)}]`).join(""),
            message: t("authoring.json.duplicateKey", { name: JSON.stringify(name), location, first }) });
          // Bound diagnostic rendering for highly repetitive documents.
          if (issues.length === 50) throw limit;
        } else keys.set(name, location);
      }
    }, { disallowComments: true, allowTrailingComma: false });
  } catch (error) {
    if (error === limit) issues.push({ path: "$", message: t("authoring.json.duplicateLimit") });
    else issues.push({ path: "$", message: t("authoring.json.duplicateFailed") });
  }
  return issues;
}
