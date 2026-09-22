import { canonical, editableFields, payloadOf, toQuestion, type QuestionPayload, type QuestionRow } from "./questionManagement";
import { fetchTagIdsForQuestion } from "./questionBankTags";

export async function incomingToken(q: QuestionPayload) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(q)));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

function withoutTags(payload: QuestionPayload): Omit<QuestionPayload, "tags"> {
  const { tags: _tags, ...rest } = payload;
  return rest;
}

// implementation — whether `row`'s LIVE state has diverged from what it looked
// like when import_baseline_json (and its sibling import_baseline_tag_ids_json)
// were last written, independent of whatever the currently-reviewed incoming
// file happens to say. Non-tag fields are compared by value, same as before;
// tags are compared by catalog *identity* (sorted ids), not display name —
// a pure rename/merge of a shared tag changes every question's displayed tag
// text but never changes what any one question is actually linked to, so it
// must never manufacture a "locally_edited" result here (the false-conflict
// case implementation explicitly calls out). Only called once `row.import_baseline_json`
// is known non-null.
async function hasChangedSinceBaseline(db: D1Database, row: QuestionRow): Promise<boolean> {
  // Run the stored snapshot back through payloadOf rather than comparing the
  // raw parsed JSON: a baseline written before issue #15 has no `needsReview`
  // key at all, and a bare JSON.stringify of it would differ from every
  // current payload purely because the field was added — turning every
  // previously-imported question into a false "locally_edited" conflict.
  // payloadOf fills the same defaults on both sides, so only real divergence
  // shows up here.
  const baseline = payloadOf(JSON.parse(row.import_baseline_json!) as QuestionPayload);
  const current = payloadOf(toQuestion(row));
  if (JSON.stringify(withoutTags(current)) !== JSON.stringify(withoutTags(baseline))) return true;
  const baselineTagIds: string[] = row.import_baseline_tag_ids_json ? JSON.parse(row.import_baseline_tag_ids_json) : [];
  const currentTagIds = await fetchTagIdsForQuestion(db, row.id);
  return JSON.stringify([...currentTagIds].sort()) !== JSON.stringify([...baselineTagIds].sort());
}

export async function importConflict(db: D1Database, row: QuestionRow, incoming: QuestionPayload, ambiguous: boolean) {
  const current = payloadOf(toQuestion(row));
  const next = payloadOf(incoming);
  const differences = editableFields.filter(field => JSON.stringify(current[field]) !== JSON.stringify(next[field]))
    .map(field => ({ field, current: current[field] ?? null, incoming: next[field] ?? null }));
  const reason = ambiguous ? "ambiguous_external_id"
    : !row.import_baseline_json ? "unknown_provenance"
    : (await hasChangedSinceBaseline(db, row)) ? "locally_edited" : "incoming_changes";
  return { questionId: row.id, externalId: row.external_id, expectedRevision: row.revision,
    incomingToken: await incomingToken(incoming), reason, differences };
}
export type ImportConflict = Awaited<ReturnType<typeof importConflict>>;
