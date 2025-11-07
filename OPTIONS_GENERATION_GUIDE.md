# Options Generation Guide

## Overview
This app generates AI-assisted response options to help users (User A and User B) have meaningful conversations that resolve conflicts or concerns.

## Critical Requirements

### 1. User-to-User Conversation ONLY
- ❌ AI must NEVER talk directly to users in the generated options
- ✅ Options are what User A or User B would say to EACH OTHER
- ✅ Options help users express themselves authentically to their conversation partner

### 2. Example Dialogue Structure (From Image)

The ideal conversation flow based on the provided dialogue example:

**Turn 1 - Speaker A (Gentle Opening)**
- Message: "Hey... how are you?"
- Emotion Intent: gentle opening
- Options should be warm, non-confrontational conversation starters

**Turn 2 - Speaker B (Guarded Curiosity)**
- Message: "Hey, I'm okay... bit surprised to get your message."
- Emotion Intent: guarded curiosity
- Options acknowledge surprise while remaining open

**Turn 3 - Speaker A (Initiates Calmly)**
- Message: "Yeah, I was thinking about what happened the other day."
- Emotion Intent: initiates calmly
- Options introduce the issue without blame

**Turn 4 - Speaker B (Hesitant Acknowledgment)**
- Message: "You mean my comment?"
- Emotion Intent: hesitant acknowledgment
- Options show awareness while being cautious

**Turn 5 - Speaker A (Seeks Understanding)**
- Message: "Yes. I wanted to understand what made you feel that way."
- Emotion Intent: seeks understanding
- Options express genuine curiosity about the other's perspective

**Turn 6 - Speaker B with HINT**
- The hint is revealed: "I felt ignored when you didn't reply about my project"
- Message: *(submits hint: "I felt ignored when you didn't reply about my project")*
- Emotion Intent: reveals root hurt privately
- Options now become more honest and vulnerable

**Turn 7 - Speaker B (Gentle Honesty)**
- Message: "I guess I was hurt that you didn't seem happy for me."
- Emotion Intent: gentle honesty
- Options express hurt without attacking

**Turns 8-15 - Progressive Resolution**
- Recognition → Reassurance → Context sharing → Ownership → Forgiveness → Gratitude
- Options guide users through acknowledging, explaining, taking responsibility, and closing positively
- Final turns end with mutual smiley emoticons (😊) showing resolution

## 3. Hint System

### When User B Enters the Chat
- User B sees a hint banner: "Alex wants to talk about **missed deadline** last week"
- User B can optionally provide their perspective via a tip box
- Example: "I felt ignored when you didn't reply about my project"

### How Hint Should Be Used
- The hint is NOT shown directly to users in options
- The hint informs the AI about the underlying issue
- Options become more authentic and targeted after hint is submitted
- The hint helps User B express what really bothered them

### Critical: Hint Integration in Options
```typescript
// In generate-contextual-options edge function
{
  hintFromB: "I felt ignored when you didn't reply about my project", // User B's perspective
  hintToContact: {
    issue: "missed deadline",
    timeline: "last week",
    full_text: "Alex wants to talk about missed deadline last week"
  }, // What User A discussed with AI
  originalIssue: {
    summary: "User A's original concern from AI chat",
    thoughts: "AI's perspective on User A's issue"
  }
}
```

## 4. Option Generation Rules

### DO Generate Options That:
✅ Sound natural and conversational
✅ Match the current emotional stage (opening, clarifying, resolving)
✅ Help users express vulnerability appropriately
✅ Guide toward understanding and resolution
✅ Use "I" statements and personal feelings
✅ Show empathy for the other person
✅ Take appropriate accountability when needed

### DO NOT Generate Options That:
❌ Have AI speaking to the user ("I'm here to help you...")
❌ Are robotic or overly formal
❌ Assign blame or attack character
❌ Reveal the hint explicitly
❌ Sound like therapy-speak
❌ Are generic or could apply to any situation

## 5. Conversation Phases

