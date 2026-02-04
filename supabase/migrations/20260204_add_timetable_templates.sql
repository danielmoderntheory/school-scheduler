-- Timetable templates: defines daily structure (times, breaks, blocks) for grade timetable view
CREATE TABLE timetable_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Default',
  rows JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with default timetable matching Journey School's schedule
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

-- Add homeroom teachers field to grades
ALTER TABLE grades ADD COLUMN IF NOT EXISTS homeroom_teachers TEXT;
