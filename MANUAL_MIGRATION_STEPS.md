# Manual Migration Steps (if automated push fails)

If `supabase db push` keeps getting interrupted, you can apply the migration manually:

## Step 1: Apply Migration via Supabase Dashboard

1. Go to Supabase Dashboard → Database → SQL Editor
2. Copy and paste the contents of `supabase/migrations/20251125000004_add_direct_user_deletion.sql`
3. Click "Run" to execute the SQL

## Step 2: Verify Function Exists

Run this query in SQL Editor to verify:
```sql
SELECT proname, pg_get_function_arguments(oid) 
FROM pg_proc 
WHERE proname = 'delete_auth_user_direct';
```

## Step 3: Deploy Edge Function

The edge function code is already updated. If not deployed yet, run:
```bash
node deploy-functions.mjs delete-user-account
```

## What This Fix Does

1. Creates `delete_auth_user_direct()` function that:
   - Cleans all auth tables via `delete_auth_user_data()`
   - Directly deletes from `auth.users` table (bypasses API constraints)
   
2. Edge function now:
   - Tries direct SQL deletion first
   - Falls back to admin API if direct SQL fails
   - Provides better error handling