### Phase 1: Opening (Turns 1-3)
- Warm, gentle tone
- Acknowledge the outreach
- Introduce topic carefully
- **Example Options for A**:
  - "Hey... how are you?"
  - "Can we talk about something?"
  - "I've been thinking about us."

### Phase 2: Clarifying (Turns 4-7)
- Ask questions
- Seek understanding
- Share initial feelings
- Use hint to generate more authentic options
- **Example Options for B** (with hint):
  - "I guess I was hurt that you didn't seem happy for me."
  - "It felt like my project didn't matter to you."
  - "I was excited to share it and then... nothing."

### Phase 3: Discussion (Turns 8-12)
- Explain perspectives
- Take responsibility
- Show empathy
- **Example Options**:
  - "Oh... I didn't realize it came across that way."
  - "I was actually proud of you — maybe I didn't show it well."
  - "I was just dealing with some stuff that day, not about you."

### Phase 4: Resolution (Turns 13-16)
- Acknowledge growth
- Express gratitude
- Affirm relationship
- Use closure emojis (😊)
- **Example Options**:
  - "It's okay, I'm glad you told me how you felt."
  - "Thanks for listening. I value our friendship."
  - "😊"

## 6. Edge Function Parameters

The `generate-contextual-options` function receives:

```typescript
{
  chatId: string,              // Current contact chat ID
  recipientId: string,         // Who needs options (User A or User B)
  currentUserId: string,       // Who is generating (same as recipientId)
  currentMessage: string,      // Latest message from the other person
  summary: string,             // Recipient's context summary
  thoughts: string,            // Recipient's thoughts
  originalIssue: {             // User A's original concern
    summary: string,
    thoughts: string
  },
  hintFromB: string,           // User B's hint (if provided)
  hintToContact: object,       // Hint shown to User B
  summaryB: string,            // User B's perspective
  thoughtsB: string,           // User B's thoughts
  conversationHistory: array,  // Last 8 messages
  isInitial: boolean,          // First options generation?
  contactCategory: string,     // Relationship type
  conversationPhase: string,   // opening/discussion/resolution
  resolutionDetected: boolean  // Conversation closing?
}
```

## 7. Expected Output Format

The edge function should return 3-5 contextual options:

```typescript
{
  options: [
    "Hey... how are you?",
    "Can we talk about something?",
    "I've been thinking about what happened."
  ],
  confidence: "high" | "medium" | "low",
  phase: "opening" | "discussion" | "resolution"
}
```

## 8. Testing Checklist

✅ Options sound like natural human speech
✅ No AI talking to users ("I'm here to help...")
✅ Options appropriate for conversation stage
✅ Hint influences options without being explicit
✅ Progressive emotional depth through conversation
✅ Clear path toward resolution
✅ Smiley closure when appropriate (😊)
✅ Options match relationship category (Family/Friend/Work/etc.)

## 9. Common Issues to Avoid

### Issue: AI Talking to User
❌ "I'm here to help you work through this"
❌ "Let me understand your situation better"
✅ "I've been thinking about what happened"
✅ "Can we talk about the other day?"

### Issue: Too Generic
❌ "I understand your concern"
❌ "Let's discuss this matter"
✅ "I guess I was hurt that you didn't seem happy for me"
✅ "I didn't realize it came across that way"

### Issue: Revealing Hint Too Directly
❌ "You said you felt ignored about your project"
❌ "The hint says you're upset about X"
✅ (Use hint to inform tone and content, don't mention it)
✅ Options become more authentic and specific

## 10. Success Metrics

A successful conversation flow:
1. Starts with gentle opening (both users feel comfortable)
2. Issue is introduced carefully (no blame, just facts)
3. Understanding is sought (questions, curiosity)
4. Hint helps User B express root feelings
5. Both perspectives shared (vulnerability, not defensiveness)
6. Accountability taken where appropriate
7. Resolution reached naturally
8. Relationship affirmed
9. Smiley closure (😊) from both parties

---

**Remember**: The goal is to help real people have real conversations. Options should sound human, feel authentic, and guide toward understanding and resolution.
