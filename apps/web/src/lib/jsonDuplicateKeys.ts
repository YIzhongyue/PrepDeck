import { visit } from "jsonc-parser";
import type { ValidationIssue } from "@prepdeck/shared";

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
        const location = `line ${line + 1}, column ${column + 1}`;
        const first = keys.get(name);
        if (first) {
          issues.push({ path: "$" + [...path(), name].map(part => typeof part === "number" ? `[${part}]` : `[${JSON.stringify(part)}]`).join(""),
            message: `Duplicate object key ${JSON.stringify(name)} at ${location}; first declared at ${first}. Remove or rename one key before saving.` });
          // Bound diagnostic rendering for highly repetitive documents.
          if (issues.length === 50) throw limit;
        } else keys.set(name, location);
      }
    }, { disallowComments: true, allowTrailingComma: false });
  } catch (error) {
    if (error === limit) issues.push({ path: "$", message: "Only the first 50 duplicate keys are shown. Correct these and check again." });
    else issues.push({ path: "$", message: "Could not check this package for duplicate keys. Reduce its nesting and try again; your source has been kept." });
  }
  return issues;
}
