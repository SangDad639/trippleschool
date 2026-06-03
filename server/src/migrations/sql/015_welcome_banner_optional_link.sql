-- Migration 015: Make welcome_banners.link_url optional (nullable).
--
-- Per UX request 2026-05-14 — admin should be able to publish a Welcome
-- popup that is purely informational (no click destination). Clicking such
-- a banner just dismisses the popup; the image is shown as a static
-- announcement.
--
-- 014 created link_url as TEXT NOT NULL DEFAULT '/app/image-templates'.
-- This migration drops both the NOT NULL constraint and the default so an
-- empty submission from the admin UI maps cleanly to NULL.

ALTER TABLE welcome_banners
  ALTER COLUMN link_url DROP NOT NULL;

ALTER TABLE welcome_banners
  ALTER COLUMN link_url DROP DEFAULT;
