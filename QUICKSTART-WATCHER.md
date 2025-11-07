# 🚀 Quick Start - Auto-Deploy System

## First Time Setup (One-Time Only)

```bash
npm run init:watcher
```

This will:
- ✅ Verify all environment variables
- ✅ Sync secrets to Supabase
- ✅ Start the background watcher
- ✅ Deploy all functions once

## Normal Usage

Just start your app normally:

```bash
npm run dev
```

The watcher starts automatically in the background!

## How It Works

1. **Save any file** in `/supabase/functions/*/index.ts`
2. **Wait 2 seconds** (debounce period)
3. **Deployment happens automatically**
4. **Check Supabase dashboard** - "Last updated" timestamp refreshes

## Quick Commands

```bash
# Check if watcher is running
npm run watcher:status

# View live deployment logs
npm run watcher:logs

# Manually restart watcher (if needed)
npm run watcher:restart

# Stop watcher
npm run watcher:stop
```

## Verification

After saving a function file, check:

1. **Terminal**: See deployment logs
2. **Supabase Dashboard**: Check "Last updated" timestamp
3. **Logs file**: `cat logs/deployments.log`

## Troubleshooting

**Watcher not running?**
```bash
npm run watcher:start
```

**Still having issues?**
```bash
npm run init:watcher
```

**Need help?**
- Read: `cat README-WATCHER.md`
- Check logs: `cat logs/watcher.log`
- Verify .env: `npm run check:secrets`

## Example Workflow

```bash
# Start your app
npm run dev

# Edit a function
nano supabase/functions/generate-contextual-options/index.ts

# Save (Ctrl+O, Enter, Ctrl+X)
# Wait 2 seconds...
# ✅ Automatically deployed!

# Verify in another terminal
npm run watcher:status
tail -f logs/watcher.log
```

That's it! Your functions auto-deploy on every save.
