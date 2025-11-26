-- Fix type casting issues in delete_auth_user_data function
-- Cast UUID to TEXT for all comparisons to handle both UUID and TEXT user_id columns

CREATE OR REPLACE FUNCTION public.delete_auth_user_data(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  target_user_id_text TEXT;
BEGIN
  -- Convert UUID to TEXT for compatibility with tables that use TEXT user_id
  target_user_id_text := target_user_id::TEXT;
  
  -- Delete in order to respect foreign key constraints
  -- Cast both sides to TEXT to handle both UUID and TEXT user_id columns
  
  -- 1. Delete refresh tokens (references sessions)
  DELETE FROM auth.refresh_tokens WHERE user_id::TEXT = target_user_id_text;
  
  -- 2. Delete sessions (references users)
  DELETE FROM auth.sessions WHERE user_id::TEXT = target_user_id_text;
  
  -- 3. Delete MFA challenges (references mfa_factors)
  DELETE FROM auth.mfa_challenges WHERE factor_id IN (
    SELECT id FROM auth.mfa_factors WHERE user_id::TEXT = target_user_id_text
  );
  
  -- 4. Delete MFA factors (references users)
  DELETE FROM auth.mfa_factors WHERE user_id::TEXT = target_user_id_text;
  
  -- 5. Delete flow state (references users)
  DELETE FROM auth.flow_state WHERE user_id::TEXT = target_user_id_text;
  
  -- 6. Delete audit log entries (handle different Supabase versions)
  BEGIN
    -- Try direct user_id with TEXT cast
    DELETE FROM auth.audit_log_entries WHERE user_id::TEXT = target_user_id_text;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      -- Try instance_id approach if user_id doesn't exist
      DELETE FROM auth.audit_log_entries WHERE instance_id IN (
        SELECT instance_id FROM auth.users WHERE id = target_user_id
      );
    EXCEPTION WHEN OTHERS THEN
      -- If neither works, skip (table structure may vary)
      NULL;
    END;
  END;
  
  -- 7. Delete identities (references users) - this is critical
  DELETE FROM auth.identities WHERE user_id::TEXT = target_user_id_text;
  
  -- 8. Delete refresh token audits if they exist (some Supabase versions)
  BEGIN
    DELETE FROM auth.refresh_token_audits WHERE user_id::TEXT = target_user_id_text;
  EXCEPTION WHEN OTHERS THEN
    -- Column might not exist in all Supabase versions
    NULL;
  END;
  
  -- Note: We don't delete from auth.users here - that's handled by deleteUser
  -- We also don't delete from auth.instances, auth.sso_domains, etc. as they're shared
  
END;
$$;


