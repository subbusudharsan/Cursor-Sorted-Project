# Quick Secrets Troubleshooting Guide

## Common Error Messages and Fixes

### ❌ "CLAUDE_API_KEY is not defined"

**What it means**: Edge function can't access the Claude API key.

**Fix (in order)**:
```bash
# 1. Check your .env file has the key
cat .env | grep CLAUDE_API_KEY

# 2. Sync secrets to Supabase
npm run sync:secrets

# 3. Verify it worked
npm run check:secrets

# 4. Redeploy the function
npm run deploy:functions
```

---

### ❌ "ANTHROPIC_API_KEY not configured"

**What it means**: Old variable name is being used.

**Fix**: This should no longer happen after the fix, but if you see it:
```bash
# Redeploy the function to get the latest code
npm run deploy:functions
```

---

### ❌ "Failed to sync secrets"

**What it means**: Can't connect to Supabase Management API.

**Fix**:
```bash
# Check your .env has these:
cat .env | grep SUPABASE_PROJECT_ID
cat .env | grep SUPABASE_ACCESS_TOKEN

# If missing, add them to .env and try again
npm run sync:secrets
```

---

### ⚠️ Secrets Missing After Branch Switch

**What it means**: Git hooks aren't set up or didn't run.

**Fix**:
```bash
# Set up hooks (one time)
npm run setup:hooks

# Then manually sync this time
npm run sync:secrets
```

---

### ⚠️ Function Works Locally but Fails in Supabase

**What it means**: Secrets are in your local `.env` but not synced to cloud.

**Fix**:
```bash
# Sync secrets
npm run sync:secrets

# Check they're there
npm run check:secrets

# Redeploy
npm run deploy:functions
```

---

## Quick Diagnostic Commands

```bash
# Check local .env file
npm run check:secrets

# Sync secrets to Supabase
npm run sync:secrets

# View edge function logs
# (Go to Supabase Dashboard → Edge Functions → Select Function → Logs)

# Test a specific function
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/FUNCTION_NAME \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

---

## Branch Switching Workflow

When switching branches, always:
```bash
git checkout your-branch

# If hooks are set up, secrets sync automatically
# If not, manually sync:
npm run sync:secrets

# Verify
npm run check:secrets
```

---

## New Developer Setup

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Fill in your actual credentials in .env
# (Get these from Supabase Dashboard and Anthropic Console)

# 3. Sync secrets to Supabase
npm run sync:secrets

# 4. Set up Git hooks for auto-sync
npm run setup:hooks

# 5. Verify everything works
npm run check:secrets
```

---

## Emergency Recovery

If everything is broken:

```bash
# 1. Check .env file is complete
cat .env

# 2. Force sync all secrets
npm run sync:secrets

# 3. Verify secrets in Supabase
npm run check:secrets

# 4. Redeploy all functions
npm run deploy:functions

# 5. Check logs in Supabase Dashboard
```

---

## Getting Help

1. Run diagnostics: `npm run check:secrets`
2. Check edge function logs in Supabase Dashboard
3. Review `SECRETS_MANAGEMENT.md` for detailed docs
4. Check `.env.example` for correct variable names

---

## Prevention Checklist

- [ ] `.env` file has all required secrets
- [ ] Git hooks are installed (`npm run setup:hooks`)
- [ ] Secrets are synced (`npm run sync:secrets`)
- [ ] Verified with `npm run check:secrets`
- [ ] Functions deployed (`npm run deploy:functions`)

Run this checklist after:
- Cloning the repository
- Switching branches
- Adding new secrets
- Updating existing secrets
