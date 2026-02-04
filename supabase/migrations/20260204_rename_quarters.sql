-- Rename existing quarters from "Q1 2026" format to "Q1 Fall 2025-26" format
-- Maps quarter_num to season and appends academic year span

UPDATE quarters
SET name = 'Q' || quarter_num || ' ' ||
  CASE quarter_num
    WHEN 1 THEN 'Fall'
    WHEN 2 THEN 'Winter'
    WHEN 3 THEN 'Spring'
    WHEN 4 THEN 'Summer'
    ELSE 'Q' || quarter_num
  END || ' ' ||
  year || '-' || RIGHT((year + 1)::text, 2);
