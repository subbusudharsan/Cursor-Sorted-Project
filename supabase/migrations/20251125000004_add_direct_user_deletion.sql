-- Add function to directly delete user from auth.users table
-- This bypasses Supabase API constraints that might block deletion
-- Note: Direct deletion from auth.users may require superuser privileges
-- If this fails, the edge function will fall back to admin API

CREATE OR REPLACE FUNCTION public.delete_auth_user_direct(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- First, ensure all related auth data is cleaned (call the cleanup function)
  -- Use PERFORM to call without checking return value
  BEGIN
    PERFORM public.delete_auth_user_data(target_user_id);
  EXCEPTION WHEN OTHERS THEN
    -- Log but continue - cleanup might have partial success
    RAISE WARNING 'Error during auth data cleanup: %', SQLERRM;
  END;
  
  -- Then directly delete from auth.users table
  -- This bypasses the Supabase API which might have additional constraints
  -- Note: This may fail if we don't have superuser privileges
  DELETE FROM auth.users WHERE id = target_user_id;
  
  -- Verify deletion (only if we have access to check)
  BEGIN
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
      RAISE WARNING 'User still exists after deletion attempt';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Can't verify, but that's okay
    NULL;
  END;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.delete_auth_user_direct(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_auth_user_direct(UUID) TO service_role;

