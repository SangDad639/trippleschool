-- Ebooks (free downloads) — public tab under "Ebook" nav, no login/membership required.
-- Cover images and files reuse the courses upload endpoints (/upload-thumbnail,
-- /upload-material) — this table stores only the returned URLs, same pattern as articles.
CREATE TABLE IF NOT EXISTS ebooks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  cover_url TEXT,
  file_url TEXT,
  file_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ebooks_active ON ebooks(is_active, display_order);
