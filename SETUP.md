# Sorted App - Clean Setup Guide

## Prerequisites
- Node.js 18+ installed
- Git installed
- A code editor (VS Code recommended)

## Clean Installation Steps

### 1. Install Expo CLI Globally (Recommended)
```bash
npm install -g @expo/cli@latest
```

### 2. Verify Installation
```bash
expo --version
```

### 3. Clean Project Setup
```bash
# Clean install dependencies
npm run clean:modules

# Fix any dependency issues
npm run setup

# Verify everything is working
npm run doctor
```

### 4. Start Development Server
```bash
# For web development
npm run web

# For mobile development (requires Expo Go app)
npm start

# For development with clearing cache
npm run dev
```

## Alternative: Use npx (No Global Install)
If you prefer not to install Expo CLI globally:

```bash
# Clean dependencies
rm -rf node_modules package-lock.json
npm install

# Start with npx
npx expo start --web
```

## Troubleshooting Commands

### Clear All Caches
```bash
npm run clean
```

### Reset Everything
```bash
npm run clean:modules
npm run setup
```

### Check for Issues
```bash
npm run doctor
```

### Manual Cache Clear
```bash
npx expo r -c
rm -rf node_modules/.cache
rm -rf .expo
```

## Development Workflow

1. **Web Development**: `npm run web`
2. **Mobile Testing**: `npm start` + Expo Go app
3. **Clean Restart**: `npm run dev`

## Common Issues & Solutions

### Issue: "expo command not found"
**Solution**: Install globally or use npx
```bash
npm install -g @expo/cli@latest
# OR
npx expo start --web
```

### Issue: Dependency conflicts
**Solution**: Clean install
```bash
npm run clean:modules
```

### Issue: Cache problems
**Solution**: Clear caches
```bash
npm run clean:cache
```

### Issue: Metro bundler errors
**Solution**: Reset Metro cache
```bash
npx expo r -c
```

## Environment Setup

1. Copy `.env.example` to `.env` (if exists)
2. Add your Supabase credentials:
   ```
   EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

## Ready to Code!

Once setup is complete, you can:
- Edit files in VS Code
- See changes live in browser/Expo Go
- Use hot reload for fast development

Happy coding! 🚀