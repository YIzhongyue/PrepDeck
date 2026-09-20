-- Section 3.9 (Personal Statistics Dashboard) queries filter/join attempts by
-- (user_id, exam_id, mode) and by (user_id, completed_at) for the study
-- activity heatmap — neither is covered by the existing single-column
-- idx_attempts_user_id index.
CREATE INDEX idx_attempts_user_exam_mode ON attempts(user_id, exam_id, mode);
CREATE INDEX idx_attempts_user_completed ON attempts(user_id, completed_at);
