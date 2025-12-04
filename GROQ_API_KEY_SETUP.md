# 🔑 Where to Update GROQ_API_KEY

After migrating from Claude Haiku to Groq Llama 3.1 8B, you need to set the `GROQ_API_KEY` in **3 places**:

## ✅ Required Locations

### 1. **Local `.env` File** (Root of project)
```env
GROQ_API_KEY=your-groq-api-key-here
```

**Location:** `C:\BoltNew Projects\8\project\.env`

**Why:** Used by local development and secret sync scripts.

---

### 2. **Supabase Dashboard → Project Settings → Edge Functions → Secrets**

**Steps:**
1. Go to your Supabase project dashboard
2. Navigate to: **Project Settings** → **Edge Functions** → **Secrets**
3. Add/Update secret: `GROQ_API_KEY` = `your-groq-api-key-here`

**Why:** Edge functions run in Supabase cloud and need access to the API key.

**Alternative (Automated):**
- Run `npm run sync:secrets` (syncs from `.env` to Supabase automatically)

---

### 3. **Verify Secret Sync Scripts** ✅ (Already Updated)

The following files have been updated to include `GROQ_API_KEY`:
- ✅ `sync-secrets.mjs` - Now includes `GROQ_API_KEY` in `REQUIRED_SECRETS`
- ✅ `check-secrets.mjs` - Now checks for `GROQ_API_KEY` and validates it for all Groq functions

---

## 🔍 How to Verify

### Option 1: Run Secret Check Script
```bash
npm run check:secrets
```

This will verify:
- ✅ `GROQ_API_KEY` exists in `.env` file
- ✅ `GROQ_API_KEY` exists in Supabase cloud secrets
- ✅ All edge functions have required secrets

### Option 2: Manual Check
1. **Local:** Check `.env` file has `GROQ_API_KEY=...`
2. **Supabase:** Go to Dashboard → Project Settings → Edge Functions → Secrets
3. **Verify:** See `GROQ_API_KEY` in the list

---

## 📋 Functions Using GROQ_API_KEY

The following edge functions now require `GROQ_API_KEY`:

1. ✅ `analyze-and-generate-questions` - Generates follow-up questions
2. ✅ `generate-summary` - Generates conversation summaries
3. ✅ `generate-contextual-options` - Generates chat response options
4. ✅ `generate-pregenerated-turns` - Pre-generates conversation turns
5. ✅ `orchestrate-conversation` - Orchestrates AI functions
6. ✅ `analyze-conversation-state` - Analyzes conversation state
7. ✅ `validate-option-relevance` - Validates option relevance
8. ✅ `voice-reflection` - Transcribes and analyzes voice
9. ✅ `generate-ai-insight` - Generates AI insights
10. ✅ `analyze-reflection` - Analyzes journal reflections
11. ✅ `generate-coach-nudge` - Generates coaching nudges

---

## 🚨 If You See Errors

### Error: "Groq API key not configured"
- **Fix:** Add `GROQ_API_KEY` to `.env` file and run `npm run sync:secrets`

### Error: "No content in response" (Question Generation)
- **Fix:** Already fixed! The code now uses `analyze-and-generate-questions` edge function correctly.

### Error: "Failed to generate summary"
- **Fix:** 
  1. Verify `GROQ_API_KEY` is set in Supabase secrets
  2. Check Groq API key is valid (get from https://console.groq.com/)
  3. Verify you have API credits/quota

---

## 📝 Quick Setup Checklist

- [ ] Get Groq API key from https://console.groq.com/
- [ ] Add `GROQ_API_KEY=your-key` to `.env` file
- [ ] Run `npm run sync:secrets` to sync to Supabase
- [ ] Verify with `npm run check:secrets`
- [ ] Test question generation in app
- [ ] Test summary generation in app

---

## ✅ Summary

**You've already done:**
- ✅ Added `GROQ_API_KEY` to Supabase secrets
- ✅ Added `GROQ_API_KEY` to `.env` file

**What was fixed:**
- ✅ Question generation now uses `analyze-and-generate-questions` edge function
- ✅ Summary generation has better error handling
- ✅ Secret sync scripts now include `GROQ_API_KEY`

**Next steps:**
1. Run `npm run sync:secrets` to ensure Supabase has the key
2. Test the app - questions and summaries should work now!

