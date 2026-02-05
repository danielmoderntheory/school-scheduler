-- Cleanup: standardize updated_at trigger pattern
-- Pattern: triggers handle all updated_at; app code does not set it manually

-- 1. Add missing trigger for timetable_templates (uses shared function from initial schema)
DROP TRIGGER IF EXISTS timetable_templates_updated_at ON timetable_templates;
CREATE TRIGGER timetable_templates_updated_at BEFORE UPDATE ON timetable_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Remove redundant classes trigger/function added in 20260204_add_classes_updated_at.sql
-- (The initial schema already has classes_updated_at trigger using the shared function)
DROP TRIGGER IF EXISTS classes_set_updated_at ON classes;
DROP FUNCTION IF EXISTS update_classes_updated_at();
