-- implementation — Knowledge Points: a personal, freeform Markdown knowledge
-- base, distinct from Section 3.11 `notes` (question-scoped, optionally
-- shared) and Section 3.8 `annotations` (span-anchored). A Knowledge Point
-- is a standalone document with its own title/body, optionally grouped and
-- tagged, and cross-linked to questions. Always private to its owner — no
-- visibility/sharing column, unlike `notes`.

CREATE TABLE knowledge_point_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Case-insensitive per-user uniqueness enforced at the DB layer so two tabs
-- creating "Networking" and "networking" at once can't both land.
CREATE UNIQUE INDEX idx_kp_groups_user_name_nocase ON knowledge_point_groups(user_id, name COLLATE NOCASE);

CREATE TABLE knowledge_point_tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_kp_tags_user_name_nocase ON knowledge_point_tags(user_id, name COLLATE NOCASE);

CREATE TABLE knowledge_points (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL = "Ungrouped" — a virtual bucket, never a real group row, so it
  -- can't be renamed/deleted through the API.
  group_id TEXT REFERENCES knowledge_point_groups(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  -- Denormalized, recomputed server-side from body_markdown on every
  -- autosave (lib/knowledgePointExcerpt.ts) so the list endpoint stays a
  -- flat SELECT rather than parsing Markdown per row.
  excerpt TEXT NOT NULL DEFAULT '',
  -- Also recomputed at save time (count of ```mermaid fences). Linked-
  -- question and image counts are NOT denormalized here — those already
  -- have small indexed junction/attachment tables, so the list query
  -- computes them with a cheap COUNT()/JOIN instead of adding write-time
  -- bookkeeping to the link/unlink and image-upload endpoints.
  mermaid_count INTEGER NOT NULL DEFAULT 0,
  -- Fractional-index position for manual ("Custom order") ordering, scoped
  -- to (user_id, group_id). New notes append at (current max + 1024); a
  -- drag/keyboard reorder only ever rewrites the moved row.
  position REAL NOT NULL,
  -- Optimistic-concurrency counter for the debounced content autosave
  -- (title/body) only. Bumped on every successful PUT; a client's stale
  -- baseRevision gets a 409 with the current row instead of overwriting it.
  -- Structural actions (group move, tag add/remove, question link/unlink)
  -- do not bump this — they can't conflict the way free text can.
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_kp_user_group_position ON knowledge_points(user_id, group_id, position);
CREATE INDEX idx_kp_user_updated ON knowledge_points(user_id, updated_at);

CREATE TABLE knowledge_point_tag_links (
  knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES knowledge_point_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (knowledge_point_id, tag_id)
);
CREATE INDEX idx_kp_tag_links_tag ON knowledge_point_tag_links(tag_id);

CREATE TABLE knowledge_point_question_links (
  knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (knowledge_point_id, question_id)
);
CREATE INDEX idx_kp_question_links_question ON knowledge_point_question_links(question_id);

-- R2-key-audit-trail pattern, per import_logs. `status` tracks whether an
-- uploaded image is actually referenced by the note's current
-- body_markdown, reconciled on every autosave
-- (lib/knowledgePointImageReconciliation.ts): 'pending' = uploaded but not
-- yet confirmed referenced; 'attached' = referenced as of the most recent
-- save; 'orphaned' = was attached, then the reference was removed from the
-- text. Deleting a knowledge point cascades these rows (the route also
-- deletes the matching R2 objects first, since a DB cascade can't reach R2).
CREATE TABLE knowledge_point_images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
  r2_object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'attached', 'orphaned')) DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_kp_images_kp ON knowledge_point_images(knowledge_point_id);
