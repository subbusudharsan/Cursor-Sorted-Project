-- Update the delete_auth_user_data function with improved error handling
-- This migration updates the existing function to handle different Supabase versions

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
  -- Use explicit type casting to handle both UUID and TEXT user_id columns
  
  -- 1. Delete refresh tokens (references sessions)
  -- Try UUID first, then TEXT if that fails
  BEGIN
    DELETE FROM auth.refresh_tokens WHERE user_id = target_user_id;
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM auth.refresh_tokens WHERE user_id::TEXT = target_user_id_text;
  END;
  
  -- 2. Delete sessions (references users)
  BEGIN
    DELETE FROM auth.sessions WHERE user_id = target_user_id;
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM auth.sessions WHERE user_id::TEXT = target_user_id_text;
  END;
  
  -- 3. Delete MFA challenges (references mfa_factors)
  BEGIN
    DELETE FROM auth.mfa_challenges WHERE factor_id IN (
      SELECT id FROM auth.mfa_factors WHERE user_id = target_user_id
    );
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM auth.mfa_challenges WHERE factor_id IN (
      SELECT id FROM auth.mfa_factors WHERE user_id::TEXT = target_user_id_text
    );
  END;
  
  -- 4. Delete MFA factors (references users)
  BEGIN
    DELETE FROM auth.mfa_factors WHERE user_id = target_user_id;
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM auth.mfa_factors WHERE user_id::TEXT = target_user_id_text;
  END;
  
  -- 5. Delete flow state (references users)
  BEGIN
    DELETE FROM auth.flow_state WHERE user_id = target_user_id;
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM auth.flow_state WHERE user_id::TEXT = target_user_id_text;
  END;
  
  -- 6. Delete audit log entries (handle different Supabase versions)
  BEGIN
    -- Try UUID first
    DELETE FROM auth.audit_log_entries WHERE user_id = target_user_id;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      -- Try TEXT
      DELETE FROM auth.audit_log_entries WHERE user_id::TEXT = target_user_id_text;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        -- Try instance_id approach
        DELETE FROM auth.audit_log_entries WHERE instance_id IN (
          SELECT instance_id FROM auth.users WHERE id = target_user_id
        );
      EXCEPTION WHEN OTHERS THEN
        -- If none work, skip (table structure may vary)
        NULL;
      END;
    END;
  END;
  
  -- 7. Delete identities (references users) - this is critical
  BEGIN
    DELETE FROM auth.identities WHERE user_id = target_user_id;
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM auth.identities WHERE user_id::TEXT = target_user_id_text;
  END;
  
  -- 8. Delete refresh token audits if they exist (some Supabase versions)
  BEGIN
    DELETE FROM auth.refresh_token_audits WHERE user_id = target_user_id;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      DELETE FROM auth.refresh_token_audits WHERE user_id::TEXT = target_user_id_text;
    EXCEPTION WHEN OTHERS THEN
      -- Column might not exist in all Supabase versions
      NULL;
    END;
  END;
  
  -- Note: We don't delete from auth.users here - that's handled by deleteUser
  -- We also don't delete from auth.instances, auth.sso_domains, etc. as they're shared
  
END;
$$;

