# Supabase Edge Functions Auto-Deploy System

## Overview

This project includes a fully automated, Bolt.New-safe deployment system for Supabase Edge Functions that:

- ✅ Automatically deploys functions when you edit files
- ✅ Works continuously without blocking Bolt.New builds
- ✅ Syncs secrets automatically before each deployment
- ✅ Detects real file changes using hash tracking
- ✅ Prevents duplicate deployments with debouncing
- ✅ Runs as a detached background process
- ✅ Survives container restarts and branch switches
- ✅ Logs all deployments with timestamps

## Quick Start

### 1. Initial Setup

```bash
# Sync secrets to Supabase
npm run sync:secrets

# Verify secrets are configured
npm run check:secrets
```

### 2. Start Development

```bash
# This automatically starts the watcher in the background
npm run dev
```

The watcher will:
1. Sync secrets with Supabase
2. Deploy all functions once
3. Start monitoring for file changes
4. Auto-deploy when you edit any function

### 3. Edit Functions

Simply edit any file in `supabase/functions/*/index.ts` and save. The watcher will:

```
[2025-10-22 14:30:15] 📝 File change detected: invoke-claude/index.ts
[2025-10-22 14:30:17] 🚀 Deploying invoke-claude...
[2025-10-22 14:30:20] ✅ invoke-claude deployed successfully in 2.85s
```

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Expo + auto-watcher |
| `npm run start:watcher` | Start watcher manually |
| `npm run stop:watcher` | Stop the watcher |
| `npm run sync:secrets` | Sync secrets to Supabase |
| `npm run check:secrets` | Verify secret configuration |
| `npm run deploy:functions` | Deploy all functions manually |

## How It Works

### 1. Detached Background Process

When you run `npm run dev`, the system:

```
start-watcher.mjs
  ├─ Checks if watcher is already running (PID file)
  ├─ Spawns deploy-functions.mjs as detached process
  ├─ Writes PID to watcher.pid
  └─ Exits, letting watcher run independently
```

### 2. File Change Detection

The watcher uses **hash-based change detection**:

```javascript
// Calculates SHA-256 hash of file content
const hash = crypto.createHash('sha256').update(content).digest('hex');

// Only deploys if hash changed
if (currentHash !== previousHash) {
  deploy(function);
}
```

This prevents duplicate deployments even if you save the file multiple times.

### 3. Debouncing

Changes are debounced for 2 seconds to handle rapid file saves:

```
Edit 1 → Schedule deploy in 2s
Edit 2 → Cancel previous, schedule new deploy in 2s
Edit 3 → Cancel previous, schedule new deploy in 2s
  ↓
Wait 2s with no edits
  ↓
Deploy once
```

### 4. Deployment Queue

Only one deployment per function runs at a time:

```javascript
// Tracks active deployments
if (activeDeployments.has(fnName)) {
  log('⏭️  Skipping - deployment already in progress');
  return;
}
```

### 5. Secrets Synchronization

Before each deployment cycle, secrets are synced:

```javascript
await syncSecretsAsync(); // Non-blocking
await deployAll();        // Deploy with fresh secrets
watchAndDeploy();         // Start monitoring
```

## Configuration

### Environment Variables (.env)

```bash
# Required for auto-deployment
SUPABASE_PROJECT_ID=your_project_id
SUPABASE_ACCESS_TOKEN=your_access_token

# Synced to Supabase as secrets
CLAUDE_API_KEY=sk-ant-api03-...
EXPO_PUBLIC_SUPABASE_URL=https://....supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhb...
SUPABASE_SERVICE_ROLE_KEY=eyJhb...
```

### Deployment Settings

Edit `deploy-functions.mjs` to customize:

```javascript
const DEBOUNCE_MS = 2000;        // Wait time before deploy
const FUNCTIONS_DIR = "./supabase/functions";
const BACKUP_DIR = "./safe_backups";
const LOGS_DIR = "./logs";
```

## Logs and Debugging

