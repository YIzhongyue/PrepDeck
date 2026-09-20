-- Persists the Settings page's color-scheme (theme) picker server-side,
-- instead of only in browser-local state. NULL means "no preference saved
-- yet" — the client falls back to its own default (cream) in that case.
ALTER TABLE users ADD COLUMN theme TEXT CHECK (theme IN ('cream', 'sage', 'clay', 'dusk'));
