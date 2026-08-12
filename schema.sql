-- School Schedule Generator Database Schema
-- Consolidated schema for Neon Postgres
-- Run this against a fresh database to set up all tables

-- Enable UUID extension (Neon supports this)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- TEACHERS
-- ============================================================================
CREATE TABLE teachers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('full-time', 'part-time')),
    can_supervise_study_hall BOOLEAN DEFAULT false,
    notes TEXT,
    available_days JSONB DEFAULT NULL,
    available_blocks JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

-- ============================================================================
-- GRADES
-- ============================================================================
CREATE TABLE grades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    is_combined BOOLEAN DEFAULT false,
    combined_grades TEXT[],
    sort_order INT NOT NULL,
    homeroom_teachers TEXT,
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

-- Seed grades
INSERT INTO grades (name, display_name, is_combined, combined_grades, sort_order) VALUES
    ('kindergarten', 'Kindergarten', false, NULL, 0),
    ('1st', '1st Grade', false, NULL, 1),
    ('2nd', '2nd Grade', false, NULL, 2),
    ('3rd', '3rd Grade', false, NULL, 3),
    ('4th', '4th Grade', false, NULL, 4),
    ('5th', '5th Grade', false, NULL, 5),
    ('6th', '6th Grade', false, NULL, 6),
    ('7th', '7th Grade', false, NULL, 7),
    ('8th', '8th Grade', false, NULL, 8),
    ('9th', '9th Grade', false, NULL, 9),
    ('10th', '10th Grade', false, NULL, 10),
    ('11th', '11th Grade', false, NULL, 11),
    ('6th-7th', '6th-7th Grade', true, ARRAY['6th', '7th'], 12),
    ('10th-11th', '10th-11th Grade', true, ARRAY['10th', '11th'], 13),
    ('6th-11th-elective', '6th-11th Elective', true, ARRAY['6th', '7th', '8th', '9th', '10th', '11th'], 14);

-- ============================================================================
-- SUBJECTS
-- ============================================================================
CREATE TABLE subjects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    -- Subject meets as double periods: each meeting = two consecutive same-day blocks
    requires_double_periods BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

-- ============================================================================
-- QUARTERS
-- ============================================================================
CREATE TABLE quarters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    year INT NOT NULL,
    quarter_num INT NOT NULL CHECK (quarter_num BETWEEN 1 AND 4),
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT false,
    -- Block format for this quarter; the template's block rows define the block count.
    -- NULL falls back to the oldest template (the original 5-block format).
    -- FK added after timetable_templates is created (see below).
    timetable_template_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ DEFAULT NULL,
    UNIQUE(year, quarter_num)
);

