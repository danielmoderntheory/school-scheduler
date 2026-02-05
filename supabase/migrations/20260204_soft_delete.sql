-- Add soft delete (deleted_at) column to entities

ALTER TABLE teachers ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE grades ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE subjects ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE quarters ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE timetable_templates ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Create indexes for efficient filtering of non-deleted records
CREATE INDEX idx_teachers_deleted_at ON teachers(deleted_at);
CREATE INDEX idx_grades_deleted_at ON grades(deleted_at);
CREATE INDEX idx_subjects_deleted_at ON subjects(deleted_at);
CREATE INDEX idx_quarters_deleted_at ON quarters(deleted_at);
CREATE INDEX idx_timetable_templates_deleted_at ON timetable_templates(deleted_at);
