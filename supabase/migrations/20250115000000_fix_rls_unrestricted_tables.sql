-- Fix RLS for password_activity_log, soul_ai_insights, and wellness_daily_checkins
-- This migration addresses the "Unrestricted" security warnings

-- ============================================
-- 1. password_activity_log: Enable RLS and add policies
-- ============================================
ALTER TABLE IF EXISTS public.password_activity_log ENABLE ROW LEVEL SECURITY;

-- Note: Edge functions use service role which bypasses RLS, so they can insert without a policy
-- We don't create an INSERT policy to prevent regular users from inserting
-- Only service role (edge functions) can insert

-- Users can only read their own password activity logs
-- Note: user_id in this table stores email (text), not uuid

-- Remove all existing policies on password_activity_log
DO $$

DECLARE policy_name text;

BEGIN

  FOR policy_name IN

    SELECT policyname

    FROM pg_policies

    WHERE schemaname = 'public'

      AND tablename = 'password_activity_log'

  LOOP

    EXECUTE format('DROP POLICY IF EXISTS "%s" ON public.password_activity_log;', policy_name);

  END LOOP;

END $$;



-- Create the correct policy
-- Note: user_id in password_activity_log is text (email), so we compare as text
CREATE POLICY "Users can read own password activity"
ON public.password_activity_log
FOR SELECT
USING (
  user_id::text = (auth.jwt()->>'email')::text
);

-- No UPDATE or DELETE for password_activity_log (it's a log table - immutable)

-- ============================================
-- 2. soul_ai_insights: Add missing UPDATE and DELETE policies
-- ============================================
-- UPDATE policy
DROP POLICY IF EXISTS "Users can update own soul insights" ON public.soul_ai_insights;
CREATE POLICY "Users can update own soul insights"
ON public.soul_ai_insights
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- DELETE policy
DROP POLICY IF EXISTS "Users can delete own soul insights" ON public.soul_ai_insights;
CREATE POLICY "Users can delete own soul insights"
ON public.soul_ai_insights
FOR DELETE
USING (auth.uid() = user_id);

-- ============================================
-- 3. wellness_daily_checkins: Add missing DELETE policy
-- ============================================
-- DELETE policy
DROP POLICY IF EXISTS "Users can delete own wellness checkins" ON public.wellness_daily_checkins;
CREATE POLICY "Users can delete own wellness checkins"
ON public.wellness_daily_checkins
FOR DELETE
USING (auth.uid() = user_id);

