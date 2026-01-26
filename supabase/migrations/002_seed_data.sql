-- Seed data for Journey School Q1 2026

-- ============================================================================
-- TEACHERS
-- ============================================================================
INSERT INTO teachers (name, status, can_supervise_study_hall) VALUES
    ('New Teacher', 'full-time', true),
    ('Carolina', 'full-time', true),
    ('Jostin', 'full-time', true),
    ('Karla', 'full-time', true),
    ('Josh', 'full-time', true),
    ('Shary', 'full-time', true),
    ('Eugenia', 'full-time', true),
    ('Phil', 'full-time', true),
    ('Isa', 'full-time', true),
    ('Ricardo', 'full-time', true),
    ('Miguel', 'full-time', true),
    ('Oscar', 'full-time', true),
    ('Mandy', 'part-time', false),
    ('Tenie', 'part-time', false),
    ('Daniela', 'part-time', false),
    ('Randy', 'part-time', false),
    ('Romina', 'part-time', false),
    ('Art Teacher', 'part-time', false),
    ('Aurora', 'part-time', false)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- SUBJECTS
-- ============================================================================
INSERT INTO subjects (name) VALUES
    ('English'),
    ('Math'),
    ('Spanish'),
    ('Creative Play'),
    ('STEAM'),
    ('Social Studies'),
    ('Handwriting'),
    ('Inquiry Based Literacy'),
    ('Science'),
    ('World Studies'),
    ('Spanish 101'),
    ('French 101'),
    ('English 101'),
    ('TedEd A'),
    ('TedEd B'),
    ('Robotics A'),
    ('AutoCAD'),
    ('Robotics B'),
    ('CRSS'),
    ('Human Geography'),
    ('History'),
    ('Writing'),
    ('Executive Functioning'),
    ('CAS'),
    ('PE'),
    ('Sports'),
    ('Art'),
    ('Art 101'),
    ('Music'),
    ('Healthy Relationships')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- QUARTER
-- ============================================================================
INSERT INTO quarters (name, year, quarter_num, is_active) VALUES
    ('Q1 2026', 2026, 1, true)
ON CONFLICT (year, quarter_num) DO UPDATE SET is_active = true;

-- ============================================================================
-- CLASSES
-- ============================================================================
-- Using a DO block to insert classes with proper foreign key lookups
DO $$
DECLARE
    v_quarter_id UUID;
