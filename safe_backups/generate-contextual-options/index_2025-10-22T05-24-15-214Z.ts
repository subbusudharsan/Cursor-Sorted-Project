hello

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    const { chatId, recipientId, currentUserId, currentMessage, summary, thoughts, originalIssueSummary, recipientSummary, hint_from_b, originalIssue, hintFromB, hintToContact, summaryB, thoughtsB, conversationHistory, isInitial, contactCategory, conversationPhase, resolutionDetected } = await req.json();
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY not configured");
    }
    const isRecipientUserA = recipientId === (conversationHistory[0]?.sender_id === recipientId ? conversationHistory[0]?.sender_id : conversationHistory[1]?.sender_id);
    const formattedHistory = conversationHistory.map((msg)=>`${msg.sender_id === recipientId ? 'You' : 'Contact'}: ${msg.content}`).join('\n');
    const systemPrompt = `You are an expert conversation facilitator helping users communicate effectively about interpersonal issues.

Your task is to generate 3 complete, meaningful response options that:
1. Are COMPLETE SENTENCES with proper punctuation and capitalization
2. Address the specific message just received
3. Progress the conversation naturally toward understanding and resolution
4. Match the conversational tone and stage (warmup, exploration, or resolution)
5. Are distinct in approach (validating, questioning, or proposing)

CRITICAL RULES:
- Each option MUST be a complete, grammatically correct sentence
- Options should be 10-30 words each (not fragments)
- Include natural conversation flow words like "I understand...", "Could you...", "Maybe we could..."
- Ensure options feel genuine and human, not robotic
- Vary the tone: empathetic, curious, and solution-oriented

Context:
- Conversation phase: ${conversationPhase || 'warmup'}
- Contact category: ${contactCategory || 'General'}
- Original issue: ${originalIssueSummary || 'Not specified'}
${hintFromB ? `- Hint from recipient: ${hintFromB}` : ''}

Recent conversation:
${formattedHistory || 'This is the start of the conversation'}

Latest message to respond to: "${currentMessage}"

Recipient's context:
- Summary: ${summary || recipientSummary || 'No summary provided'}
- Thoughts: ${thoughts || thoughtsB || 'No thoughts provided'}`;
    const userPrompt = `Generate exactly 3 complete, meaningful response options for the recipient to choose from.

Each option should:
1. Be a COMPLETE SENTENCE (not a fragment)
2. Directly respond to: "${currentMessage}"
3. Help move toward ${conversationPhase === 'resolution' ? 'closure and resolution' : conversationPhase === 'exploration' ? 'deeper understanding' : 'opening up the conversation'}
4. Feel natural and human

Format as JSON:
{
  "options": ["Complete sentence 1.", "Complete sentence 2.", "Complete sentence 3."]
}`;
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
         "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307"",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `${systemPrompt}\n\n${userPrompt}`
          }
        ]
      })
    });
    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error("Anthropic API error:", errorText);
      throw new Error(`Anthropic API failed: ${anthropicResponse.status}`);
    }
    const anthropicData = await anthropicResponse.json();
    const responseText = anthropicData.content[0].text;
    let optionsData;
    try {
      optionsData = JSON.parse(responseText);
    } catch  {
      const jsonMatch = responseText.match(/\{[\s\S]*"options"[\s\S]*\}/);
      if (jsonMatch) {
        optionsData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Could not parse options from response");
      }
    }
    const options = optionsData.options || [];
    if (options.length < 3) {
      throw new Error("Insufficient options generated");
    }
    const { data: insertData, error: insertError } = await Deno.env.get("SUPABASE_URL") ? await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/message_options`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": Deno.env.get("SUPABASE_ANON_KEY") || "",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        chat_id: chatId,
        recipient_id: recipientId,
        options: options.slice(0, 3),
        context_data: {
          conversationStage: conversationPhase,
          turnCount: conversationHistory.length
        }
      })
    }).then((r)=>({
        data: null,
        error: r.ok ? null : new Error(`Insert failed: ${r.status}`)
      })) : {
      data: null,
      error: new Error("Supabase not configured")
    };
    if (insertError) {
      console.error("Failed to insert options:", insertError);
      throw insertError;
    }
    return new Response(JSON.stringify({
      success: true,
      options: options.slice(0, 3),
      chatId,
      recipientId
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in generate-contextual-options:", error);
    return new Response(JSON.stringify({
      error: error.message || "Failed to generate options",
      details: error.toString()
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
