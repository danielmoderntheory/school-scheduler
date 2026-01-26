-- Add 'medium' as a valid rule type
ALTER TABLE rules DROP CONSTRAINT rules_rule_type_check;
ALTER TABLE rules ADD CONSTRAINT rules_rule_type_check CHECK (rule_type IN ('hard', 'soft', 'medium'));

-- Add new Study Hall configuration rules
INSERT INTO rules (name, description, rule_key, rule_type, priority, enabled, config) VALUES
    (
        'Study Hall Grades',
        'Which grades should have study hall periods assigned',
        'study_hall_grades',
        'medium',
        1,
        true,
        '{"grades": ["6th Grade", "7th Grade", "8th Grade", "9th Grade", "10th Grade", "11th Grade"]}'
    ),
    (
        'Study Hall Teacher Eligibility',
        'Requirements for teachers who can supervise study hall',
        'study_hall_teacher_eligibility',
        'medium',
        2,
        true,
        '{"require_full_time": true, "require_teaches_grades": ["6th Grade", "7th Grade", "8th Grade", "9th Grade", "10th Grade", "11th Grade"]}'
    );