BEGIN
    -- Get the quarter ID
    SELECT id INTO v_quarter_id FROM quarters WHERE year = 2026 AND quarter_num = 1;

    -- New Teacher - Kindergarten
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'New Teacher' AND g.display_name = 'Kindergarten' AND s.name = 'English';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'New Teacher' AND g.display_name = 'Kindergarten' AND s.name = 'Math';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'New Teacher' AND g.display_name = 'Kindergarten' AND s.name = 'Spanish';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'New Teacher' AND g.display_name = 'Kindergarten' AND s.name = 'Creative Play';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'New Teacher' AND g.display_name = 'Kindergarten' AND s.name = 'STEAM';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'New Teacher' AND g.display_name = 'Kindergarten' AND s.name = 'Social Studies';

    -- Carolina - 1st & 2nd Grade
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Carolina' AND g.display_name = '1st Grade' AND s.name = 'Math';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Carolina' AND g.display_name = '1st Grade' AND s.name = 'English';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Carolina' AND g.display_name = '1st Grade' AND s.name = 'Handwriting';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Carolina' AND g.display_name = '2nd Grade' AND s.name = 'English';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Carolina' AND g.display_name = '2nd Grade' AND s.name = 'Math';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Carolina' AND g.display_name = '2nd Grade' AND s.name = 'Handwriting';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Carolina' AND g.display_name = '2nd Grade' AND s.name = 'Inquiry Based Literacy';

    -- Jostin - 1st & 2nd Grade
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Jostin' AND g.display_name = '1st Grade' AND s.name = 'Spanish';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Jostin' AND g.display_name = '2nd Grade' AND s.name = 'Spanish';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Jostin' AND g.display_name = '1st Grade' AND s.name = 'Social Studies';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Jostin' AND g.display_name = '2nd Grade' AND s.name = 'Social Studies';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Jostin' AND g.display_name = '1st Grade' AND s.name = 'Science';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Jostin' AND g.display_name = '2nd Grade' AND s.name = 'Science';

    -- Karla - 3rd, 4th, 5th Grade
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Karla' AND g.display_name = '3rd Grade' AND s.name = 'Spanish';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Karla' AND g.display_name = '3rd Grade' AND s.name = 'Social Studies';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Karla' AND g.display_name = '4th Grade' AND s.name = 'Social Studies';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Karla' AND g.display_name = '4th Grade' AND s.name = 'Spanish';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Karla' AND g.display_name = '5th Grade' AND s.name = 'Spanish';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Karla' AND g.display_name = '5th Grade' AND s.name = 'Social Studies';

    -- Josh - 3rd, 4th, 5th Grade
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Josh' AND g.display_name = '3rd Grade' AND s.name = 'Math';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Josh' AND g.display_name = '3rd Grade' AND s.name = 'Science';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Josh' AND g.display_name = '4th Grade' AND s.name = 'Math';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Josh' AND g.display_name = '4th Grade' AND s.name = 'Science';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Josh' AND g.display_name = '5th Grade' AND s.name = 'Math';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Josh' AND g.display_name = '5th Grade' AND s.name = 'Science';

    -- Eugenia - 3rd-8th Grade English
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Eugenia' AND g.display_name = '3rd Grade' AND s.name = 'English';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Eugenia' AND g.display_name = '4th Grade' AND s.name = 'English';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 4
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Eugenia' AND g.display_name = '5th Grade' AND s.name = 'English';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Eugenia' AND g.display_name = '6th Grade' AND s.name = 'English';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Eugenia' AND g.display_name = '7th Grade' AND s.name = 'English';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Eugenia' AND g.display_name = '8th Grade' AND s.name = 'English';

    -- Phil - World Studies, English, Electives
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Phil' AND g.display_name = '6th-7th Grade' AND s.name = 'World Studies';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Phil' AND g.display_name = '8th Grade' AND s.name = 'World Studies';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Phil' AND g.display_name = '9th Grade' AND s.name = 'English';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Phil' AND g.display_name = '10th Grade' AND s.name = 'English';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Phil' AND g.display_name = '11th Grade' AND s.name = 'English';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Phil' AND g.display_name = '6th-11th Elective' AND s.name = 'Spanish 101';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Phil' AND g.display_name = '6th-11th Elective' AND s.name = 'French 101';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Phil' AND g.display_name = '6th-11th Elective' AND s.name = 'English 101';

    -- Ricardo - Science 6th-11th, Electives
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Ricardo' AND g.display_name = '6th Grade' AND s.name = 'Science';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Ricardo' AND g.display_name = '7th Grade' AND s.name = 'Science';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Ricardo' AND g.display_name = '8th Grade' AND s.name = 'Science';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Ricardo' AND g.display_name = '9th Grade' AND s.name = 'Science';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Ricardo' AND g.display_name = '10th Grade' AND s.name = 'Science';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Ricardo' AND g.display_name = '11th Grade' AND s.name = 'Science';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Ricardo' AND g.display_name = '6th-11th Elective' AND s.name = 'TedEd A';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Ricardo' AND g.display_name = '6th-11th Elective' AND s.name = 'TedEd B';

    -- Miguel - Math 6th-11th, Electives
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Miguel' AND g.display_name = '6th Grade' AND s.name = 'Math';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Miguel' AND g.display_name = '7th Grade' AND s.name = 'Math';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Miguel' AND g.display_name = '8th Grade' AND s.name = 'Math';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Miguel' AND g.display_name = '9th Grade' AND s.name = 'Math';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Miguel' AND g.display_name = '10th Grade' AND s.name = 'Math';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Miguel' AND g.display_name = '11th Grade' AND s.name = 'Math';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Miguel' AND g.display_name = '6th-11th Elective' AND s.name = 'Robotics A';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Miguel' AND g.display_name = '6th-11th Elective' AND s.name = 'AutoCAD';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Miguel' AND g.display_name = '6th-11th Elective' AND s.name = 'Robotics B';

    -- Shary - CRSS, Spanish 6th-11th, Electives
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '6th Grade' AND s.name = 'CRSS';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '6th Grade' AND s.name = 'Spanish';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '7th Grade' AND s.name = 'CRSS';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '7th Grade' AND s.name = 'Spanish';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '8th Grade' AND s.name = 'CRSS';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '8th Grade' AND s.name = 'Spanish';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '9th Grade' AND s.name = 'CRSS';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '9th Grade' AND s.name = 'Spanish';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '10th Grade' AND s.name = 'CRSS';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '10th Grade' AND s.name = 'Spanish';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '11th Grade' AND s.name = 'CRSS';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '11th Grade' AND s.name = 'Spanish';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '6th-11th Elective' AND s.name = 'TedEd A';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Shary' AND g.display_name = '6th-11th Elective' AND s.name = 'TedEd B';

    -- Mandy - Human Geography, History
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Mandy' AND g.display_name = '9th Grade' AND s.name = 'Human Geography';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Mandy' AND g.display_name = '10th-11th Grade' AND s.name = 'History';

    -- Tenie - Writing 6th-11th
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Tenie' AND g.display_name = '6th Grade' AND s.name = 'Writing';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Tenie' AND g.display_name = '7th Grade' AND s.name = 'Writing';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Tenie' AND g.display_name = '8th Grade' AND s.name = 'Writing';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Tenie' AND g.display_name = '9th Grade' AND s.name = 'Writing';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Tenie' AND g.display_name = '10th Grade' AND s.name = 'Writing';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Tenie' AND g.display_name = '11th Grade' AND s.name = 'Writing';

    -- Daniela - Executive Functioning
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Daniela' AND g.display_name = '6th-7th Grade' AND s.name = 'Executive Functioning';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Daniela' AND g.display_name = '8th Grade' AND s.name = 'Executive Functioning';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Daniela' AND g.display_name = '9th Grade' AND s.name = 'Executive Functioning';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Daniela' AND g.display_name = '10th-11th Grade' AND s.name = 'Executive Functioning';

    -- Isa - CAS, PE, Sports
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Isa' AND g.display_name = '9th Grade' AND s.name = 'CAS';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Isa' AND g.display_name = '10th Grade' AND s.name = 'CAS';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Isa' AND g.display_name = '11th Grade' AND s.name = 'CAS';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Isa' AND g.display_name = 'Kindergarten' AND s.name = 'PE';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Isa' AND g.display_name = '1st Grade' AND s.name = 'PE';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Isa' AND g.display_name = '2nd Grade' AND s.name = 'PE';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Isa' AND g.display_name = '3rd Grade' AND s.name = 'PE';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Isa' AND g.display_name = '4th Grade' AND s.name = 'PE';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Isa' AND g.display_name = '5th Grade' AND s.name = 'PE';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Isa' AND g.display_name = '6th-11th Elective' AND s.name = 'Sports';

    -- Randy - Sports
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 3
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Randy' AND g.display_name = '6th-11th Elective' AND s.name = 'Sports';

    -- Romina - Art K-5
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Romina' AND g.display_name = 'Kindergarten' AND s.name = 'Art';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Romina' AND g.display_name = '1st Grade' AND s.name = 'Art';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Romina' AND g.display_name = '2nd Grade' AND s.name = 'Art';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Romina' AND g.display_name = '3rd Grade' AND s.name = 'Art';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Romina' AND g.display_name = '4th Grade' AND s.name = 'Art';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Romina' AND g.display_name = '5th Grade' AND s.name = 'Art';

    -- Art Teacher - Art 101
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Art Teacher' AND g.display_name = '6th-11th Elective' AND s.name = 'Art 101';

    -- Oscar - Music K-11th
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Oscar' AND g.display_name = 'Kindergarten' AND s.name = 'Music';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Oscar' AND g.display_name = '1st Grade' AND s.name = 'Music';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Oscar' AND g.display_name = '2nd Grade' AND s.name = 'Music';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Oscar' AND g.display_name = '3rd Grade' AND s.name = 'Music';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Oscar' AND g.display_name = '4th Grade' AND s.name = 'Music';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Oscar' AND g.display_name = '5th Grade' AND s.name = 'Music';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Oscar' AND g.display_name = '6th-7th Grade' AND s.name = 'Music';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Oscar' AND g.display_name = '8th Grade' AND s.name = 'Music';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Oscar' AND g.display_name = '9th Grade' AND s.name = 'Music';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 2
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Oscar' AND g.display_name = '10th-11th Grade' AND s.name = 'Music';

    -- Aurora - Healthy Relationships
    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Aurora' AND g.display_name = '8th Grade' AND s.name = 'Healthy Relationships';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Aurora' AND g.display_name = '9th Grade' AND s.name = 'Healthy Relationships';

    INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
    SELECT v_quarter_id, t.id, g.id, s.id, 1
    FROM teachers t, grades g, subjects s
    WHERE t.name = 'Aurora' AND g.display_name = '10th-11th Grade' AND s.name = 'Healthy Relationships';

