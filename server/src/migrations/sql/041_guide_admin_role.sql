-- Scoped admin role: manage /guide clips, nothing else.
--
-- The team wanted an account that can publish how-to clips without handing over
-- the full admin panel (users, revenue, enrolments, payouts). is_admin stays
-- false for these accounts; only the guide endpoints accept the flag, so a guide
-- admin is an ordinary member everywhere else in the app.
--
-- Granted from /admin/guide by a full admin. The flag rides in the JWT, so a
-- change takes effect the next time that account signs in.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guide_admin BOOLEAN NOT NULL DEFAULT false;
