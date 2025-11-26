-- Apply the delete_auth_user_direct function
-- This can be run directly in Supabase Dashboard -> SQL Editor

CREATE OR REPLACE FUNCTION public.delete_auth_user_direct(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- First, ensure all related auth data is cleaned (call the cleanup function)
  PERFORM public.delete_auth_user_data(target_user_id);
  
  -- Then directly delete from auth.users table
  -- This bypasses the Supabase API which might have additional constraints
  DELETE FROM auth.users WHERE id = target_user_id;
  
  -- Verify deletion
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'User deletion failed - user still exists after deletion attempt';
  END IF;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.delete_auth_user_direct(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_auth_user_direct(UUID) TO service_role;


