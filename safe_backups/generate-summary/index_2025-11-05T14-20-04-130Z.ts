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
    const { initial_description, question_responses, tagged_persons } = requestBody;

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

    const personsText = tagged_persons && tagged_persons.length > 0
      ? `\n\nPeople involved:\n${tagged_persons.map((p: any) =>
          `- ${p.name}${p.is_user_b ? ' (person I need to talk to)' : ''}${p.relationship ? ` (${p.relationship})` : ''}`
        ).join('\n')}`
      : '';

    const systemPrompt = `You are an empathetic AI assistant helping someone prepare for a difficult conversation.

Your task is to:
1. SYNTHESIZE ALL INFORMATION from initial description AND every Q&A response
2. Create a comprehensive summary that includes details from EVERY answer provided
3. Extract 3-5 key points capturing the COMPLETE situation
4. Identify relationship context and proper pronouns
5. Build pronoun map for conversation flow

CRITICAL: The summary MUST incorporate ALL Q&A responses, not just the initial description. Include:
- What happened (initial issue + additional details from Q&A)
- How the person feels (emotional context from all responses)
- Relevant background (context revealed through Q&A)
- What they want (desired outcome from responses)

Return ONLY valid JSON with this structure:
{
  "summary": "3-4 sentence comprehensive summary incorporating ALL Q&A details",
  "key_points": [
    "Initial Issue: [what happened]",
    "Emotional Impact: [how they feel with specifics]",
    "Context: [relevant details from Q&A]",
    "Desired Outcome: [what they want]"
  ],
  "context_data": {
    "summary": "same as above summary",
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

Guidelines:
- MUST include information from ALL Q&A responses in summary
- Summary should be 3-4 sentences capturing complete context
- Key points should reflect insights from entire conversation
- Use empathetic, non-judgmental language
- Identify user_b (person they're talking TO) vs third parties
- Choose appropriate pronouns based on names and context
- Preserve ALL important emotional context from responses`;

    const claudePayload = {
      model: 'claude-3-haiku-20240307',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Create a summary from this information:

Initial Description:
"${initial_description}"

Follow-up Q&A:
${qaText}${personsText}

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

      return new Response(JSON.stringify({
        summary: fallbackSummary,
        key_points: ['Situation described', 'Needs resolution'],
        context_data: {
          summary: fallbackSummary,
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
      console.error('Invalid response format');

      const fallbackSummary = initial_description.substring(0, 200);
      const userB = tagged_persons?.find((p: any) => p.is_user_b);

      return new Response(JSON.stringify({
        summary: fallbackSummary,
        key_points: ['Situation described', 'Needs resolution'],
        context_data: {
          summary: fallbackSummary,
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

    console.log('✅ Summary generated successfully');

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
