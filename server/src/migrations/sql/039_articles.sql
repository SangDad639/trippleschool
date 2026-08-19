-- Articles (บทความ) — free-to-read content shown under the "Content" menu.
-- Body lives in content_html (pasted, small) OR content_url (an HTML file on S3
-- via the existing /api/courses/upload-html flow) — never both required. List
-- queries must select metadata only; the reading page fetches one row's body.

CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  excerpt TEXT,
  cover_url TEXT,
  content_html TEXT,
  content_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_articles_active ON articles(is_active, display_order);
