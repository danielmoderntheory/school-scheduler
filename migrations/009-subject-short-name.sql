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

-- Seed the school's own abbreviations, taken from their hand-made Canva cards:
--   "7 ENG" / "6 ENG"        (Carolina, Eugenia)  -> English Language & Literature
--   "4/5 SPAN" / "6 SPAN"    (Karla)              -> the Spanish family
--   "HUMANITIES"             (12th grade card)    -> Integrated Humanities
--   "6 REACCIÓN"             (Karla, 6th grade)   -> Reaccion (Writing)
-- Only these four are long enough to wrap past a cell; everything else the
-- cards print in full, so it stays NULL. The grade prefixes on their cards
-- ("4/5", "7") are not part of the subject — the poster carries the grade on
-- its own sub-line.
-- COALESCE guard: seeds only where nobody has set a value, so re-running this
-- never overwrites an edit made in Settings.
UPDATE subjects SET short_name = COALESCE(short_name, 'ENG')        WHERE name = 'English Language & Literature';
UPDATE subjects SET short_name = COALESCE(short_name, 'SPAN')       WHERE name = 'Spanish Language & Literature';
UPDATE subjects SET short_name = COALESCE(short_name, 'Humanities') WHERE name = 'Integrated Humanities';
UPDATE subjects SET short_name = COALESCE(short_name, 'Reacción')   WHERE name = 'Reaccion (Writing)';
