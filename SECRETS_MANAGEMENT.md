# Supabase Edge Function Secrets Management

This document explains how secrets are managed for Supabase Edge Functions in this project and how to troubleshoot common issues.

## Overview

This project uses an automated secrets synchronization system to ensure that your edge functions always have access to required environment variables, even when switching between branches.

## Quick Start

### Initial Setup

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Fill in your actual credentials in `.env`

3. Sync secrets to Supabase:
   ```bash
   npm run sync:secrets
   ```

4. Set up Git hooks for automatic sync (optional but recommended):
   ```bash
   npm run setup:hooks
   ```

### Verify Everything Works

Check that all secrets are properly configured:
```bash
npm run check:secrets
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run sync:secrets` | Manually sync all secrets to Supabase |
| `npm run check:secrets` | Verify all secrets are configured correctly |
| `npm run setup:hooks` | Install Git hooks for automatic secret sync |
| `npm run deploy:functions` | Deploy all edge functions (automatically syncs secrets first) |

## Required Secrets

All edge functions require these environment variables:

### Core Secrets
- **CLAUDE_API_KEY** - Anthropic Claude API key for AI features
- **SUPABASE_URL** - Your Supabase project URL
- **SUPABASE_ANON_KEY** - Supabase anonymous/public key
- **SUPABASE_SERVICE_ROLE_KEY** - Supabase service role key (admin access)

### Deployment Secrets
- **SUPABASE_PROJECT_ID** - Your Supabase project ID
- **SUPABASE_ACCESS_TOKEN** - Personal access token for Supabase Management API

## How It Works

### Automatic Secret Synchronization

1. **During Deployment**: When you run `npm run deploy:functions`, secrets are automatically synced before deploying the function code.

2. **Branch Switching**: If you set up Git hooks, secrets are automatically synced when you:
   - Switch branches (`git checkout`)
   - Pull/merge changes (`git merge`, `git pull`)

3. **Manual Sync**: You can manually sync at any time with `npm run sync:secrets`

### What Gets Synced

The sync process:
1. Reads secrets from your local `.env` file
2. Validates all required secrets are present
3. Pushes secrets to Supabase using the Management API
4. Verifies secrets are accessible

## Troubleshooting

### "CLAUDE_API_KEY is not defined" Error

**Cause**: Edge function cannot access the API key secret.

**Solutions**:
1. Check your local `.env` file has `CLAUDE_API_KEY` set
2. Run `npm run sync:secrets` to push secrets to Supabase
3. Run `npm run check:secrets` to verify the sync worked
4. Redeploy the affected function: `npm run deploy:functions`

### Secrets Missing After Branch Switch

**Cause**: Secrets weren't automatically synced.

**Solutions**:
1. Set up Git hooks: `npm run setup:hooks`
2. Manually sync: `npm run sync:secrets`
3. Check `.githooks/` directory exists

### "Failed to sync secrets" Error

**Possible Causes**:
- Missing `SUPABASE_PROJECT_ID` in `.env`
- Missing `SUPABASE_ACCESS_TOKEN` in `.env`
- Invalid access token
- Network connectivity issues

**Solutions**:
1. Verify `SUPABASE_PROJECT_ID` and `SUPABASE_ACCESS_TOKEN` are in `.env`
2. Get a fresh access token from: https://app.supabase.com/account/tokens
3. Run `npm run check:secrets` to diagnose

### Edge Function Shows Different Error in Logs

**Steps to Debug**:
1. Check edge function logs in Supabase Dashboard
2. Run `npm run check:secrets` to verify configuration
3. Check which secrets that specific function needs (see below)
4. Sync secrets: `npm run sync:secrets`
5. Redeploy: `npm run deploy:functions`

## Function-Specific Secret Requirements

| Function | Required Secrets |
|----------|------------------|
| `invoke-claude` | CLAUDE_API_KEY |
| `orchestrate-conversation` | CLAUDE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY |
| `generate-contextual-options` | CLAUDE_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY |
| `analyze-conversation-state` | CLAUDE_API_KEY |
| `validate-option-relevance` | CLAUDE_API_KEY |
| `evaluate-closure-readiness` | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY |
| `validate-context-quality` | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY |

## Git Hooks

Git hooks provide automatic secret synchronization when working with branches.

### Installing Hooks

```bash
npm run setup:hooks
```

### What Hooks Do

- **post-checkout**: Syncs secrets when switching branches
- **post-merge**: Syncs secrets after merging branches

### Verifying Hooks Are Active

Check if hooks are installed:
```bash
ls -la .git/hooks/post-checkout
ls -la .git/hooks/post-merge
```

## Security Best Practices

1. **Never Commit `.env`**: This file is in `.gitignore` and should NEVER be committed
2. **Use `.env.example`**: Share this template with your team (without actual secrets)
3. **Rotate Keys Regularly**: Update API keys periodically
4. **Different Keys Per Environment**: Use separate keys for development and production
5. **Audit Access**: Regularly review who has access to your Supabase project

## Advanced Usage

### Syncing Only Specific Secrets

Currently, the system syncs all required secrets. To customize which secrets are synced, edit `sync-secrets.mjs` and modify the `REQUIRED_SECRETS` object.

### Adding New Secrets

1. Add the secret to your `.env` file
2. Add the secret name to `REQUIRED_SECRETS` in `sync-secrets.mjs`
3. Add the secret to your edge function's requirements in `check-secrets.mjs`
4. Run `npm run sync:secrets`

### Environment-Specific Secrets

You can maintain multiple `.env` files:
- `.env` - Default (development)
- `.env.production` - Production secrets
- `.env.staging` - Staging secrets

Load specific environments:
```bash
cp .env.production .env
npm run sync:secrets
```

## FAQs

**Q: Do I need to sync secrets every time I deploy?**
A: No, `deploy:functions` automatically syncs secrets before deployment.

**Q: What happens if I forget to sync secrets?**
A: Edge functions will fail at runtime with "not configured" errors.

**Q: Can I see my secrets in Supabase Dashboard?**
A: Yes, go to Project Settings → Edge Functions → Secrets (values are masked for security).

**Q: Do secrets persist across branches?**
A: Yes, secrets are stored in Supabase (not in git), so they persist. However, you should sync after switching branches to ensure your local `.env` matches the cloud.

**Q: How do I update a secret?**
A: Update it in `.env`, then run `npm run sync:secrets`.

## Support

If you encounter issues:
1. Run `npm run check:secrets` for diagnostics
2. Check edge function logs in Supabase Dashboard
3. Review this document's troubleshooting section
4. Check `.env.example` for correct variable names

## Migration Note

**IMPORTANT**: This project previously used `ANTHROPIC_API_KEY` in some functions. All functions now use `CLAUDE_API_KEY` for consistency. If you have old functions deployed, they may need redeployment after syncing secrets.
