declare const atob: (value: string) => string;
declare const btoa: (value: string) => string;
import { Validator, type Schema } from "@cfworker/json-schema";
import schema from "../../../skills/pdf-to-quiz/references/component-import.schema.json" with { type: "json" };
import type { QuestionImportFile, QuestionImportRow } from "./import-schema.ts";
import type { ValidationIssue } from "./import-validate.ts";

export const componentImportSchema = schema;
export interface SourceRef { documentId: string; page: number; bbox?: number[] | null }
type BlockBase = { id: string; sources?: SourceRef[] };
export type ContentBlock = BlockBase & (
  | { type: "paragraph"; text: string; format?: "plain" | "markdown" }
  | { type: "heading"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "list"; entries: { id: string; text: string }[] }
  | { type: "table"; caption?: string; columns: string[]; rows: string[][] }
  | { type: "figure"; assetId: string; alt: string; caption?: string }
);
export interface ContentAsset { id: string; mediaType: "image/png" | "image/jpeg" | "image/webp"; data: string }
export interface Stimulus { id: string; revision: number; body: ContentBlock[] }
export interface ComponentOption { id: string; body?: ContentBlock[]; memberRefs?: string[] }
export type Interaction = { id: string } & (
  | { type: "choice"; multiple: boolean; variant?: "true_false"; options: ComponentOption[] }
  | { type: "text" }
  | { type: "order"; options: ComponentOption[] }
  | { type: "match"; left: ComponentOption[]; right: ComponentOption[] }
);
export interface ComponentItem {
  externalId: string; body: ContentBlock[]; stimulusRefs?: string[]; interaction: Interaction;
  scoring: { method: "exact"; correctAnswers: string[] };
  explanation?: string | null; tags?: string[]; difficulty?: "easy" | "medium" | "hard" | null; needsReview?: boolean; points?: number;
}
export interface ComponentPackage {
  schemaVersion: "2.0"; exam: QuestionImportFile["exam"]; source?: QuestionImportFile["source"];
  assets?: ContentAsset[]; stimuli?: Stimulus[]; questions: ComponentItem[];
}
// A resolved, immutable per-question snapshot. No answer keys or explanations.
// Sharing is explicit in stimulus id/revision; updating one item cannot silently
// change another item's material or its historical answer context.
export interface QuestionContentModel {
  version: "1.0"; body: ContentBlock[]; stimuli: Stimulus[]; assets: ContentAsset[]; interaction: Interaction;
}
const validator = new Validator(schema as Schema, "7");
// Validate the answer-free snapshot without reading or manufacturing scoring.
// Reference/asset integrity is checked separately by the consumer so it can
// report missing visual material instead of silently using a text projection.
const contentStructureValidator = new Validator({
  type: "object", additionalProperties: false,
  required: ["version", "body", "stimuli", "assets", "interaction"],
  properties: {
    version: { const: "1.0" },
    body: { type: "array", items: { $ref: "#/definitions/block" }, minItems: 1, maxItems: 100 },
    stimuli: schema.properties.stimuli, assets: schema.properties.assets,
    interaction: { $ref: "#/definitions/interaction" },
  }, definitions: schema.definitions,
} as Schema, "7");
export function isQuestionContentStructure(value: unknown): value is QuestionContentModel {
  try { return contentStructureValidator.validate(value).valid; } catch { return false; }
}
export const componentCapabilities = {
  importVersions: ["1.0", "2.0"], contentVersion: "1.0",
  blocks: ["paragraph", "heading", "list", "table", "figure", "code"],
  interactions: ["choice", "text", "order", "match"],
  scoring: ["exact"], interactionsPerItem: 1,
  assets: { mediaTypes: ["image/png", "image/jpeg", "image/webp"], encoding: "base64", maxBytesPerAsset: 262144, maxBytesPerQuestion: 1048576, maxBytesPerStoredPayload: 900000 },
  sharedMaterial: "versioned snapshots", unsupported: ["scripts", "nested interactions", "merged table cells", "partial credit"],
} as const;

