# Quick Fix Reference Card

## ✅ All Issues Fixed

### 1. Napi-wasm Error
```bash
# Already installed:
napi-wasm@1.1.3
```

### 2. Web Browser (press 'w')
```json
// expo.json - web output changed to:
"output": "static"
```

### 3. Options Generation Rules
**DO**: Options are users talking to each other
- "Hey... how are you?" ✅
- "I guess I was hurt that you didn't seem happy for me." ✅

**DON'T**: AI talking to users
- "I'm here to help you work through this" ❌
- "Let me understand your situation better" ❌

### 4. Hint System
**User B sees**:
- Banner: "Alex wants to talk about **missed deadline** last week"
- Tip box: Optional input for their perspective
- After submit: Options become more authentic

**In options generation function**:
- `hintToContact`: What User A discussed (shown to User B)
- `hintFromB`: User B's perspective (private, informs AI)
- Both passed to `generate-contextual-options` edge function

---

## Testing Checklist

- [ ] Web opens with 'w' key
- [ ] App downloads on phone via QR code
- [ ] Options sound natural (users talking)
- [ ] NO AI instructions in options
- [ ] Hint banner shows for User B
- [ ] Tip box accepts User B input
- [ ] Options improve after hint
- [ ] Conversation reaches closure 😊

---

## Key Files

- **OPTIONS_GENERATION_GUIDE.md** - Full documentation with examples
- **FIXES_SUMMARY.md** - Detailed explanation of all fixes
- **app/contact-chat.tsx** - Hint display logic (lines 915-1147)
- **app/ai-chat.tsx** - Initial options generation (lines 419-467)

---

## Edge Function Must:
1. Generate user-to-user conversation ONLY
2. Use hints without revealing them directly
3. Progress through stages: opening → discussion → resolution
4. Match dialogue example from image (15 turns to closure)
5. Return 3-5 natural, authentic options

---

**Remember**: Users are talking to each other, NOT to AI!
