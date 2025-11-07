# Quick Deploy Reference

## 🚀 Start Development (Auto-Deploy Enabled)

```bash
npm run dev
```

This automatically:
- ✅ Starts the watcher in background
- ✅ Syncs secrets to Supabase
- ✅ Deploys all functions once
- ✅ Monitors for file changes
- ✅ Starts Expo dev server

## 📝 Edit & Deploy

Just edit any function file:

```
supabase/functions/invoke-claude/index.ts
```

Save the file → Auto-deploys in ~2 seconds!

## 🎛️ Manual Controls

```bash
# Start watcher manually
npm run start:watcher

# Stop watcher
npm run stop:watcher

# Sync secrets
npm run sync:secrets

# Check secret status
npm run check:secrets

# Deploy all functions once (no watch)
npm run deploy:functions
```

## 📊 Monitor Logs

```bash
# Real-time watcher logs
tail -f logs/watcher.log

# Deployment history
cat logs/deployments.log

# Check if watcher is running
cat watcher.pid
```

## 🔍 Expected Output

When you edit a function:

```
[2025-10-22 14:30:15] 📝 File change detected: invoke-claude/index.ts
[2025-10-22 14:30:17] 🚀 Deploying invoke-claude...
[2025-10-22 14:30:20] ✅ invoke-claude deployed successfully in 2.85s
```

## ⚠️ Troubleshooting

### Functions not deploying?

```bash
# 1. Check secrets
npm run check:secrets

# 2. Check watcher status
ps aux | grep deploy-functions

# 3. Restart watcher
npm run stop:watcher
npm run start:watcher

# 4. View logs
tail -f logs/watcher.log
```

### After switching branches?

```bash
# Secrets auto-sync via git hooks
git checkout new-branch
# → Automatically runs: npm run sync:secrets
```

### Watcher died?

```bash
# Just restart it
npm run start:watcher
```

## 🎯 Quick Tips

1. **First time setup**: Run `npm run sync:secrets` before development
2. **Multiple edits**: Save normally - debouncing prevents duplicate deploys
3. **Branch switches**: Secrets sync automatically via git hooks
4. **Bolt builds**: Watcher runs separately, won't block builds
5. **Check logs**: Always available in `logs/` folder

## 📦 What Gets Deployed

Only functions in: `supabase/functions/*/index.ts`

Current functions:
- invoke-claude
- orchestrate-conversation
- generate-contextual-options
- analyze-conversation-state
- validate-option-relevance
- evaluate-closure-readiness
- validate-context-quality
- add-contact-relationship
- delete-user-account
- send-email-invite
- send-push-notification

## 🔐 Required Secrets

In `.env` file:

```bash
SUPABASE_PROJECT_ID=your_project_id
SUPABASE_ACCESS_TOKEN=your_access_token
CLAUDE_API_KEY=sk-ant-...
EXPO_PUBLIC_SUPABASE_URL=https://...
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

---

**Quick Start**: `npm run dev` → Edit functions → Watch them deploy! 🎉
