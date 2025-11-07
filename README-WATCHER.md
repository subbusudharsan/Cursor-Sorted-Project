# 🚀 Supabase Edge Functions Auto-Deploy System

## ✅ What This Does

Every time you save a file in `/supabase/functions`, it **automatically deploys** to your Supabase project. No manual commands needed!

## 🎯 Key Features

- **Auto-Deploy**: Saves trigger instant deployment
- **File Hashing**: Only deploys when files actually change
- **Debouncing**: Groups rapid changes (2-second window)
- **Secret Sync**: Automatically syncs environment variables
- **Backups**: Creates timestamped backups before deployment
- **Health Monitoring**: Logs all deployments and errors
- **Persistent Watcher**: Runs in background, survives terminal restarts

## 📋 How It Works

1. **Watcher Starts Automatically**
   - Runs when you execute `npm run dev`, `npm start`, etc.
   - Uses `prestart` and `predev` hooks
   - Checks if already running (no duplicates)

2. **File Changes Detected**
   - Watches `/supabase/functions/**/*.ts`
   - Calculates SHA256 hash to detect real changes
   - Ignores unchanged files (even if saved)

3. **Deployment Pipeline**
   ```
   File Save → Hash Check → Debounce → Backup → Deploy → Update Timestamp
   ```

4. **Supabase Dashboard Updates**
   - "Last updated" timestamp refreshes immediately
   - New function code is live within 2-5 seconds
   - Your app uses the latest backend when you run `npm run dev`

## 🔧 Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start app + auto-enable watcher |
| `npm run watcher:status` | Check if watcher is running |
| `npm run watcher:start` | Manually start watcher |
| `npm run watcher:stop` | Stop watcher |
| `npm run watcher:restart` | Restart watcher |
| `npm run watcher:logs` | View live deployment logs |
| `npm run sync:secrets` | Manually sync secrets |

## 📊 Monitoring

**Check Status:**
```bash
npm run watcher:status
```

**View Logs:**
```bash
npm run watcher:logs
# or
cat logs/watcher.log
```

**View Deployment History:**
```bash
cat logs/deployments.log
```

## 📁 File Structure

```
project/
├── supabase/
│   └── functions/
│       ├── generate-contextual-options/
│       │   └── index.ts          ← Edit this, auto-deploys!
│       ├── invoke-claude/
│       │   └── index.ts          ← Edit this, auto-deploys!
│       └── ...
├── logs/
│   ├── watcher.log               ← Watcher process logs
│   └── deployments.log           ← Deployment history
├── safe_backups/
│   ├── generate-contextual-options/
│   │   ├── index_2025-01-01T12-00-00.ts
│   │   └── index_2025-01-02T14-30-00.ts
│   └── ...
├── deploy-functions.mjs          ← Core watcher logic
├── ensure-watcher.mjs            ← Guarantees watcher is running
├── start-watcher.mjs             ← Starts detached watcher
├── stop-watcher.mjs              ← Stops watcher gracefully
├── sync-secrets.mjs              ← Syncs .env to Supabase
└── watcher.pid                   ← Tracks watcher process ID
```

## 🔐 Environment Variables Required

```env
SUPABASE_PROJECT_ID=your-project-id
SUPABASE_ACCESS_TOKEN=your-access-token
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CLAUDE_API_KEY=your-claude-api-key
```

## 🐛 Troubleshooting

**Watcher Not Starting?**
```bash
# Check logs
cat logs/watcher.log

# Manually start
npm run watcher:start

# Check .env file has all required variables
npm run check:secrets
```

**Deployment Failing?**
```bash
# Check deployment logs
cat logs/deployments.log

# Verify Supabase credentials
npm run verify:setup

# Manually sync secrets
npm run sync:secrets
```

**Changes Not Deploying?**
```bash
# Verify watcher is running
npm run watcher:status

# Restart watcher
npm run watcher:restart

# Check if file changed (hash comparison)
# Only real content changes trigger deployment
```

**Stop Watcher:**
```bash
npm run watcher:stop
```

## ⚙️ Configuration

Edit `.watcherrc` to customize:
```json
{
  "debounceMs": 2000,        // Wait 2s after last change
  "logRetention": 7,         // Keep logs for 7 days
  "features": {
    "fileHashing": true,     // Only deploy if content changed
    "deduplication": true,   // Prevent duplicate deployments
    "secretSync": true,      // Auto-sync secrets before deploy
    "backups": true          // Create backups before deploy
  }
}
```

## ✨ Benefits

1. **Zero Manual Work**: Just save and deploy
2. **Always Fresh**: Latest code in Supabase dashboard
3. **Safe Backups**: Timestamped copies before each deploy
4. **Fast Feedback**: 2-5 second deployment time
5. **Error Handling**: Logs all issues for debugging
6. **Efficient**: Only deploys actual changes (SHA256 hashing)

## 🎉 Success Indicators

When working correctly, you'll see:
- ✅ Watcher health check every 60 seconds in logs
- ✅ "Last updated" timestamp updates in Supabase dashboard
- ✅ `logs/deployments.log` shows successful deploys
- ✅ `npm run watcher:status` shows running PID

## 📞 Need Help?

1. Check logs: `npm run watcher:logs`
2. Verify setup: `npm run verify:setup`
3. Restart watcher: `npm run watcher:restart`
4. Check this README: `cat README-WATCHER.md`
