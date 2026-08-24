-- Short subject labels for the poster PNG export.
-- The printed schedule cards abbreviate long subject names to fit a cell
-- ("English Language & Literature" -> "ELA LANG ACQ", "Spanish" -> "SPAN"),
-- and the school has always done this by hand in Canva. Storing the short form
-- on the subject makes the exporter reproduce it without hardcoding a map.
-- NULL = no short form; every reader falls back to subjects.name, so nothing
-- changes for subjects that are already short.
-- Only the poster export reads this — the grids, solver payloads and XLSX/CSV
-- exports keep using the full name.
-- Safe to re-run.

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS short_name TEXT;