END $$;

-- ============================================================================
-- RESTRICTIONS (Fixed slots and available days/blocks)
-- ============================================================================

-- Phil's 9th Grade English: Tues Block 1, Thurs Block 2, Fri Block 3 (fixed slots)
INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Tues", "block": 1}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN grades g ON c.grade_id = g.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Phil' AND g.display_name = '9th Grade' AND s.name = 'English';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Thurs", "block": 2}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN grades g ON c.grade_id = g.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Phil' AND g.display_name = '9th Grade' AND s.name = 'English';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Fri", "block": 3}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN grades g ON c.grade_id = g.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Phil' AND g.display_name = '9th Grade' AND s.name = 'English';

-- Phil's electives: Mon Block 5, Wed Block 5, Fri Block 1
INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Mon", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Phil' AND s.name = 'Spanish 101';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Wed", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Phil' AND s.name = 'French 101';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Fri", "block": 1}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Phil' AND s.name = 'English 101';

-- Ricardo's electives
INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Mon", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Ricardo' AND s.name = 'TedEd A';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Wed", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Ricardo' AND s.name = 'TedEd B';

-- Miguel's electives
INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Mon", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Miguel' AND s.name = 'Robotics A';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Wed", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Miguel' AND s.name = 'AutoCAD';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Fri", "block": 1}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Miguel' AND s.name = 'Robotics B';

