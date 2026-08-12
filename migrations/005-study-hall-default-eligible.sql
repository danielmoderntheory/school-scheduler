-- New teachers default to ELIGIBLE for study hall supervision.
-- The old default (false) marked every imported/created teacher as excluded,
-- which silently emptied the supervisor pool. Existing rows are untouched —
-- only teachers never explicitly set (NULL) and future inserts are affected.
-- Safe to re-run.

ALTER TABLE teachers ALTER COLUMN can_supervise_study_hall SET DEFAULT true;
