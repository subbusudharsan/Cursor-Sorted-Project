-- Migration: Create function to clean auth schema tables before user deletion
-- This function deletes all auth-related records for a user to allow deleteUser to succeed

CREATE OR REPLACE FUNCTION public.delete_auth_user_data(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Delete in order to respect foreign key constraints
  
  -- 1. Delete refresh tokens (references sessions)
  DELETE FROM auth.refresh_tokens WHERE user_id = target_user_id;
  
  -- 2. Delete sessions (references users)
  DELETE FROM auth.sessions WHERE user_id = target_user_id;
  
  -- 3. Delete MFA challenges (references mfa_factors)
  DELETE FROM auth.mfa_challenges WHERE factor_id IN (
    SELECT id FROM auth.mfa_factors WHERE user_id = target_user_id
  );
  
  -- 4. Delete MFA factors (references users)
  DELETE FROM auth.mfa_factors WHERE user_id = target_user_id;
  
  -- 5. Delete flow state (references users)
  DELETE FROM auth.flow_state WHERE user_id = target_user_id;
  
  -- 6. Delete audit log entries (simplified - handle different Supabase versions)
  BEGIN
    -- Try direct user_id if column exists
    DELETE FROM auth.audit_log_entries WHERE user_id = target_user_id;
  EXCEPTION WHEN OTHERS THEN
    -- If user_id column doesn't exist, try instance_id approach
    BEGIN
      DELETE FROM auth.audit_log_entries WHERE instance_id IN (
        SELECT instance_id FROM auth.users WHERE id = target_user_id
      );
    EXCEPTION WHEN OTHERS THEN
      -- If neither works, skip (table structure may vary)
      NULL;
    END;
  END;
  
  -- 7. Delete identities (references users) - this is critical
  DELETE FROM auth.identities WHERE user_id = target_user_id;
  
  -- 8. Delete refresh token audits if they exist (some Supabase versions)
  BEGIN
    DELETE FROM auth.refresh_token_audits WHERE user_id = target_user_id;
  EXCEPTION WHEN OTHERS THEN
    -- Column might not exist in all Supabase versions
    NULL;
  END;
  
  -- Note: We don't delete from auth.users here - that's handled by deleteUser
  -- We also don't delete from auth.instances, auth.sso_domains, etc. as they're shared
  
END;
$$;

-- Grant execute permission to authenticated users (though this will be called via service role)
GRANT EXECUTE ON FUNCTION public.delete_auth_user_data(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_auth_user_data(UUID) TO service_role;

