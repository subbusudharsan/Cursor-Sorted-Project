# Auto-Deploy Quick Reference

## Status
✅ **WORKING & ACTIVE**

Watcher PID: Check with `npm run watcher:status`

## How To Use

### Normal Usage
```bash
npm run dev
# Watcher starts automatically!
# Edit any file in /supabase/functions
# Press Ctrl+S
# Wait 2 seconds
# ✅ Deployed automatically!
```

### Manual Control
```bash
npm run watcher:start     # Start watcher
npm run watcher:stop      # Stop watcher  
npm run watcher:status    # Check status
npm run watcher:restart   # Restart
```

## What Happens When You Save

```
1. File Save (Ctrl+S)
2. Watcher detects change
3. SHA256 hash check (real change?)
4. 2-second debounce wait
5. Create timestamped backup
6. Deploy to Supabase API
7. Update dashboard timestamp
8. Log result to logs/deployments.log
```

## Verify It's Working

1. **Check watcher:**
   ```bash
   npm run watcher:status
   ```
   Should show: ✅ Watcher is running (PID: xxxx)

2. **Edit a function:**
   ```bash
   nano supabase/functions/invoke-claude/index.ts
   # Add a comment: // Test change
   # Save: Ctrl+O, Enter, Ctrl+X
   ```

3. **Check deployment log:**
   ```bash
   tail -f logs/deployments.log
   ```
   Should show: ✅ invoke-claude - Success

4. **Check Supabase Dashboard:**
   - Go to Edge Functions
   - See updated "Last updated" timestamp

## Files & Directories

- `/supabase/functions/*/index.ts` - Edit these to trigger deploy
- `/logs/deployments.log` - Deployment history
- `/logs/watcher.log` - Watcher process log
- `/safe_backups/` - Timestamped backups
- `watcher.pid` - Process ID file
- `package.json` - Has pre-hooks for auto-start

## Troubleshooting

**Watcher not running?**
```bash
npm run watcher:start
```

**Changes not deploying?**
```bash
# Check if watcher is running
npm run watcher:status

# Check logs
tail -20 logs/deployments.log

# Restart watcher
npm run watcher:restart
```

**Deployment failed?**
```bash
# Check error in logs
cat logs/deployments.log | grep "❌"

# Verify credentials
cat .env | grep SUPABASE

# Sync secrets
npm run sync:secrets
```

## Success Indicators

When working correctly:
- ✅ `npm run watcher:status` shows running PID
- ✅ Saving a function file triggers deployment within 2-5s
- ✅ `logs/deployments.log` shows ✅ Success entries
- ✅ Supabase Dashboard "Last updated" timestamp updates
- ✅ No error messages in logs

## Architecture

```
package.json (pre-hooks)
    ↓
ensure-watcher.mjs (checks if running)
    ↓
start-watcher.mjs (spawns detached process)
    ↓
deploy-functions.mjs (watches files, deploys)
    ↓
Supabase API (receives deployments)
```

## Statistics

Total deployments: `cat logs/deployments.log | grep "✅" | wc -l`
Failed deployments: `cat logs/deployments.log | grep "❌" | wc -l`
Last 10 deployments: `tail -10 logs/deployments.log`

## Key Features

- ✅ Auto-starts with `npm run dev`
- ✅ SHA256 hash-based change detection
- ✅ 2-second debounce
- ✅ Timestamped backups
- ✅ Background process (survives terminal close)
- ✅ Health monitoring
- ✅ Comprehensive logging
- ✅ Graceful shutdown
- ✅ No duplicate deployments

## That's It!

Just edit, save, and deploy. No manual commands needed! 🚀
