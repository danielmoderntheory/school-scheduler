"""
Debug script to test the solver with current data
"""
import json
import sys
sys.path.insert(0, '.')
from solver import (
    Teacher, ClassEntry, build_sessions, solve_with_cpsat, 
    get_study_hall_eligible, DAYS, BLOCKS, parse_grades
)

# Load test data from files or use inline
import os
from pathlib import Path

# Teachers from /tmp/teachers_test.json
teachers_json = '''
[{"id":"52955f45-4bd6-4a96-9033-8d0699396afd","name":"Art Teacher","status":"part-time","can_supervise_study_hall":false},{"id":"38ff2905-b4d8-44ac-8db3-6dca2305ded3","name":"Aurora","status":"part-time","can_supervise_study_hall":false},{"id":"9deafc02-68ce-454b-998e-fa9c3567983e","name":"Carolina","status":"full-time","can_supervise_study_hall":false},{"id":"692eb044-c391-4021-b54c-65a38f727f00","name":"Daniela","status":"part-time","can_supervise_study_hall":false},{"id":"3fec5de3-6488-43ec-8736-63c18dcdfb86","name":"Eugenia","status":"full-time","can_supervise_study_hall":true},{"id":"1182b434-0760-42b2-a556-eb354c5fa6de","name":"Isa","status":"full-time","can_supervise_study_hall":false},{"id":"6e1c7cb7-190e-4c44-9381-920782734e00","name":"Josh","status":"full-time","can_supervise_study_hall":false},{"id":"09bd81b8-615d-4fce-abe9-3cfe68e3a4ed","name":"Jostin","status":"full-time","can_supervise_study_hall":false},{"id":"790e36fa-4bd1-4e1c-a654-aa1888e18dda","name":"Karla","status":"full-time","can_supervise_study_hall":false},{"id":"76e46575-ff27-4c7d-aa1e-fc85567125ad","name":"Mandy","status":"part-time","can_supervise_study_hall":false},{"id":"2138c666-9785-48a0-994d-560bedf3d6c0","name":"Miguel","status":"full-time","can_supervise_study_hall":true},{"id":"0201bb36-4fe7-45e1-8ec8-8bf8541f2173","name":"New Teacher","status":"full-time","can_supervise_study_hall":false},{"id":"5bee6f64-fa87-4d14-a8e5-113cc24ed498","name":"Oscar","status":"full-time","can_supervise_study_hall":true},{"id":"d102b06c-8ebe-4c7a-8a76-91fdc5f9369b","name":"Phil","status":"full-time","can_supervise_study_hall":true},{"id":"77b4368f-4c47-4bbf-8453-c8c40065efe5","name":"Ricardo","status":"full-time","can_supervise_study_hall":true},{"id":"9c68f552-6042-4766-87a3-e318a8ea2165","name":"Romina","status":"part-time","can_supervise_study_hall":false},{"id":"b83308bc-1ea5-467c-bf5e-a692e5ac2b31","name":"Shary","status":"full-time","can_supervise_study_hall":true},{"id":"4e431cd6-3d06-4607-a6ad-3ce7abdcb873","name":"Tenie","status":"part-time","can_supervise_study_hall":false},{"id":"19ac13c6-e34c-48d6-a943-179e0c8c15e4","name":"Randy","status":"part-time","can_supervise_study_hall":false}]
'''

teachers_data = json.loads(teachers_json)
print(f"Loaded {len(teachers_data)} teachers")

# Convert to Teacher objects
teacher_objs = [
    Teacher(
        name=t['name'],
        status=t['status'],
        can_supervise_study_hall=t.get('can_supervise_study_hall', False)
    )
    for t in teachers_data
]

# Show full-time teachers
full_time = [t for t in teacher_objs if t.status == 'full-time']
print(f"Full-time teachers: {len(full_time)}")
for t in full_time:
    print(f"  - {t.name} (study hall: {t.can_supervise_study_hall})")

# We need to fetch classes from Supabase
# For now, let's create a minimal test case

print("\n--- Checking if we can import the solver ---")
print("Solver module loaded successfully")

print("\n--- Now let's test with minimal data ---")
# Create simple test with just 2 teachers and 2 classes
test_teachers = [
    Teacher(name="TestTeacher1", status="full-time", can_supervise_study_hall=True),
    Teacher(name="TestTeacher2", status="full-time", can_supervise_study_hall=True),
]

test_classes = [
    ClassEntry(teacher="TestTeacher1", grade="6th Grade", subject="Math", days_per_week=3),
    ClassEntry(teacher="TestTeacher2", grade="6th Grade", subject="Science", days_per_week=3),
]

sessions = build_sessions(test_classes)
print(f"Built {len(sessions)} sessions from {len(test_classes)} classes")
for s in sessions[:5]:
    print(f"  Session {s.id}: {s.teacher}/{s.grade}/{s.subject} - {len(s.valid_slots)} valid slots")

# Test solver
print("\n--- Testing solve_with_cpsat ---")
solutions = solve_with_cpsat(sessions, seed=0, time_limit=5.0, max_solutions=1)
if solutions:
    print(f"Found {len(solutions)} solution(s)")
else:
    print("No solutions found - solver returned empty")
    