-- ============================================================================
-- CLASSES (Teacher-Grade-Subject assignments)
-- ============================================================================
CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quarter_id UUID NOT NULL REFERENCES quarters(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
    grade_id UUID REFERENCES grades(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
    -- Lessons (blocks) per week; above 5 requires double periods to fit
    days_per_week INT NOT NULL CHECK (days_per_week BETWEEN 1 AND 10),
    -- Class meets in back-to-back double blocks (lessons pair; odd lesson = one single)
    double_periods BOOLEAN NOT NULL DEFAULT false,
    is_elective BOOLEAN DEFAULT false,
    is_cotaught BOOLEAN DEFAULT false,
    grade_ids UUID[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

-- Partial unique index: only enforce uniqueness on non-deleted classes
-- This allows soft-deleted classes to not block new ones with same combination
CREATE UNIQUE INDEX classes_unique_active
    ON classes (quarter_id, teacher_id, grade_id, subject_id)
    WHERE deleted_at IS NULL;

-- ============================================================================
-- RESTRICTIONS (Fixed slots, availability limits)
-- ============================================================================
CREATE TABLE restrictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    restriction_type TEXT NOT NULL CHECK (restriction_type IN ('fixed_slot', 'available_days', 'available_blocks')),
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

-- ============================================================================
-- RULES (Configurable constraints)
-- ============================================================================
CREATE TABLE rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    rule_key TEXT NOT NULL UNIQUE,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('hard', 'soft', 'medium')),
    priority INT DEFAULT 0,
    enabled BOOLEAN DEFAULT true,
    config JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default rules
INSERT INTO rules (name, description, rule_key, rule_type, priority, enabled) VALUES
    ('No Teacher Conflicts', 'Teacher cannot be in two places at once', 'no_teacher_conflicts', 'hard', 0, true),
    ('No Grade Conflicts', 'Grade cannot have two classes simultaneously', 'no_grade_conflicts', 'hard', 0, true),
    ('No Duplicate Subjects', 'Same subject cannot appear twice per day per grade', 'no_duplicate_subjects', 'hard', 0, true),
    ('Fixed Slot Restrictions', 'Honor fixed time slot requirements', 'fixed_slots', 'hard', 0, true),
    ('Teacher Availability', 'Respect day/block availability limits', 'teacher_availability', 'hard', 0, true),
    ('Co-Taught Classes', 'Same grade+subject with different teachers at same time', 'cotaught_classes', 'hard', 0, true),
    ('No Back-to-Back OPEN', 'Avoid consecutive OPEN blocks for full-time teachers', 'no_btb_open', 'soft', 1, true),
    ('Spread OPEN Blocks', 'Minimize multiple OPEN blocks on same day', 'spread_open', 'soft', 2, true),
    ('Study Hall Distribution', 'Assign study halls to teachers with most availability', 'study_hall_distribution', 'soft', 3, true);

-- ============================================================================
-- STUDY HALL GROUPS
-- ============================================================================
CREATE TABLE study_hall_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    grade_ids UUID[] NOT NULL,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SCHEDULE GENERATIONS (History)
-- ============================================================================
CREATE TABLE schedule_generations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quarter_id UUID NOT NULL REFERENCES quarters(id) ON DELETE CASCADE,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    options JSONB NOT NULL,
    stats JSONB,
    selected_option INT,
    notes TEXT,
    is_saved BOOLEAN NOT NULL DEFAULT false,
    is_starred BOOLEAN DEFAULT false,
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

-- ============================================================================
-- TIMETABLE TEMPLATES
-- ============================================================================
CREATE TABLE timetable_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL DEFAULT 'Default',
    rows JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

-- Seed with default timetable
INSERT INTO timetable_templates (name, rows) VALUES ('Default', '[
  {"sort_order":1,  "time":"8-8:05",       "label":"Morning Meeting",    "type":"transition"},
  {"sort_order":2,  "time":"8:05-8:20",    "label":"Social Emotional Learning/Executive Functioning Check-in home room", "type":"transition"},
  {"sort_order":3,  "time":"8:20-9:20",    "label":"Block 1",            "type":"block", "blockNumber":1},
  {"sort_order":4,  "time":"9:20-9:25",    "label":"break 5 min",        "type":"break"},
  {"sort_order":5,  "time":"9:25-10:25",   "label":"Block 2",            "type":"block", "blockNumber":2},
  {"sort_order":6,  "time":"10:25-10:30",  "label":"break 5 min",        "type":"break"},
  {"sort_order":7,  "time":"10:30-11:30",  "label":"Block 3",            "type":"block", "blockNumber":3},
  {"sort_order":8,  "time":"11:30-11:45",  "label":"HOMEROOM check-in",  "type":"transition"},
  {"sort_order":9,  "time":"11:45-12:30",  "label":"Lunch/Break",        "type":"break"},
  {"sort_order":10, "time":"12:30-1:30",   "label":"Block 4",            "type":"block", "blockNumber":4},
  {"sort_order":11, "time":"1:30-1:40",    "label":"Break 10 min",       "type":"break"},
  {"sort_order":12, "time":"1:40-2:40",    "label":"Block 5",            "type":"block", "blockNumber":5},
  {"sort_order":13, "time":"2:40-2:45",    "label":"Packup for dismissal","type":"transition"},
  {"sort_order":14, "time":"2:45",         "label":"Return to home room for dismissal", "type":"transition"}
]');

-- Quarters reference timetable templates (declared here because quarters is created first)
ALTER TABLE quarters
    ADD CONSTRAINT quarters_timetable_template_id_fkey
    FOREIGN KEY (timetable_template_id) REFERENCES timetable_templates(id);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_classes_quarter ON classes(quarter_id);
CREATE INDEX idx_classes_teacher ON classes(teacher_id);
CREATE INDEX idx_restrictions_class ON restrictions(class_id);
CREATE INDEX idx_generations_quarter ON schedule_generations(quarter_id);
CREATE INDEX idx_generations_date ON schedule_generations(generated_at DESC);
CREATE INDEX idx_generations_saved ON schedule_generations(is_saved);
CREATE INDEX idx_teachers_deleted_at ON teachers(deleted_at);
CREATE INDEX idx_grades_deleted_at ON grades(deleted_at);
CREATE INDEX idx_subjects_deleted_at ON subjects(deleted_at);
CREATE INDEX idx_quarters_deleted_at ON quarters(deleted_at);
CREATE INDEX idx_classes_deleted_at ON classes(deleted_at);
CREATE INDEX idx_restrictions_deleted_at ON restrictions(deleted_at);
CREATE INDEX idx_timetable_templates_deleted_at ON timetable_templates(deleted_at);
CREATE INDEX idx_schedule_generations_deleted_at ON schedule_generations(deleted_at);

-- ============================================================================
-- TRIGGERS for updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER teachers_updated_at BEFORE UPDATE ON teachers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER quarters_updated_at BEFORE UPDATE ON quarters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER classes_updated_at BEFORE UPDATE ON classes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER rules_updated_at BEFORE UPDATE ON rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER timetable_templates_updated_at BEFORE UPDATE ON timetable_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
