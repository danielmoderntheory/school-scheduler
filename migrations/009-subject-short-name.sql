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
--   "7 ENG" / "6 ENG"        (Carolina, Eugenia)  -> (superseded by English L&L below)
--   "4/5 SPAN" / "6 SPAN"    (Karla)              -> (superseded by Español below)
--   "HUMANITIES"             (12th grade card)    -> Integrated Humanities
-- Reaccion (Writing) prints as "Writing": Reacción is the programme, writing
-- is the class, and that is what the card should say (Daniel's call — their
-- own cards do say REACCIÓN).
-- Only these are long enough to wrap past a cell; everything else the
-- cards print in full, so it stays NULL.
-- Spanish -> "Español" and Social Studies -> "Estudios Sociales" are the
-- exceptions: not shortenings but the school's own names for the classes, the
-- way their PreK-1st cards print them. Those two names are a per-CARD choice
-- in the original -- only the PreK-1st band is translated, and the 2nd-grade
-- card one year up says SPANISH / SOCIAL STUDIES -- which one short_name per
-- subject cannot express. Daniel's call: the Spanish names everywhere, so the
-- two read consistently rather than one being translated and the other not. The grade prefixes on their cards
-- ("4/5", "7") are not part of the subject — the poster carries the grade on
-- its own sub-line.
-- COALESCE guard: seeds only where nobody has set a value, so re-running this
-- never overwrites an edit made in Settings.
-- The two Language & Literature courses keep "L&L" so they stay distinct from
-- the separate K-6th English and Spanish subjects. Their own cards just say
-- ENG, which is terser than it needs to be at this type size.
-- Safe either way: no grade takes both (English/Spanish are K-6th, the L&L
-- courses 7th-12th) and no teacher teaches both, so no card can show a pair.
UPDATE subjects SET short_name = COALESCE(short_name, 'English L&L') WHERE name = 'English Language & Literature';
UPDATE subjects SET short_name = COALESCE(short_name, 'Español L&L') WHERE name = 'Spanish Language & Literature';
UPDATE subjects SET short_name = COALESCE(short_name, 'Humanities') WHERE name = 'Integrated Humanities';
UPDATE subjects SET short_name = COALESCE(short_name, 'Writing')    WHERE name = 'Reaccion (Writing)';
UPDATE subjects SET short_name = COALESCE(short_name, 'Español')    WHERE name = 'Spanish';
UPDATE subjects SET short_name = COALESCE(short_name, 'Estudios Sociales') WHERE name = 'Social Studies';

-- Salsa/Batchata is misspelled (the dance is bachata), but the subject is NOT
-- free to rename: a soft-deleted 6th-grade class still points at it and two
-- saved generations carry the old spelling inside their JSON, which a rename
-- would strand (see relabel-without-regen: a generation stores subject names
-- in several places, not one). A short name fixes what the card prints without
-- touching any stored schedule.
UPDATE subjects SET short_name = COALESCE(short_name, 'Salsa/Bachata')
  WHERE name = 'Salsa/Batchata';

-- Deliberately NOT seeded: "Spanish Conversation & Creative Writing" (39 chars).
-- It is the only subject still long enough to wrap past two lines, but it does
-- not appear on any of the school's cards -- it was Jostin's 3rd/4th class in
-- Q4 Summer 2025-26 and he now teaches only 6th Science -- so there is no
-- school abbreviation to copy and inventing one would not be following the
-- design. The export's fit pass keeps it legible if it is ever scheduled again.
