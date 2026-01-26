-- School Schedule Generator Database Schema
-- Initial migration

-- Enable UUID extension
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- GRADES (Pre-populated reference data)
-- ============================================================================
CREATE TABLE grades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    is_combined BOOLEAN DEFAULT false,
    combined_grades TEXT[],
    sort_order INT NOT NULL
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
    created_at TIMESTAMPTZ DEFAULT NOW()
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(year, quarter_num)
);

-- ============================================================================
-- CLASSES (Teacher-Grade-Subject assignments)
-- ============================================================================
CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quarter_id UUID NOT NULL REFERENCES quarters(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    grade_id UUID NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    days_per_week INT NOT NULL CHECK (days_per_week BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(quarter_id, teacher_id, grade_id, subject_id)
);

-- ============================================================================
-- RESTRICTIONS (Fixed slots, availability limits)
-- ============================================================================
CREATE TABLE restrictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    restriction_type TEXT NOT NULL CHECK (restriction_type IN ('fixed_slot', 'available_days', 'available_blocks')),
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- RULES (Configurable constraints)
-- ============================================================================
CREATE TABLE rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    rule_key TEXT NOT NULL UNIQUE,  -- Machine-readable key
    rule_type TEXT NOT NULL CHECK (rule_type IN ('hard', 'soft')),
    priority INT DEFAULT 0,  -- Lower = higher priority for soft constraints
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

-- Seed study hall groups (will need to update with actual grade UUIDs after creation)
-- This is a placeholder - actual seeding should be done programmatically

-- ============================================================================
-- SCHEDULE GENERATIONS (History)
-- ============================================================================
CREATE TABLE schedule_generations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quarter_id UUID NOT NULL REFERENCES quarters(id) ON DELETE CASCADE,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    options JSONB NOT NULL,  -- Array of schedule options
    stats JSONB,
    selected_option INT,  -- Which option was chosen (1, 2, or 3)
    notes TEXT
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_classes_quarter ON classes(quarter_id);
CREATE INDEX idx_classes_teacher ON classes(teacher_id);
CREATE INDEX idx_restrictions_class ON restrictions(class_id);
CREATE INDEX idx_generations_quarter ON schedule_generations(quarter_id);
CREATE INDEX idx_generations_date ON schedule_generations(generated_at DESC);

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

-- ============================================================================
-- ROW LEVEL SECURITY (Optional - enable if using Supabase auth)
-- ============================================================================
-- ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
-- etc.
