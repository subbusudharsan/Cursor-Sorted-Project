# 🚀 Supabase Setup Guide - Step by Step

This guide will help you connect Supabase to your project. Follow each step carefully.

## Prerequisites
- A Supabase account (free tier is fine)
- Node.js installed (you already have this)
- Your project running (`npm install` completed)

---

## Step 1: Create a Supabase Account & Project

1. **Go to Supabase**: Visit [https://supabase.com](https://supabase.com)
2. **Sign Up/Login**: Create a free account or log in
3. **Create New Project**:
   - Click "New Project"
   - Enter a project name (e.g., "sorted-app")
   - Enter a database password (save this somewhere safe!)
   - Choose a region closest to you
   - Click "Create new project"
   - Wait 2-3 minutes for the project to be created

---

## Step 2: Get Your Supabase Credentials

Once your project is created:

1. **Go to Project Settings**:
   - Click the gear icon (⚙️) in the left sidebar
   - Click "API" under "Project Settings"

2. **Copy Your Credentials**:
   - **Project URL**: Copy the "Project URL" (looks like: `https://xxxxxxxxxxxxx.supabase.co`)
   - **Anon/Public Key**: Copy the "anon public" key (starts with `eyJhbG...`)

   ⚠️ **IMPORTANT**: Keep these safe! The anon key is public but should not be committed to public repos.

---

## Step 3: Create Environment Variables File

Create a `.env` file in your project root (same folder as `package.json`):

1. **Create the file**: In your project root, create a file named `.env`
2. **Add your credentials**:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   ```

3. **Replace the values**:
   - Replace `https://your-project-id.supabase.co` with your actual Project URL
   - Replace `your-anon-key-here` with your actual anon key

---

## Step 4: Update Expo Configuration

We need to add the environment variables to `expo.json` so Expo can access them:

1. Open `expo.json`
2. Add the environment variables to the `extra` section (they're already there, but we need to add our vars)

The file should look like this:
```json
{
  "expo": {
    ...
    "extra": {
      "router": {
        "origin": false
      },
      "EXPO_PUBLIC_SUPABASE_URL": "your-project-url-here",
      "EXPO_PUBLIC_SUPABASE_ANON_KEY": "your-anon-key-here"
    }
  }
}
```

**OR** you can reference environment variables:
```json
{
  "expo": {
    ...
    "extra": {
      "router": {
        "origin": false
      },
      "EXPO_PUBLIC_SUPABASE_URL": process.env.EXPO_PUBLIC_SUPABASE_URL,
      "EXPO_PUBLIC_SUPABASE_ANON_KEY": process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    }
  }
}
```

---

## Step 5: Install Required Packages (if not already installed)

Your project already has most packages, but verify:

```bash
npm install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill
```

---

## Step 6: Test the Connection

1. **Restart your development server**:
   ```bash
   # Stop the current server (Ctrl+C)
   # Then start again
   npm start
   ```

2. **Check the console**: When your app starts, you should see:
   ```
   🧭 Supabase initialized using storage key: sorted_supabase_auth_...
   ```

3. **If you see an error**: Check that:
   - Your `.env` file has the correct values
   - Your `expo.json` has the variables in the `extra` section
   - You've restarted the dev server

---

## Step 7: Set Up Supabase Database Tables

Your project uses several database tables. You need to create them:

1. **Go to SQL Editor** in Supabase:
   - Click "SQL Editor" in the left sidebar
   - Click "New Query"

2. **Run the migration**:
   - Check if you have a migration file in `supabase/migrations/`
   - Copy the SQL from that file
   - Paste it into the SQL Editor
   - Click "Run" to execute

---

## Step 8: Deploy Edge Functions (Optional but Recommended)

Your project has Supabase Edge Functions. To deploy them:

1. **Install Supabase CLI** (if not installed):
   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase**:
   ```bash
   supabase login
   ```

3. **Link your project**:
   ```bash
   supabase link --project-ref your-project-ref
   ```
   (You can find your project ref in the project settings)

4. **Deploy functions**:
   ```bash
   supabase functions deploy
   ```

---

## Troubleshooting

### ❌ Error: "Missing Supabase credentials"
- **Solution**: Make sure your `.env` file exists and has the correct variable names
- Check that `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set

### ❌ Error: "Invalid API key"
- **Solution**: Double-check that you copied the correct anon key (not the service_role key)
- Make sure there are no extra spaces or quotes in your `.env` file

### ❌ Environment variables not loading
- **Solution**: 
  - Restart your Expo dev server completely
  - Clear the cache: `npm start -- --clear`
  - Make sure variable names start with `EXPO_PUBLIC_`

### ❌ Database connection issues
- **Solution**: 
  - Verify your Project URL is correct
  - Check that your Supabase project is active (not paused)
  - Make sure you've created the necessary database tables

---

## Next Steps

Once connected:
1. ✅ Test authentication (sign up/sign in)
2. ✅ Create database tables from migrations
3. ✅ Deploy Edge Functions
4. ✅ Test real-time features

---

## Need Help?

- Supabase Docs: https://supabase.com/docs
- Expo Environment Variables: https://docs.expo.dev/guides/environment-variables/









