# Project README

## Quick Start

### Initial Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your actual credentials
   ```

3. **Sync secrets to Supabase**:
   ```bash
   npm run sync:secrets
   ```

4. **Set up Git hooks** (optional, but recommended):
   ```bash
   npm run setup:hooks
   ```

5. **Verify setup**:
   ```bash
   npm run check:secrets
   ```

## Available Commands

### Development
- `npm start` - Start Expo development server
- `npm run dev` - Start Expo with cache cleared
- `npm run web` - Start web development server
- `npm run android` - Start Android development
- `npm run ios` - Start iOS development

### Secrets Management
- `npm run sync:secrets` - Sync environment variables to Supabase
- `npm run check:secrets` - Verify all secrets are configured
- `npm run setup:hooks` - Install Git hooks for automatic secret sync

### Deployment
- `npm run deploy:functions` - Deploy Supabase Edge Functions
- `npm run watch:functions` - Watch and auto-deploy functions on changes
- `npm run build` - Build the application
- `npm run release` - Build and deploy to Netlify

### Utilities
- `npm run doctor` - Run Expo diagnostics
- `npm run type-check` - Check TypeScript types
- `npm run clean` - Clean and reinstall dependencies

## Secrets Management

This project uses an automated secrets management system for Supabase Edge Functions.

### Key Features
- ✅ Automatic secret synchronization during deployment
- ✅ Git hooks for auto-sync on branch switches
- ✅ Health checks to verify secret configuration
- ✅ Clear error messages and troubleshooting guides

### Quick Reference

**After switching branches**:
```bash
# If hooks are set up, secrets sync automatically
# Otherwise, manually sync:
npm run sync:secrets
```

**If you see "CLAUDE_API_KEY is not defined"**:
```bash
npm run sync:secrets
npm run deploy:functions
```

**For detailed help**:
- See [SECRETS_MANAGEMENT.md](./SECRETS_MANAGEMENT.md) - Complete guide
- See [TROUBLESHOOTING_SECRETS.md](./TROUBLESHOOTING_SECRETS.md) - Quick fixes
- See [SECRETS_FIX_SUMMARY.md](./SECRETS_FIX_SUMMARY.md) - Implementation details

## Documentation

- [SECRETS_MANAGEMENT.md](./SECRETS_MANAGEMENT.md) - Secrets management guide
- [TROUBLESHOOTING_SECRETS.md](./TROUBLESHOOTING_SECRETS.md) - Common issues and fixes
- [SECRETS_FIX_SUMMARY.md](./SECRETS_FIX_SUMMARY.md) - Technical implementation details
- [SETUP.md](./SETUP.md) - Additional setup instructions
- [QUICK_START.md](./QUICK_START.md) - Quick start guide

## Project Structure

```
.
├── app/                      # Expo app screens and routes
├── components/               # Reusable React components
├── supabase/functions/       # Edge functions
├── contexts/                 # React contexts
├── hooks/                    # Custom React hooks
├── lib/                      # Utility libraries
├── .githooks/                # Git hooks for auto-sync
├── sync-secrets.mjs          # Secret synchronization script
├── check-secrets.mjs         # Secret health check script
├── deploy-functions.mjs      # Function deployment script
└── setup-git-hooks.sh        # Hook installation script
```

## Environment Variables

All required environment variables are documented in `.env.example`. Key variables:

- `CLAUDE_API_KEY` - Anthropic Claude API key
- `EXPO_PUBLIC_SUPABASE_URL` - Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `SUPABASE_PROJECT_ID` - Supabase project ID
- `SUPABASE_ACCESS_TOKEN` - Supabase management API token

## Troubleshooting

### Edge Functions Failing

1. Check secrets: `npm run check:secrets`
2. Sync secrets: `npm run sync:secrets`
3. Redeploy: `npm run deploy:functions`
4. Check logs in Supabase Dashboard

### After Branch Switch

If functions stop working after switching branches:
```bash
npm run sync:secrets
npm run deploy:functions
```

### Complete Diagnostic

```bash
# 1. Check local environment
npm run check:secrets

# 2. Sync to cloud
npm run sync:secrets

# 3. Verify sync worked
npm run check:secrets

# 4. Redeploy functions
npm run deploy:functions
```

## Support

For issues related to:
- **Secrets**: See [TROUBLESHOOTING_SECRETS.md](./TROUBLESHOOTING_SECRETS.md)
- **Setup**: See [SETUP.md](./SETUP.md)
- **General**: See other documentation files

## License

[Your License Here]
