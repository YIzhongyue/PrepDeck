// Synthetic study material, unrelated to any licensed exam PDF.
import { readFileSync } from "node:fs";
const asset = id => ({ id, mediaType: "image/png", data: readFileSync(new URL(`${id}.png`, import.meta.url)).toString("base64") });
export const paragraph = (id, text) => ({ id, type: "paragraph", text });
export function componentQuestion() {
  return {
    version: "1.0",
    stimuli: [{ id: "case", revision: 1, body: [
      paragraph("background", "Example Company reviews backup risks. Read all the material before choosing an action."),
      { id: "risk", type: "figure", assetId: "boxed-risk", caption: "Figure 1 — Risk register (excerpt)", alt: "A boxed risk register with four numbered entries; entries 2–4 are omitted in the source." },
      { id: "settings", type: "table", caption: "Table 1 — Current settings", columns: ["System", "Interval", "Retention"], rows: [["Primary | A", "7 days", "2 generations"], ["Archive", "24 hours", "7 generations"], ["Literal <tag>", "Line 1\nLine 2", ""]] },
      { id: "flow", type: "figure", assetId: "response-flow", caption: "Figure 2 — Review flow", alt: "Review leads to a decision; the Yes arrow leads to Update, the No arrow to Retain." },
    ] }],
    assets: [asset("boxed-risk"), asset("response-flow")],
    body: [
      paragraph("prompt", "Which combination follows the procedure? Preserve the blank __ and the source's 省略."),
      { id: "code", type: "code", language: "python", text: 'if changed:\n    print("```", "__")\nelse:\n    retain()' },
      { id: "actions", type: "list", entries: [{ id: "i", text: "Review interval" }, { id: "ii", text: "Review retention" }, { id: "iii", text: "Review media" }] },
    ],
    interaction: { id: "response", type: "choice", multiple: false, options: [{ id: "ア", memberRefs: ["i", "ii"] }, { id: "イ", memberRefs: ["ii", "iii"] }] },
  };
}
export function presentationRow(content = componentQuestion()) {
  return { id: "question-synthetic", exam_id: "exam-synthetic", revision: 7, type: "single_choice",
    stem: "FLATTENED_PROJECTION_MUST_NOT_BE_SHOWN", options_json: JSON.stringify([{ id: "bad", text: "FLATTENED_OPTION" }]),
    content_json: JSON.stringify(content), correct_answers_json: '["ANSWER_KEY_SENTINEL"]',
    explanation: "EXPLANATION_SENTINEL", annotations: "ANNOTATION_SENTINEL", import_baseline_json: "BASELINE_SENTINEL" };
}
