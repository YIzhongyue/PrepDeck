-- Personal KP capacity only. UTF-8 bytes of persisted body_markdown exclude
-- title/excerpt and shared question notes. No existing content is deleted.
CREATE TABLE knowledge_point_usage (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  note_count INTEGER NOT NULL DEFAULT 0,
  body_bytes INTEGER NOT NULL DEFAULT 0
);
INSERT INTO knowledge_point_usage(user_id, note_count, body_bytes)
SELECT user_id, COUNT(*), SUM(length(CAST(body_markdown AS BLOB)))
FROM knowledge_points GROUP BY user_id;

CREATE TRIGGER kp_quota_insert BEFORE INSERT ON knowledge_points BEGIN
  INSERT OR IGNORE INTO knowledge_point_usage(user_id) VALUES(NEW.user_id);
  SELECT CASE WHEN (SELECT note_count FROM knowledge_point_usage WHERE user_id=NEW.user_id) >= 10000
    OR (SELECT body_bytes FROM knowledge_point_usage WHERE user_id=NEW.user_id) + length(CAST(NEW.body_markdown AS BLOB)) > 104857600
    THEN RAISE(ABORT, 'kp_quota_exceeded') END;
END;
CREATE TRIGGER kp_usage_insert AFTER INSERT ON knowledge_points BEGIN
  UPDATE knowledge_point_usage SET note_count=note_count+1,
    body_bytes=body_bytes+length(CAST(NEW.body_markdown AS BLOB)) WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER kp_quota_update BEFORE UPDATE OF body_markdown,user_id ON knowledge_points BEGIN
  SELECT CASE WHEN NEW.user_id != OLD.user_id THEN RAISE(ABORT, 'kp_owner_immutable') END;
  SELECT CASE WHEN length(CAST(NEW.body_markdown AS BLOB)) > length(CAST(OLD.body_markdown AS BLOB))
    AND (SELECT body_bytes FROM knowledge_point_usage WHERE user_id=NEW.user_id)
      + length(CAST(NEW.body_markdown AS BLOB)) - length(CAST(OLD.body_markdown AS BLOB)) > 104857600
    THEN RAISE(ABORT, 'kp_quota_exceeded') END;
END;
CREATE TRIGGER kp_usage_update AFTER UPDATE OF body_markdown ON knowledge_points BEGIN
  UPDATE knowledge_point_usage SET body_bytes=body_bytes+length(CAST(NEW.body_markdown AS BLOB))
    -length(CAST(OLD.body_markdown AS BLOB)) WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER kp_usage_delete AFTER DELETE ON knowledge_points BEGIN
  UPDATE knowledge_point_usage SET note_count=note_count-1,
    body_bytes=body_bytes-length(CAST(OLD.body_markdown AS BLOB)) WHERE user_id=OLD.user_id;
END;

-- Separate from live attachments: unreferenced images and retired objects
-- consume quota until confirmed R2 deletion. No FK cascade may release it.
CREATE TABLE knowledge_point_image_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  r2_object_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  upload_state TEXT NOT NULL CHECK(upload_state IN ('uploading','ready')),
  created_at TEXT NOT NULL,
  request_key TEXT,
  payload_hash TEXT,
  UNIQUE(user_id,request_key)
);
CREATE INDEX idx_kp_image_usage_user ON knowledge_point_image_usage(user_id);
INSERT INTO knowledge_point_image_usage(id,user_id,r2_object_key,byte_size,upload_state,created_at)
SELECT id, user_id, r2_object_key, byte_size, 'ready', created_at FROM knowledge_point_images;
CREATE TRIGGER kp_image_quota_insert BEFORE INSERT ON knowledge_point_image_usage
WHEN NOT EXISTS(SELECT 1 FROM knowledge_point_image_usage WHERE id=NEW.id) BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM knowledge_point_image_usage WHERE user_id=NEW.user_id) >= 5000
    OR COALESCE((SELECT SUM(byte_size) FROM knowledge_point_image_usage WHERE user_id=NEW.user_id),0)+NEW.byte_size > 524288000
    THEN RAISE(ABORT, 'kp_image_quota_exceeded') END;
END;
CREATE TRIGGER kp_image_usage_immutable BEFORE UPDATE OF user_id,byte_size,r2_object_key ON knowledge_point_image_usage BEGIN
  SELECT RAISE(ABORT, 'kp_image_usage_immutable');
END;
-- Maintain accounting for internal imports/direct inserts as well as REST.
CREATE TRIGGER kp_image_usage_insert AFTER INSERT ON knowledge_point_images BEGIN
  INSERT OR IGNORE INTO knowledge_point_image_usage(id,user_id,r2_object_key,byte_size,upload_state,created_at)
  VALUES(NEW.id,NEW.user_id,NEW.r2_object_key,NEW.byte_size,'ready',NEW.created_at);
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_point_image_usage WHERE id=NEW.id AND user_id=NEW.user_id
    AND byte_size=NEW.byte_size AND r2_object_key=NEW.r2_object_key AND upload_state='ready')
    THEN RAISE(ABORT, 'kp_image_reservation_mismatch') END;
END;
CREATE TRIGGER kp_image_usage_retire AFTER DELETE ON knowledge_point_images BEGIN
  INSERT OR IGNORE INTO knowledge_point_image_deletions(id,r2_object_key,queued_at)
  VALUES(OLD.id,OLD.r2_object_key,CAST(strftime('%s','now') AS INTEGER)*1000);
END;
CREATE TRIGGER kp_image_metadata_immutable BEFORE UPDATE OF user_id,byte_size,r2_object_key ON knowledge_point_images
WHEN NEW.user_id != OLD.user_id OR NEW.byte_size != OLD.byte_size OR NEW.r2_object_key != OLD.r2_object_key BEGIN
  SELECT RAISE(ABORT, 'kp_image_metadata_immutable');
END;
