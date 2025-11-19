/*
  # Generate Summary Function

  1. Purpose
    - Takes initial description and Q&A responses
    - Generates a structured summary using Claude AI
    - Creates context data for conversation use
    - Builds pronoun maps for proper referencing

  2. Security
    - Uses environment variables for API keys
    - Validates request format
    - Handles CORS properly

  3. Response Format
    - Returns formatted summary with key points
    - Includes context_data ready for chats table
    - Contains pronoun mappings for conversation flow
*/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }

  try {
    console.log('📝 generate-summary function called');

    const CLAUDE_API_KEY = Deno.env.get('CLAUDE_API_KEY');

    if (!CLAUDE_API_KEY || !CLAUDE_API_KEY.startsWith('sk-ant-')) {
      return new Response(JSON.stringify({
        error: 'Claude API key not configured'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const requestBody = await req.json();
    const { initial_description, question_responses, tagged_persons, additional_context, structured_context } = requestBody;

    console.log('📥 Request received:', {
      hasDescription: !!initial_description,
      responseCount: question_responses?.length || 0,
      taggedCount: tagged_persons?.length || 0
    });

    if (!initial_description) {
      return new Response(JSON.stringify({
        error: 'Initial description is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const qaText = question_responses && question_responses.length > 0
      ? question_responses.map((qa: any) => `Q: ${qa.question}\nA: ${qa.answer}`).join('\n\n')
      : 'No additional responses provided.';

    const additionalContextText = additional_context ? `\n\nAdditional Information:\n${additional_context}` : '';
    const structuredContextText = structured_context ? `\n\nStructured Context:\n${structured_context}` : '';

    const personsText = tagged_persons && tagged_persons.length > 0
      ? `\n\nPeople involved:\n${tagged_persons.map((p: any) =>
          `- ${p.name}${p.is_user_b ? ' (person I need to talk to)' : ''}${p.relationship ? ` (${p.relationship})` : ''}${p.preferred_pronouns ? ` [pronouns: ${p.preferred_pronouns}]` : ''}`
        ).join('\n')}`
      : '';

    // Build full context text including additional and structured context
    const fullContextText = `${initial_description}\n\n${qaText}${additionalContextText}${structuredContextText}${personsText}`;

    const systemPrompt = `You are an empathetic AI assistant helping someone prepare for a difficult conversation.

Your task is to:
1. SYNTHESIZE ALL INFORMATION from initial description AND every Q&A response
2. Create TWO DIFFERENT summaries:
   a) A-PERSPECTIVE SUMMARY: Emotional, first-person from User A's perspective (for User A only in Stage 3)
   b) NEUTRAL SHARED SUMMARY: Factual, third-person neutral (for both User A and User B during chat)
3. Extract 3-5 key points capturing the COMPLETE situation
4. Identify relationship context and proper pronouns
5. Build pronoun map for conversation flow

CRITICAL: The summaries MUST incorporate ALL Q&A responses, not just the initial description.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INPUT VALIDATION RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reject and ignore (do NOT treat as meaningful):
- random character strings ("asdfgh", "nnnnn", "xxxxx")
- pure gibberish
- empty strings
- single-letter inputs ("a", "b", "k")
- punctuation-only or emoji-only responses ("!!!", "...", "??", "😂")

Accept and interpret meaningfully:
- short answers (1–3 meaningful words)
- minimal but meaningful replies ("sad", "confused", "hurt")
- broken or incomplete sentences
- spelling mistakes
- punctuation errors (run-ons, missing punctuation, extra punctuation)
- fragmented thoughts

If answers are low-detail but meaningful:
- infer emotional meaning softly
- reconstruct a high-level interpretation
- DO NOT skip summary generation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUMMARY LENGTH RULE (IMPORTANT):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The model must NOT make the summaries significantly longer or shorter than the natural meaning of the user's input.

Do NOT add new ideas.
Do NOT compress away meaning.
Simply GROUP what the user said in Stage 1 and Stage 2 together using their EXACT words - no rephrasing.

Focus on clarity, NOT expansion or shortening.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL: USE USER'S EXACT WORDS - GROUP ONLY, NO REPHRASING:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MANDATORY RULES:
1. EXACT WORD USAGE (CRITICAL - NO REPHRASING):
   - Use ONLY the user's EXACT words, phrases, and sentences
   - Do NOT rephrase, rewrite, or change any words
   - Do NOT add new vocabulary, synonyms, or different words
   - Do NOT use different words to express the same concept - use user's EXACT words
   - Preserve the user's original wording, phrasing, and emotional tone EXACTLY as written
   - Only add minimal connecting words (like "and", "when", "because") to group sentences together
   - Keep the user's original sentence structure and word choice

2. GROUPING ONLY (NO REPHRASING):
   - Simply GROUP the user's information from Stage 1 and Stage 2 together
   - Connect the user's exact words with minimal connecting words (only "and", "when", "because", etc.)
   - Do NOT change sentence structure
   - Do NOT change word order within sentences
   - Do NOT replace words with synonyms
   - Just combine what the user said in Stage 1 and Stage 2 into a grouped summary

3. CHRONOLOGICAL ORGANIZATION (CRITICAL):
   - Organize information in a logical REAL-WORLD TIMELINE (event chronology)
   - Do NOT follow the order things were typed - follow when events actually happened
   - If Stage 2 Q&A reveals events that happened BEFORE Stage 1, reorder them correctly
   - Group related events together chronologically, not by when they were mentioned
   - Example: If user mentions "yesterday's argument" in Stage 1, then in Stage 2 mentions "the issue started last week", organize as: last week's issue → yesterday's argument
   - BUT: Use the user's EXACT words when grouping - don't rephrase

4. PRESERVATION:
   - The meaning and emotional accuracy must remain EXACTLY as the user expressed
   - Do NOT interpret, expand, or add context beyond what the user shared
   - Do NOT add descriptive words the user didn't use
   - Simply GROUP the user's exact words into a chronological flow

What to do:
- Extract the user's EXACT words and phrases from Stage 1 and Stage 2
- GROUP them together with minimal connecting words (only "and", "when", "because", etc.)
- Organize events in real-world chronological order (when they happened, not when typed)
- Connect the user's exact words with minimal connecting words (only when necessary for grouping)
- Preserve the user's original wording, sentence structure, and emotional tone EXACTLY

What NOT to do:
- Do NOT rephrase or rewrite any words
- Do NOT change sentence structure
- Do NOT add new vocabulary or synonyms
- Do NOT add new ideas or concepts
- Do NOT follow typing order - follow event chronology
- Do NOT add explanations or interpretations beyond grouping chronologically
- Do NOT change the emotional meaning or intensity
- Do NOT "improve" grammar or "clean up" sentences - use EXACT words

Example of CORRECT approach (using exact words, just grouping):
User Stage 1: "I felt hurt when @you didn't respond yesterday."
User Stage 2 Q&A: "What happened before that?" → "Last week @you canceled our plans."
Correct summary: "Last week @you canceled our plans. I felt hurt when @you didn't respond yesterday."
(Using EXACT words, just grouped chronologically)

Example of INCORRECT approach (rephrasing):
User input: "I felt hurt when @you didn't respond."
Incorrect summary: "I experienced emotional distress when @you failed to acknowledge my communication." ❌
(Changed "felt hurt" to "experienced emotional distress", changed "didn't respond" to "failed to acknowledge" - this is WRONG)

Example of CORRECT approach (exact words, just grouped):
User Stage 1: "I was upset about the party."
User Stage 2: "I wasn't invited and felt left out."
Correct summary: "I was upset about the party. I wasn't invited and felt left out."
(Using EXACT words, just grouped together)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1) A-PERSPECTIVE SUMMARY (User A talking to AI - ONLY for User A in Stage 3):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• This is ONLY for User A.
• This summary MUST preserve @ (you/your for User B) and # (third parties like #Mom, #Rachana).
• This summary is EMOTIONAL and from A's point of view only.
• Do NOT neutralize emotions here.
• Do NOT rewrite anything into User B's feelings.
• This is what A sees in Stage 3.

Format:
- Fully emotional
- Includes @ to refer to User B ("you/your")
- Includes # tags for other people ("#Mom", "#Rachana")
- First-person voice: "I felt…", "I thought…", "I was hurt…"
- Preserve ALL entity tags (@ and #) exactly as they appear
- Use ONLY the user's EXACT words and phrases (NO rephrasing - just group them together)
- Organize events in REAL-WORLD CHRONOLOGICAL ORDER (when events happened, not typing order)
- Preserve meaning, wording, and emotional accuracy EXACTLY as the user expressed

Example (using user's EXACT words, just grouped):
User Stage 1: "I felt ignored at the family dinner when @you barely spoke to me."
User Stage 2: "It seemed intentional and made me feel unwanted, especially when #Mom and others were talking normally."
Summary: "I felt ignored at the family dinner when @you barely spoke to me. It seemed intentional and made me feel unwanted, especially when #Mom and others were talking normally."
(Using EXACT words from user, just grouped together)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2) NEUTRAL SHARED SUMMARY (FACT for BOTH A & B during chat):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• This is NOT emotional.
• This is NOT from A's voice.
• This is NOT from B's voice.
• This is a factual topic summary used for BOTH sides during the chat.
• This summary must also preserve entity tags:
   @ = directly involved person (User B)
   # = third-party people/groups
• DO NOT mix perspectives.
• DO NOT guess User B's feelings.

Format:
- Third-person neutral
- "The discussion is about…"
- "User A felt…"
- "User B said (if applicable)…"
- No assumptions about B's emotions
- No "I" or "you" perspective
- Preserve ALL entity tags (@ and #) exactly as they appear
- Use ONLY the user's EXACT words and phrases (NO rephrasing - just convert "I" to "User A" and "@you" to "User B (@you)", keep all other words EXACT)
- Organize events in REAL-WORLD CHRONOLOGICAL ORDER (when events happened, not typing order)
- Preserve meaning, wording, and emotional accuracy EXACTLY as the user expressed

Example (using user's EXACT words, just converted to third-person):
User Stage 1: "I felt ignored at the family dinner when @you barely spoke to me."
User Stage 2: "It seemed intentional and made me feel unwanted, especially when #Mom and others were talking normally."
Summary: "The discussion is about the family dinner where User B (@you) barely spoke to User A. It seemed intentional and made User A feel unwanted, especially when #Mom and others were talking normally."
(Using user's EXACT words - only converting "I" to "User A" and "@you" to "User B (@you)", keeping all other words EXACT)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3) 💡 My Thoughts (User A internal reflection - ONLY for User A in Stage 3):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• This is ONLY for User A.
• This is User A's internal reflection, talking to the AI assistant.
• This should feel like User A is quietly reflecting to themselves.

🎯 CRITICAL PURPOSE OF THOUGHTS:
- Thoughts MUST focus on HOW TO TAKE THIS CONVERSATION FORWARD with the person to RESOLVE THE ISSUE
- Thoughts should be about NEXT STEPS, APPROACH, STRATEGY for the conversation
- Thoughts should reflect User A's INTENTION and PLAN for moving forward
- DO NOT repeat the same content from the summary (what happened, how they feel about past events)
- Instead, focus on: how to approach the conversation, what to say, how to communicate, what outcome they want

Format:
- First-person voice: "I think…", "I feel…", "I want to…", "I should…", "I'll try to…"
- Focus on forward-looking actions and conversation strategy
- Warm, natural, everyday English (not formal, not Gen-Z slang)
- Keep it simple, human, caring, and easy to read

What Thoughts SHOULD Include:
✅ "I want to approach [@contact name] calmly and explain my side"
✅ "I think I should listen to [@contact name]'s perspective first"
✅ "I'll try to keep the conversation focused on finding a solution"
✅ "I want to make sure [@contact name] understands how I felt"
✅ "I should be open to hearing [@contact name]'s side of things"
✅ "I want to work together to resolve this"

What Thoughts SHOULD NOT Include (avoid repeating summary):
❌ "I felt hurt when [@contact name] did X" (this belongs in summary, not thoughts)
❌ "Last week [@contact name] canceled our plans" (this is summary content)
❌ "I was upset about the party" (this is summary content)
❌ Repeating events or feelings already described in the summary

🎯 CRITICAL PRONOUN RULES FOR THOUGHTS:
- When referring to User B (the @contact): Use their **NAME** OR their **PRONOUNS** (from preferred_pronouns field)
  ✅ CORRECT: "I want to talk to [Name] calmly" (using their actual name from tagged_persons)
  ✅ CORRECT: "I think I should hear her side" (if preferred_pronouns = "she/her")
  ✅ CORRECT: "I feel bad for how things went with him" (if preferred_pronouns = "he/him")
  ✅ CORRECT: "I want to approach them calmly" (if preferred_pronouns = "they/them")
  ❌ WRONG: "I want to talk to you calmly" (if "you" refers to @contact - "you" means AI assistant)
  ❌ WRONG: "I think you might be upset" (if "you" refers to @contact)
  ❌ WRONG: "I want to approach them calmly" (if "them" is NOT their actual pronoun - use name instead)

- When referring to third parties (#tagged people): Use their **NAME** (from #tag) OR their **PRONOUNS**
  ✅ CORRECT: "I think #Mom was right" (using #tag)
  ✅ CORRECT: "I'm worried about what she said" (if #Mom's pronouns = "she/her")
  ✅ CORRECT: "I want to approach [@contact name] calmly, but I'm concerned about #John's reaction"

- If preferred_pronouns is not provided: Use the person's name (from tagged_persons or #tag)

IMPORTANT:
- NEVER use "you" or "your" when referring to the @contact in thoughts
- NEVER hardcode names - use the actual names from tagged_persons
- If pronouns are unclear, use the person's name instead
- "you" in thoughts refers to the AI assistant, not the @contact

Examples:
✅ CORRECT (forward-looking thoughts about conversation strategy):
- "I want to approach [@contact name] calmly and explain my side so we can work through this together."
- "I think I should hear her side first before sharing my perspective." (if @contact's pronouns = "she/her")
- "I'll try to keep the conversation focused on finding a solution that works for both of us."
- "I want to make sure [@contact name] understands how I felt, but I'm also open to hearing their perspective."

✅ CORRECT (referring to #third party in forward-looking context):
- "I'm concerned about how #Mom might react, but I still want to have this conversation with [@contact name]."

❌ WRONG (repeating summary content - avoid these):
- "I felt hurt when [@contact name] did X" ❌ (this is summary content)
- "Last week [@contact name] canceled our plans" ❌ (this is summary content)
- "I was upset about the party" ❌ (this is summary content)

❌ WRONG (using "you" for @contact):
- "I want to talk to you calmly" (if "you" = @contact) ❌
- "I think you might be upset" (if "you" = @contact) ❌

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY valid JSON with this structure:
{
  "summary": "3-4 sentence A-PERSPECTIVE SUMMARY (emotional, first-person, preserves @ and #)",
  "summary_a_perspective": "Same as summary above - emotional, first-person from User A's perspective",
  "summary_shared_neutral": "3-4 sentence NEUTRAL SHARED SUMMARY (factual, third-person, preserves @ and #)",
  "key_points": [
    "Initial Issue: [what happened]",
    "Emotional Impact: [how they feel with specifics]",
    "Context: [relevant details from Q&A]",
    "Desired Outcome: [what they want]"
  ],
  "context_data": {
    "summary": "same as summary_a_perspective above",
    "summary_a": "same as summary_a_perspective above (backward compatibility)",
    "summary_a_perspective": "same as summary_a_perspective above",
    "summary_shared_neutral": "NEUTRAL SHARED SUMMARY (factual, third-person)",
    "key_points": ["same as above"],
    "thoughts": "💡 My Thoughts section (User A's internal reflection focusing on HOW TO TAKE THE CONVERSATION FORWARD to resolve the issue - NOT repeating summary content - use @contact's NAME or PRONOUNS, never 'you' or generic 'them')",
    "thoughts_a": "Same as thoughts above",
    "all_qa_pairs": "Include the full question_responses array for reference",
    "pronoun_map": {
      "user_b": "you/your" (if talking TO someone directly),
      "third_party": {
        "PersonName": "he/him" or "she/her" or "they/them"
      }
    },
    "relationship_context": {
      "user_b_role": "direct" (if user_b exists) or "indirect",
      "category": "Friend" | "Family" | "Work" | "Teacher" | "Service" | "General"
    }
  }
}

CRITICAL REQUIREMENTS:
- The model MUST ALWAYS return BOTH fields: summary_a_perspective AND summary_shared_neutral
- NEVER return null for either summary
- NEVER output "insufficient information" or skip summary generation
- If needed, generate a short, safe, high-level version based strictly on what the user provided
- Both summaries must be meaningful and complete, even if the input is minimal

Guidelines:
- MUST include information from ALL Q&A responses in BOTH summaries
- A-PERSPECTIVE SUMMARY: Emotional, first-person, preserves @ and # tags, uses ONLY user's EXACT words (NO rephrasing - just group them), organized chronologically
- NEUTRAL SHARED SUMMARY: Factual, third-person, preserves @ and # tags, NO assumptions about User B's feelings, uses ONLY user's EXACT words (NO rephrasing - just group them), organized chronologically
- Use empathetic, non-judgmental language (but only words the user shared)
- Identify user_b (person they're talking TO) vs third parties
- Choose appropriate pronouns based on names and context
- NEVER invent new person names. Only reference names that appear in the initial description, Q&A responses, or the tagged_persons list. If no name is provided, describe the person generically (e.g., "a coworker").
- Preserve ALL important emotional context in A-PERSPECTIVE SUMMARY only
- Keep NEUTRAL SHARED SUMMARY purely factual and neutral
- ALWAYS generate BOTH summaries - never skip or return null
- Apply input validation rules to filter out meaningless inputs while accepting all meaningful content
- Maintain natural summary length based on user input - do not expand or compress unnecessarily
- CRITICAL: Organize user's information in REAL-WORLD CHRONOLOGICAL ORDER (event timeline, not typing order) - if Stage 2 reveals earlier events, place them before Stage 1 events
- CRITICAL: Use ONLY user's EXACT words and phrases - NO rephrasing, just group them together. Do NOT add new vocabulary, synonyms, or new ideas
- CRITICAL: Preserve meaning and emotional accuracy exactly as the user expressed`;

    const claudePayload = {
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Create a summary from this information:

${fullContextText}

Respond with ONLY the JSON structure specified in the system prompt.`
        }
      ]
    };

    console.log('🚀 Calling Claude API...');

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(claudePayload)
    });

    console.log('📡 Claude API response status:', claudeResponse.status);

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('Claude API error:', errorText);
      return new Response(JSON.stringify({
        error: 'Failed to generate summary'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content?.[0]?.text || '';

    console.log('📄 Claude response received');

    let parsedResponse;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError);

      const fallbackSummary = initial_description.substring(0, 200);
      const userB = tagged_persons?.find((p: any) => p.is_user_b);

      // Create fallback summaries
      const fallbackAPerspective = `I experienced: ${fallbackSummary}`;
      const fallbackNeutral = `The discussion is about: ${fallbackSummary.substring(0, 150)}`;

      return new Response(JSON.stringify({
        summary: fallbackAPerspective,
        summary_a_perspective: fallbackAPerspective,
        summary_shared_neutral: fallbackNeutral,
        key_points: ['Situation described', 'Needs resolution'],
        context_data: {
          summary: fallbackAPerspective,
          summary_a: fallbackAPerspective,  // backward compatibility
          summary_a_perspective: fallbackAPerspective,
          summary_shared_neutral: fallbackNeutral,
          key_points: ['Situation described', 'Needs resolution'],
          pronoun_map: userB ? { user_b: 'you/your', third_party: {} } : { third_party: {} },
          relationship_context: {
            user_b_role: userB ? 'direct' : 'indirect',
            category: userB?.relationship || 'General'
          }
        }
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    if (!parsedResponse.summary || !parsedResponse.context_data) {
      console.error('Invalid response format - creating fallback summaries');

      const fallbackSummary = initial_description.substring(0, 200);
      const userB = tagged_persons?.find((p: any) => p.is_user_b);

      // Create fallback summaries
      const fallbackAPerspective = `I experienced: ${fallbackSummary}`;
      const fallbackNeutral = `The discussion is about: ${fallbackSummary.substring(0, 150)}`;

      return new Response(JSON.stringify({
        summary: fallbackAPerspective,
        summary_a_perspective: fallbackAPerspective,
        summary_shared_neutral: fallbackNeutral,
        key_points: ['Situation described', 'Needs resolution'],
        context_data: {
          summary: fallbackAPerspective,
          summary_a: fallbackAPerspective,  // backward compatibility
          summary_a_perspective: fallbackAPerspective,
          summary_shared_neutral: fallbackNeutral,
          key_points: ['Situation described', 'Needs resolution'],
          pronoun_map: userB ? { user_b: 'you/your', third_party: {} } : { third_party: {} },
          relationship_context: {
            user_b_role: userB ? 'direct' : 'indirect',
            category: userB?.relationship || 'General'
          }
        }
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // ✅ ENSURE BOTH SUMMARIES EXIST IN PARSED RESPONSE
    if (!parsedResponse.summary_a_perspective && parsedResponse.summary) {
      // Fallback: use summary as A-perspective if separate field missing
      parsedResponse.summary_a_perspective = parsedResponse.summary;
      if (parsedResponse.context_data) {
        parsedResponse.context_data.summary_a_perspective = parsedResponse.summary;
        parsedResponse.context_data.summary_a = parsedResponse.summary; // backward compatibility
      }
    }

    if (!parsedResponse.summary_shared_neutral) {
      console.warn('⚠️ Warning: Claude did not generate summary_shared_neutral. Creating fallback.');
      // Create fallback neutral summary from A-perspective by converting to third-person
      const aPerspectiveText = parsedResponse.summary_a_perspective || parsedResponse.summary || '';
      const fallbackNeutral = aPerspectiveText
        ? aPerspectiveText
            .replace(/^I\s+/gi, 'User A ')
            .replace(/\bmy\b/gi, 'their')
            .replace(/\bme\b/gi, 'them')
            .replace(/\bmyself\b/gi, 'themself')
            .replace(/\bI\b/gi, 'User A')
            .replace(/\bI'm\b/gi, 'User A is')
            .replace(/\bI've\b/gi, 'User A has')
            .replace(/\bI'd\b/gi, 'User A would')
        : `The discussion is about: ${initial_description.substring(0, 150)}`;
      
      parsedResponse.summary_shared_neutral = fallbackNeutral;
      
      // Update context_data too
      if (parsedResponse.context_data) {
        parsedResponse.context_data.summary_shared_neutral = fallbackNeutral;
      } else {
        parsedResponse.context_data = {
          summary_shared_neutral: fallbackNeutral,
        };
      }
    }

    // ✅ ENSURE context_data EXISTS and HAS BOTH SUMMARIES
    if (!parsedResponse.context_data) {
      parsedResponse.context_data = {};
    }
    
    // ✅ CRITICAL: Ensure summary_a_perspective is ALWAYS in context_data
    if (!parsedResponse.context_data.summary_a_perspective) {
      // Use summary_a_perspective from root, or summary as fallback
      parsedResponse.context_data.summary_a_perspective = parsedResponse.summary_a_perspective || parsedResponse.summary || '';
    }
    
    // ✅ Backward compatibility fields (ALWAYS set from summary_a_perspective)
    if (parsedResponse.context_data.summary_a_perspective) {
      parsedResponse.context_data.summary_a = parsedResponse.context_data.summary_a_perspective; // backward compatibility
      parsedResponse.context_data.summary = parsedResponse.context_data.summary_a_perspective; // backward compatibility
    }
    
    // ✅ CRITICAL: Ensure summary_shared_neutral is set (use the fallback if it was created above)
    if (!parsedResponse.context_data.summary_shared_neutral) {
      parsedResponse.context_data.summary_shared_neutral = parsedResponse.summary_shared_neutral || '';
      // If still empty, create fallback (should have been created above, but double-check)
      if (!parsedResponse.context_data.summary_shared_neutral && parsedResponse.context_data.summary_a_perspective) {
        const fallbackNeutral = parsedResponse.context_data.summary_a_perspective
          .replace(/^I\s+/gi, 'User A ')
          .replace(/\bmy\b/gi, 'their')
          .replace(/\bme\b/gi, 'them')
          .replace(/\bmyself\b/gi, 'themself')
          .replace(/\bI\b/gi, 'User A')
          .replace(/\bI'm\b/gi, 'User A is')
          .replace(/\bI've\b/gi, 'User A has')
          .replace(/\bI'd\b/gi, 'User A would');
        parsedResponse.context_data.summary_shared_neutral = fallbackNeutral;
        parsedResponse.summary_shared_neutral = fallbackNeutral;
      }
    }

    // ✅ LOG BOTH SUMMARIES FOR DEBUGGING (confirm they exist and are different)
    console.log('✅ Summary generation complete:', {
      hasSummaryAPerspective: !!parsedResponse.summary_a_perspective,
      hasSummarySharedNeutral: !!parsedResponse.summary_shared_neutral,
      contextDataHasAPerspective: !!parsedResponse.context_data?.summary_a_perspective,
      contextDataHasSharedNeutral: !!parsedResponse.context_data?.summary_shared_neutral,
      summaryAPerspectiveLength: parsedResponse.summary_a_perspective?.length || 0,
      summarySharedNeutralLength: parsedResponse.summary_shared_neutral?.length || 0,
      summaryAPerspectivePreview: parsedResponse.summary_a_perspective?.substring(0, 100) || 'MISSING',
      summarySharedNeutralPreview: parsedResponse.summary_shared_neutral?.substring(0, 100) || 'MISSING',
      areSummariesDifferent: parsedResponse.summary_a_perspective !== parsedResponse.summary_shared_neutral,
      contextDataAreDifferent: parsedResponse.context_data?.summary_a_perspective !== parsedResponse.context_data?.summary_shared_neutral,
    });
    
    // ✅ VALIDATION: Warn if summaries are identical (should never happen)
    if (parsedResponse.summary_a_perspective && parsedResponse.summary_shared_neutral &&
        parsedResponse.summary_a_perspective.trim() === parsedResponse.summary_shared_neutral.trim()) {
      console.warn('⚠️ WARNING: Claude returned identical summaries! This may cause issues.');
    }

    console.log('✅ Summary generated successfully');

    const allowedNameSet = new Set(
      (tagged_persons || [])
        .map((p: any) => (p?.name || '').trim().toLowerCase())
        .filter((name: string) => name.length > 0)
    );

    if (parsedResponse?.context_data?.pronoun_map?.third_party) {
      const sanitizedThirdParty: Record<string, any> = {};
      Object.entries(parsedResponse.context_data.pronoun_map.third_party).forEach(([name, pronouns]) => {
        const normalized = name.trim().toLowerCase();
        if (allowedNameSet.has(normalized)) {
          sanitizedThirdParty[name] = pronouns;
        }
      });
      parsedResponse.context_data.pronoun_map.third_party = sanitizedThirdParty;
    }

    // ✅ CRITICAL FIX: DO NOT clean @ and # tags here!
    // Tags must be preserved in the summary so generate-contextual-options can:
    // - Replace @ with "you" based on who is speaking (perspective-aware)
    // - Keep # for third parties being discussed
    // The cleaning happens in generate-contextual-options where we know the speaker's perspective

    return new Response(JSON.stringify(parsedResponse), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });


  } catch (error) {
    console.error('❌ Error in generate-summary:', error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
