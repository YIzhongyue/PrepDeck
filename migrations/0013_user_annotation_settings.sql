-- Per-user display aliases for the three annotation "mark" styles used
-- throughout the app as `hl1`/`hl2`/`hl3` (annotations.style). Purely
-- presentational: no colors are stored here (colors come from the active
-- theme's CSS vars at render time — see apps/web/src/data/constants.ts's
-- HL map), and the `annotations` table itself is untouched — `style`
-- already stores the stable logical slot (hl1/hl2/hl3), not a raw color,
-- so this feature never needs to migrate/rewrite existing annotations.
-- One row per user, created lazily on first save; users with no row get
-- default aliases resolved in application code, not SQL DEFAULTs.
CREATE TABLE user_annotation_settings (
  user_id TEXT PRIMARY KEY,
  hl1_alias TEXT NOT NULL,
  hl2_alias TEXT NOT NULL,
  hl3_alias TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
