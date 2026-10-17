// Entirely synthetic; source coordinates refer to an invented document.
const source = { documentId: "synthetic-only", page: 1, bbox: [10, 20, 100, 40] };
const paragraph = (id, text) => ({ id, type: "paragraph", format: "markdown", text });
const option = (id, text) => ({ id, body: [paragraph(`body-${id}`, text)] });
const common = {
  schemaVersion: "2.0", exam: { id: "discovery", name: "Synthetic authoring discovery" },
  source: { originalFileName: "invented-example.pdf", extractedBy: "handwritten fixture" },
  assets: [{ id: "pixel", mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" }],
  stimuli: [{ id: "shared-material", revision: 7, body: [
    { id: "context", type: "paragraph", text: "Synthetic material retained verbatim.", sources: [source] },
    { id: "reference-list", type: "list", entries: [{ id: "entry-a", text: "Read **the rule**" }, { id: "entry-b", text: "Check the result" }] },
    { id: "reference-table", type: "table", caption: "Synthetic schedule", columns: ["Step", "Value"], rows: [["Read", "1"], ["Check", "2"]] },
    { id: "reference-code", type: "code", language: "text", text: "read()\n  check()" },
    { id: "reference-figure", type: "figure", assetId: "pixel", alt: "Synthetic single pixel", caption: "Retained image bytes" }
  ] }]
};
const item = {
  externalId: "synthetic-155", stimulusRefs: ["shared-material"],
  body: [paragraph("prompt", "Arrange the synthetic steps. Literal <script> text stays text.")],
  explanation: "Original **official explanation**.", tags: ["Synthetic"], difficulty: null, needsReview: true, points: 1
};
export const orderPackage = { ...common, questions: [{ ...item,
  interaction: { id: "response-order", type: "order", options: [
    { id: "read", memberRefs: ["entry-a"] }, option("act", "Perform `the step`"), { id: "check", memberRefs: ["entry-b"] }
  ] }, scoring: { method: "exact", correctAnswers: ["read", "act", "check"] }
}] };
export const matchPackage = { ...common, questions: [{ ...item, externalId: "synthetic-match-155",
  body: [paragraph("prompt", "Match each synthetic entry to its category. Repeated right targets are allowed.")],
  interaction: { id: "response-match", type: "match", left: [option("same", "First entry"), option("second", "Second entry")],
    right: [option("same", "Shared category"), option("other", "Other category")] },
  scoring: { method: "exact", correctAnswers: ['["second","same"]', '["same","same"]'] }
}] };
// Block IDs must be unique across both matching columns even when option IDs
// overlap legally between the left and right namespaces.
matchPackage.questions[0].interaction.right[0].body[0].id = "right-body-same";
const encode = value => JSON.stringify(value, null, 2).replace('"points": 1', '"points": 1.0000').replaceAll("\n", "\r\n") + "\r\n";
export const fixtures = {
  ordering: encode(orderPackage), matching: encode(matchPackage),
  unsupported: encode({ ...orderPackage, schemaVersion: "3.0", futureMetadata: { exactNumber: "9007199254740993", keep: true } }),
  duplicate: encode(orderPackage).replace('"points": 1.0000', '"points": 1.0000, "points": 2e0'),
  invalid: encode(orderPackage).replace('"read",\r\n', '"unknown",\r\n')
};
