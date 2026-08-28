-- Per-ebook access control: admin can make a file view-only (no download) and/or
-- restrict it to active subscribers instead of the public. Defaults preserve
-- current behavior (everyone can view and download).
ALTER TABLE ebooks ADD COLUMN IF NOT EXISTS allow_download BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE ebooks ADD COLUMN IF NOT EXISTS members_only BOOLEAN NOT NULL DEFAULT false;
