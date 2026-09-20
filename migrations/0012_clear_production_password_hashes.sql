-- Password authentication is a local-development escape hatch, not a
-- production authentication method. Remove credentials that may have been
-- written before the fail-closed deployment gate was introduced. The column
-- remains nullable so explicitly opted-in local D1 databases can still use the
-- development-only flow.
UPDATE users SET password_hash = NULL WHERE password_hash IS NOT NULL;
