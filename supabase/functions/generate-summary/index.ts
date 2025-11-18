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
          `- ${p.name}${p.is_user_b ? ' (person I need to talk to)' : ''}${p.relationship ? ` (${p.relationship})` : ''}`
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
Simply reorganize what the user said into a clean, clear, meaningful summary.

Focus on clarity, NOT expansion or shortening.

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

Example:
"I felt ignored at the family dinner when @you barely spoke to me. It seemed intentional and made me feel unwanted, especially when #Mom and others were talking normally."

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

Example:
"The discussion is about the family dinner where User B (@you) spoke very little to User A. User A perceived this as intentional and felt excluded, especially compared to the interactions with #Mom and others."

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
- A-PERSPECTIVE SUMMARY: Emotional, first-person, preserves @ and # tags
- NEUTRAL SHARED SUMMARY: Factual, third-person, preserves @ and # tags, NO assumptions about User B's feelings
- Use empathetic, non-judgmental language
- Identify user_b (person they're talking TO) vs third parties
- Choose appropriate pronouns based on names and context
- NEVER invent new person names. Only reference names that appear in the initial description, Q&A responses, or the tagged_persons list. If no name is provided, describe the person generically (e.g., "a coworker").
- Preserve ALL important emotional context in A-PERSPECTIVE SUMMARY only
- Keep NEUTRAL SHARED SUMMARY purely factual and neutral
- ALWAYS generate BOTH summaries - never skip or return null
- Apply input validation rules to filter out meaningless inputs while accepting all meaningful content
- Maintain natural summary length based on user input - do not expand or compress unnecessarily`;

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