-- Shary's electives
INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Mon", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Shary' AND s.name = 'TedEd A';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Wed", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Shary' AND s.name = 'TedEd B';

-- Mandy's classes: fixed slots
INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Tues", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Mandy' AND s.name = 'Human Geography';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Thurs", "block": 4}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Mandy' AND s.name = 'Human Geography';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Tues", "block": 4}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Mandy' AND s.name = 'History';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Thurs", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Mandy' AND s.name = 'History';

-- Tenie's Writing: available Mon, Wed only
INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'available_days', '["Mon", "Wed"]'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Tenie' AND s.name = 'Writing';

-- Daniela's Executive Functioning: Tues/Thurs Blocks 3-5
INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'available_days', '["Tues", "Thurs"]'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Daniela' AND s.name = 'Executive Functioning';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'available_blocks', '[3, 4, 5]'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Daniela' AND s.name = 'Executive Functioning';

-- Isa's Sports elective: Mon Block 5, Wed Block 5, Fri Block 1
INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Mon", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Isa' AND s.name = 'Sports';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Wed", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Isa' AND s.name = 'Sports';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Fri", "block": 1}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Isa' AND s.name = 'Sports';

-- Randy's Sports: same fixed slots
INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Mon", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Randy' AND s.name = 'Sports';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Wed", "block": 5}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Randy' AND s.name = 'Sports';

INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Fri", "block": 1}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Randy' AND s.name = 'Sports';

-- Romina's Art: available Mon, Tues, Wed only
INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'available_days', '["Mon", "Tues", "Wed"]'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Romina' AND s.name = 'Art';

-- Art Teacher's Art 101: Fri Block 1
INSERT INTO restrictions (class_id, restriction_type, value)
SELECT c.id, 'fixed_slot', '{"day": "Fri", "block": 1}'::jsonb
FROM classes c
JOIN teachers t ON c.teacher_id = t.id
JOIN subjects s ON c.subject_id = s.id
WHERE t.name = 'Art Teacher' AND s.name = 'Art 101';
