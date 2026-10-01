-- Site-wide appearance, deliberately separate from each user's settings.
CREATE TABLE site_appearance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mascot_style TEXT NOT NULL CHECK (mascot_style IN ('3D-Chibi', '2D-Anime')),
  updated_at TEXT NOT NULL
);
