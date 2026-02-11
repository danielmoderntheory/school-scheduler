-- Revoke anon access and enable RLS on all tables
-- This prevents direct access via the anon key through PostgREST
-- All database access now goes through API routes using the service role key

-- Enable RLS on all tables (silences Supabase lint warnings)
-- With no policies defined, anon/authenticated can't access anything
-- The service_role bypasses RLS, so API routes still work
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quarters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_templates ENABLE ROW LEVEL SECURITY;

-- Revoke anon access (belt and suspenders)
REVOKE ALL ON public.teachers FROM anon;
REVOKE ALL ON public.classes FROM anon;
REVOKE ALL ON public.grades FROM anon;
REVOKE ALL ON public.subjects FROM anon;
REVOKE ALL ON public.quarters FROM anon;
REVOKE ALL ON public.rules FROM anon;
REVOKE ALL ON public.restrictions FROM anon;
REVOKE ALL ON public.schedule_generations FROM anon;
REVOKE ALL ON public.timetable_templates FROM anon;

-- Also revoke from authenticated role since we don't use Supabase Auth
REVOKE ALL ON public.teachers FROM authenticated;
REVOKE ALL ON public.classes FROM authenticated;
REVOKE ALL ON public.grades FROM authenticated;
REVOKE ALL ON public.subjects FROM authenticated;
REVOKE ALL ON public.quarters FROM authenticated;
REVOKE ALL ON public.rules FROM authenticated;
REVOKE ALL ON public.restrictions FROM authenticated;
REVOKE ALL ON public.schedule_generations FROM authenticated;
REVOKE ALL ON public.timetable_templates FROM authenticated;

-- Note: The service_role has full access by default and bypasses RLS
-- Our API routes use the service role key for all database operations
