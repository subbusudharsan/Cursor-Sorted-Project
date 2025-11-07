# Immediate Next Steps - Secrets Fix Deployment

## Critical: Run These Commands Now

### Step 1: Sync Secrets to Supabase
```bash
npm run sync:secrets
```

**Expected Output**:
- ✅ All required secrets validated
- ✅ Secrets synced to Supabase
- ✅ Verification passed

**If it fails**: Check that your `.env` file has all required variables. See [TROUBLESHOOTING_SECRETS.md](./TROUBLESHOOTING_SECRETS.md)

---

### Step 2: Set Up Git Hooks (Recommended)
```bash
npm run setup:hooks
```

**Expected Output**:
- ✅ Git hooks installed successfully
- Hooks active: post-checkout, post-merge

**What this does**: Automatically syncs secrets when you switch branches

---

### Step 3: Verify Configuration
```bash
npm run check:secrets
```

**Expected Output**:
- ✅ Local .env file: All required secrets present
- ✅ Supabase Cloud: All required secrets present
- ✅ All edge functions have required secrets

**If any ❌ appear**: See [TROUBLESHOOTING_SECRETS.md](./TROUBLESHOOTING_SECRETS.md)

---

### Step 4: Deploy Fixed Functions
```bash
npm run deploy:functions
```

**What this does**:
1. Syncs secrets (again, to be safe)
2. Zips all edge functions
3. Deploys to Supabase
4. Watches for changes

**Expected Output**:
- ✅ Secrets synchronized successfully
- ✅ [function-name] deployed or updated successfully (for each function)

---

### Step 5: Test a Function

Test that the fix worked by calling one of your edge functions:

```bash
# Replace YOUR_PROJECT with your actual Supabase project ID
# Replace YOUR_ANON_KEY with your actual anon key

curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/generate-contextual-options \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "test",
    "recipientId": "test-recipient",
    "currentUserId": "test-user",
    "currentMessage": "Hello",
    "conversationHistory": []
  }'
```

**Expected**: Should return options (not "CLAUDE_API_KEY is not defined" error)

---

### Step 6: Check Logs

Go to Supabase Dashboard:
1. Navigate to: Edge Functions → generate-contextual-options → Logs
2. Look for recent requests
3. Verify no "not defined" errors

---

## Testing Branch Switching

Now test that the fix works across branches:

```bash
# Create a test branch
git checkout -b test-branch

# Observe: If hooks are set up, you should see:
# "🔄 Branch checkout detected: syncing Supabase secrets..."
# "✅ Secrets synced successfully after branch switch"

# Switch back
git checkout main

# Again, should see automatic secret sync
```

---

## Verification Checklist

After completing the above steps, verify:

- [ ] `npm run check:secrets` shows all ✅
- [ ] `npm run deploy:functions` completed successfully
- [ ] Edge function logs show no "not defined" errors
- [ ] Test curl request returns valid response
- [ ] Git hooks are installed (optional but recommended)
- [ ] Branch switching triggers automatic secret sync

---

## If Something Goes Wrong

1. **Check Secrets Health**:
   ```bash
   npm run check:secrets
   ```

2. **Re-sync Secrets**:
   ```bash
   npm run sync:secrets
   ```

3. **Redeploy Functions**:
   ```bash
   npm run deploy:functions
   ```

4. **Check Edge Function Logs**:
   - Go to Supabase Dashboard
   - Edge Functions → [function name] → Logs
   - Look for error messages

5. **See Troubleshooting Guide**:
   [TROUBLESHOOTING_SECRETS.md](./TROUBLESHOOTING_SECRETS.md)

---

## Understanding What Was Fixed

### The Critical Bug
**File**: `supabase/functions/generate-contextual-options/index.ts`
- **Before**: Variable was read as `anthropicApiKey` but used as `CLAUDE_API_KEY` (undefined!)
- **After**: Consistently uses `CLAUDE_API_KEY` throughout

### The Branch Switching Issue
**Before**:
- Switch branches
- Secrets only in local `.env`
- Edge functions can't access them
- Everything breaks ❌

**After**:
- Switch branches
- Git hook auto-syncs secrets to Supabase
- Edge functions access via `Deno.env.get()`
- Everything works ✅

---

## Ongoing Usage

### Every Time You:

**Switch Branches**:
- Hooks auto-sync (if installed)
- Or run: `npm run sync:secrets`

**Update Secrets**:
1. Edit `.env` file
2. Run: `npm run sync:secrets`
3. Run: `npm run deploy:functions` (if needed)

**Deploy Functions**:
- Just run: `npm run deploy:functions`
- Secrets sync automatically!

**Add New Secrets**:
1. Add to `.env`
2. Add to `sync-secrets.mjs` REQUIRED_SECRETS
3. Add to `check-secrets.mjs` function map
4. Run: `npm run sync:secrets`

---

## Team Onboarding

When a new developer joins:

1. Give them `.env.example`
2. They create `.env` with their credentials
3. They run: `npm run sync:secrets`
4. They run: `npm run setup:hooks`
5. They run: `npm run check:secrets`
6. Done! ✅

Share these guides with them:
- [SECRETS_MANAGEMENT.md](./SECRETS_MANAGEMENT.md)
- [TROUBLESHOOTING_SECRETS.md](./TROUBLESHOOTING_SECRETS.md)

---

## Success Metrics

You'll know it's working when:
- ✅ No "CLAUDE_API_KEY is not defined" errors
- ✅ Functions work after branch switches
- ✅ `npm run check:secrets` shows all green
- ✅ Edge function logs show successful runs
- ✅ Team members can sync secrets easily

---

## Questions?

- **Secrets not syncing?** → [TROUBLESHOOTING_SECRETS.md](./TROUBLESHOOTING_SECRETS.md)
- **How does it work?** → [SECRETS_MANAGEMENT.md](./SECRETS_MANAGEMENT.md)
- **Technical details?** → [SECRETS_FIX_SUMMARY.md](./SECRETS_FIX_SUMMARY.md)
- **Quick fixes?** → Run `npm run check:secrets` for diagnostics

---

**Ready to deploy?** Start with Step 1 above! 🚀