### View Watcher Logs

```bash
tail -f logs/watcher.log
```

### View Deployment History

```bash
cat logs/deployments.log
```

Example output:
```
[2025-10-22 14:30:20] ✅ invoke-claude - Success (2.85s)
[2025-10-22 14:32:45] ✅ orchestrate-conversation - Success (3.12s)
[2025-10-22 14:35:10] ❌ invalid-function - Failed: 404 - Not Found
```

### Check Watcher Status

```bash
# Check if watcher is running
ps aux | grep deploy-functions

# View PID
cat watcher.pid
```

## Troubleshooting

### Watcher Not Starting

```bash
# Check for errors
cat logs/watcher.log

# Manually start watcher
npm run start:watcher
```

### Functions Not Deploying

```bash
# 1. Verify secrets are synced
npm run check:secrets

# 2. Check if watcher is running
ps aux | grep deploy-functions

# 3. View logs
tail -f logs/watcher.log
```

### Duplicate Deployments

The system automatically prevents this with:
- Hash-based change detection (only deploys if content changed)
- Debouncing (waits 2s after last edit)
- Active deployment tracking (one deploy per function at a time)

### After Branch Switch

Git hooks automatically sync secrets when you switch branches:

```bash
git checkout new-branch
# Triggers: post-checkout hook → npm run sync:secrets
```

### Stopping the Watcher

```bash
# Graceful shutdown
npm run stop:watcher

# Force kill
kill $(cat watcher.pid)
```

## Branch Safety

### Git Hooks

The system includes git hooks in `.githooks/`:

| Hook | Trigger | Action |
|------|---------|--------|
| `post-checkout` | Branch switch | Sync secrets |
| `post-merge` | After merge | Sync secrets |
| `pre-push` | Before push | Validate secrets |

### Setup Git Hooks

```bash
npm run setup:hooks
```

This configures Git to use `.githooks/` for all hook scripts.

## Bolt.New Integration

### Why It Works in Bolt

1. **Non-blocking**: Uses detached child processes
2. **No execSync**: All operations are async
3. **Separate process**: Watcher runs independently of Expo
4. **Clean exit**: Doesn't interrupt Bolt builds
5. **Ignored folders**: Logs/backups excluded from TypeScript compilation

### Excluded from Builds

The following are excluded from TypeScript and Git:

```
.gitignore:
  - .githooks/
  - safe_backups/
  - logs/
  - *.pid
  - watcher.log

tsconfig.json:
  - safe_backups
  - .githooks
  - logs
  - node_modules
```

## Advanced Usage

### Manual Deployment

```bash
# Deploy all functions once (no watcher)
node deploy-functions.mjs

# Deploy to production
npm run deploy:functions
```

### Custom Watcher

Create your own watcher with custom behavior:

```javascript
import chokidar from 'chokidar';

const watcher = chokidar.watch('./supabase/functions', {
  ignored: /(^|[\/\\])\../,
  persistent: true,
  awaitWriteFinish: {
    stabilityThreshold: 500,
    pollInterval: 100
  }
});

watcher.on('change', (filePath) => {
  console.log(`File changed: ${filePath}`);
  // Your custom deployment logic
});
```

### Deployment Pipeline

For CI/CD integration:

```yaml
# .github/workflows/deploy.yml
name: Deploy Functions
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run sync:secrets
        env:
          SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      - run: npm run deploy:functions
```

## Best Practices

1. **Always sync secrets** after switching branches
2. **Check logs** if functions aren't deploying
3. **Stop watcher** before major system changes
4. **Commit function changes** separately from config changes
5. **Test locally** before pushing to production

## Support

If you encounter issues:

1. Check logs: `tail -f logs/watcher.log`
2. Verify secrets: `npm run check:secrets`
3. Restart watcher: `npm run stop:watcher && npm run start:watcher`
4. Review this guide for troubleshooting steps

---

**System Status**: ✅ Production Ready

Last Updated: 2025-10-22
