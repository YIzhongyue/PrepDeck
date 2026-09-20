-- Optional exam badge icon. The file itself lives in R2; this column stores
-- the authenticated Worker URL used to retrieve it.
ALTER TABLE exams ADD COLUMN badge_icon_url TEXT;