export function allContentBlocks(content: QuestionContentModel): ContentBlock[] {
  const interaction = content.interaction;
  const options = interaction.type === "text" ? [] : interaction.type === "match" ? [...interaction.left, ...interaction.right] : interaction.options;
  return [...content.stimuli.flatMap(s => s.body), ...content.body, ...options.flatMap(o => o.body ?? [])];
}
export function blockText(block: ContentBlock): string {
  switch (block.type) {
    case "paragraph": case "heading": case "code": return block.text;
    case "list": return block.entries.map(e => `${e.id}: ${e.text}`).join("\n");
    case "table": return [block.caption, block.columns.join(" | "), ...block.rows.map(r => r.join(" | "))].filter(Boolean).join("\n");
    case "figure": return [block.caption, block.alt].filter(Boolean).join("\n");
  }
}
export function optionText(option: ComponentOption, content: QuestionContentModel): string {
  const entries = new Map(allContentBlocks(content).flatMap(b => b.type === "list" ? b.entries.map(e => [e.id, e.text] as const) : []));
  return option.body?.map(blockText).join("\n\n") ?? option.memberRefs!.map(id => `${id}: ${entries.get(id) ?? id}`).join("; ");
}
export function componentProjection(content: QuestionContentModel) {
  const i = content.interaction;
  const type = i.type === "text" ? "fill_blank" : i.type === "choice" ? (i.variant === "true_false" ? "true_false" : i.multiple ? "multiple_choice" : "single_choice") : i.type === "order" ? "ordering" : "matching";
  return {
    type,
    stem: [...content.stimuli.flatMap(s => s.body), ...content.body].map(blockText).join("\n\n"),
    options: i.type === "text" ? undefined : (i.type === "match" ? i.left : i.options).map(o => ({ id: o.id, text: optionText(o, content) })),
  } as Pick<QuestionImportRow, "type" | "stem" | "options">;
}
export function resolveContent(file: ComponentPackage, item: ComponentItem): QuestionContentModel {
  const stimuli = (item.stimulusRefs ?? []).map(id => file.stimuli!.find(s => s.id === id)!);
  const content: QuestionContentModel = { version: "1.0", body: item.body, stimuli, assets: [], interaction: item.interaction };
  const used = new Set(allContentBlocks(content).filter(b => b.type === "figure").map(b => b.assetId));
  content.assets = (file.assets ?? []).filter(a => used.has(a.id));
  return content;
}
export function validateComponentPackage(data: unknown): ValidationIssue[] {
  // Short circuit structural errors before following references. This also
  // bounds error output for large malformed packages.
  let checked;
  try { checked = validator.validate(data); } catch { return [{ path: "$", message: "must contain valid JSON values" }]; }
  if (!checked.valid) return checked.errors.slice(0, 20).map(e => ({ path: e.instanceLocation.replace(/^#/, "$"), message: e.error }));
  const file = data as ComponentPackage, issues: ValidationIssue[] = [];
  const error = (path: string, message: string) => { if (issues.length < 100) issues.push({ path, message }); };
  const unique = (values: string[], path: string) => { if (new Set(values).size !== values.length) error(path, "IDs/references must be unique"); };
  unique(file.questions.map(q => q.externalId), "$.questions");
  unique((file.assets ?? []).map(a => a.id), "$.assets");
  unique((file.stimuli ?? []).map(s => s.id), "$.stimuli");
  for (const [n, asset] of (file.assets ?? []).entries()) {
    try {
      const bytes = atob(asset.data);
      if (bytes.length > 262144 || btoa(bytes) !== asset.data) throw new Error();
      const signature = asset.mediaType === "image/png" ? bytes.startsWith("\x89PNG\r\n\x1a\n") : asset.mediaType === "image/jpeg" ? bytes.startsWith("\xff\xd8\xff") : bytes.startsWith("RIFF") && bytes.slice(8,12) === "WEBP";
      if (!signature) throw new Error();
    } catch { error(`$.assets[${n}]`, "must contain canonical base64 raster data matching mediaType, at most 256 KiB"); }
  }
  file.questions.forEach((q, n) => {
    const path = `$.questions[${n}]`, refs = q.stimulusRefs ?? [];
    unique(refs, `${path}.stimulusRefs`);
    if (refs.some(id => !file.stimuli?.some(s => s.id === id))) { error(path, "unknown stimulus reference"); return; }
    const content = resolveContent(file, q), blocks = allContentBlocks(content);
    unique(blocks.map(b => b.id), `${path}.body`);
    const entries = blocks.flatMap(b => b.type === "list" ? b.entries : []);
    unique(entries.map(e => e.id), `${path}.body.entries`);
    for (const b of blocks) {
      if (b.type === "figure" && !content.assets.some(a => a.id === b.assetId)) error(path, `unknown figure asset: ${b.assetId}`);
      if (b.type === "table" && b.rows.some(r => r.length !== b.columns.length)) error(path, `table ${b.id} must have one cell per column`);
      for (const s of b.sources ?? []) if (s.bbox && (s.bbox[2]! < s.bbox[0]! || s.bbox[3]! < s.bbox[1]!)) error(path, "source bbox is reversed");
    }
    const i = q.interaction, answers = q.scoring.correctAnswers;
    unique(answers, `${path}.scoring.correctAnswers`);
    const options = i.type === "text" ? [] : i.type === "match" ? [...i.left, ...i.right] : i.options;
    if (i.type === "match") { unique(i.left.map(o => o.id), path); unique(i.right.map(o => o.id), path); }
    else unique(options.map(o => o.id), path);
    for (const o of options) if (o.memberRefs) {
      unique(o.memberRefs, path);
      if (o.memberRefs.some(id => !entries.some(e => e.id === id))) error(path, "option refers to an unknown list entry");
    }
    if (i.type === "choice" || i.type === "order") {
      if (answers.some(a => !i.options.some(o => o.id === a))) error(path, "answer does not identify an option");
      if (i.type === "choice" && i.variant === "true_false" && (i.multiple || i.options.length !== 2 || !i.options.some(o => o.id === "true") || !i.options.some(o => o.id === "false"))) error(path, "true_false requires exactly two options and one answer");
      if (i.type === "choice" && (i.multiple ? answers.length < 2 : answers.length !== 1)) error(path, "answer cardinality disagrees with choice interaction");
      if (i.type === "order" && answers.length !== i.options.length) error(path, "ordering answer must be a permutation of every option");
    }
    if (i.type === "match") {
      const left = new Set<string>();
      for (const answer of answers) {
        try {
          const pair = JSON.parse(answer);
          if (!Array.isArray(pair) || pair.length !== 2 || JSON.stringify(pair) !== answer || !i.left.some(o => o.id === pair[0]) || !i.right.some(o => o.id === pair[1]) || left.has(pair[0])) throw new Error();
          left.add(pair[0]);
        } catch { error(path, 'matching answers must be canonical JSON [leftId,rightId] strings with one pair per left entry'); }
      }
      if (left.size !== i.left.length) error(path, "matching answer must cover every left entry");
    }
    if (encodeURIComponent(JSON.stringify(content)).replace(/%[A-F\d]{2}/g, "x").length > 1048576) error(path, "resolved question content must be at most 1 MiB");
    // D1 stores both current columns and an import-baseline copy. Reserve room
    // for both plus identifiers/revisions under its 2,000,000-byte row limit.
    const payload = { content, externalId: q.externalId, ...componentProjection(content), correctAnswers: answers,
      explanation: q.explanation ?? null, difficulty: q.difficulty ?? null, tags: q.tags ?? [], needsReview: q.needsReview ?? false, points: q.points ?? 1 };
    if (encodeURIComponent(JSON.stringify(payload)).replace(/%[A-F\d]{2}/g, "x").length > 900000) error(path, "normalized question payload exceeds the 900000-byte storage budget; reduce assets or split the item");
  });
  // Unreferenced resources are rejected instead of being silently lost on import.
  const usedStimuli = new Set(file.questions.flatMap(q => q.stimulusRefs ?? []));
  if ((file.stimuli ?? []).some(s => !usedStimuli.has(s.id))) error("$.stimuli", "unreferenced stimulus");
  if (!issues.length) {
    const usedAssets = new Set(file.questions.flatMap(q => resolveContent(file, q).assets.map(a => a.id)));
    if ((file.assets ?? []).some(a => !usedAssets.has(a.id))) error("$.assets", "unreferenced asset");
  }
  return issues;
}
export function normalizeImportFile(data: unknown): QuestionImportFile {
  if ((data as { schemaVersion: string }).schemaVersion !== "2.0") return data as QuestionImportFile;
  const file = data as ComponentPackage;
  return { schemaVersion: "1.0", exam: file.exam, source: file.source, questions: file.questions.map(q => {
    const content = resolveContent(file, q);
    return { externalId: q.externalId, ...componentProjection(content), content, correctAnswers: q.scoring.correctAnswers,
      ...(q.explanation !== undefined ? { explanation: q.explanation } : {}),
      ...(q.tags !== undefined ? { tags: q.tags } : {}),
      ...(q.difficulty !== undefined ? { difficulty: q.difficulty } : {}),
      ...(q.needsReview !== undefined ? { needsReview: q.needsReview } : {}),
      ...(q.points !== undefined ? { points: q.points } : {}) };
  }) };
}
export function validateQuestionContent(content: unknown, row: QuestionImportRow): ValidationIssue[] {
  if (!content || typeof content !== "object") return [{ path: "$.content", message: "must be a component content object" }];
  const c = content as QuestionContentModel;
  if (c.version !== "1.0" || !Array.isArray(c.stimuli) || !Array.isArray(c.assets) || c.stimuli.some(s => !s || typeof s.id !== "string") || Object.keys(c).some(k => !["version","body","stimuli","assets","interaction"].includes(k))) return [{ path: "$.content", message: "invalid content envelope" }];
  const issues = validateComponentPackage({ schemaVersion: "2.0", exam: { id: "validation", name: "Validation" }, assets: c.assets, stimuli: c.stimuli,
    questions: [{ ...(row.explanation !== undefined ? { explanation: row.explanation } : {}), ...(row.tags !== undefined ? { tags: row.tags } : {}), ...(row.difficulty !== undefined ? { difficulty: row.difficulty } : {}), ...(row.needsReview !== undefined ? { needsReview: row.needsReview } : {}), ...(row.points !== undefined ? { points: row.points } : {}), externalId: row.externalId ?? "question", body: c.body, stimulusRefs: c.stimuli.map(s => s.id), interaction: c.interaction, scoring: { method: "exact", correctAnswers: row.correctAnswers } }] });
  if (!issues.length) {
    const projection = componentProjection(c);
    for (const key of ["type","stem","options"] as const) if (JSON.stringify(row[key]) !== JSON.stringify(projection[key])) issues.push({ path: `$.${key}`, message: "must match component content; edit the structured source and re-import" });
  }
  return issues;
}

export class MissingExportExternalIdError extends Error {
  constructor() {
    super("Assign a unique external ID to every question before exporting; questions without one cannot be safely re-imported into their source exam.");
    this.name = "MissingExportExternalIdError";
  }
}

export function exportComponentPackage(exam: ComponentPackage["exam"], questions: QuestionImportRow[]): ComponentPackage {
  const stimuli = new Map<string, Stimulus>(), assets = new Map<string, ContentAsset>();
  const items = questions.map((q): ComponentItem => {
    if (!q.externalId?.trim()) throw new MissingExportExternalIdError();
    const c = q.content;
    if (!c) return { externalId: q.externalId, body: [{ id: "stem", type: "paragraph", format: "markdown", text: q.stem }],
      interaction: q.type === "fill_blank" ? { id: "response", type: "text" } : { id: "response", type: "choice", multiple: q.type === "multiple_choice", ...(q.type === "true_false" ? { variant: "true_false" as const } : {}), options: (q.options ?? []).map(o => ({ id: o.id, body: [{ id: `option-${o.id}`, type: "paragraph", format: "markdown", text: o.text }] })) },
      scoring: { method: "exact", correctAnswers: q.correctAnswers }, explanation: q.explanation, tags: q.tags, difficulty: q.difficulty, needsReview: q.needsReview, points: q.points };
    // Fail on incompatible snapshots rather than choosing an arbitrary winner.
    for (const s of c.stimuli) { if (stimuli.has(s.id) && JSON.stringify(stimuli.get(s.id)) !== JSON.stringify(s)) throw new Error(`Conflicting stimulus snapshots: ${s.id}; export these revisions separately`); stimuli.set(s.id, s); }
    for (const a of c.assets) { if (assets.has(a.id) && JSON.stringify(assets.get(a.id)) !== JSON.stringify(a)) throw new Error(`Conflicting asset: ${a.id}`); assets.set(a.id, a); }
    return { externalId: q.externalId, body: c.body, stimulusRefs: c.stimuli.map(s => s.id), interaction: c.interaction,
      scoring: { method: "exact", correctAnswers: q.correctAnswers }, explanation: q.explanation, tags: q.tags, difficulty: q.difficulty, needsReview: q.needsReview, points: q.points };
  });
  const file = JSON.parse(JSON.stringify({ schemaVersion: "2.0", exam, assets: [...assets.values()], stimuli: [...stimuli.values()], questions: items }));
  const issues = validateComponentPackage(file);
  if (issues.length) throw new Error(`Cannot represent this page as a component package: ${issues[0]!.message}`);
  if (encodeURIComponent(JSON.stringify(file, null, 2)).replace(/%[A-F\d]{2}/g, "x").length > 5 * 1024 * 1024) throw new Error("Export exceeds the 5 MiB import limit; request fewer questions with the API/MCP limit parameter");
  return file;
}
