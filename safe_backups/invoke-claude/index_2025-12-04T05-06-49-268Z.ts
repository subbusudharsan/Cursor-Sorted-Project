/*
  # Claude AI Integration Function

  1. Purpose
    - Integrates with Claude AI API for conversational responses
    - Handles authentication and request formatting
    - Provides error handling and response formatting

  2. Security
    - Uses environment variables for API keys
    - Validates request format
    - Handles CORS properly

  3. Response Format
    - Returns formatted AI responses
    - Includes error handling for API failures
*/ const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
Deno.serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    console.log('🤖 invoke-groq function called');
    // Check environment variables
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
    if (!GROQ_API_KEY) {
      console.error('❌ GROQ_API_KEY environment variable not found');
      return new Response(JSON.stringify({
        error: 'Groq API key not configured. Please set GROQ_API_KEY in Supabase Edge Function secrets.'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Parse request body
    const requestBody = await req.json();
    const { model, system, messages, chatId } = requestBody;
    console.log('📝 Request received:', {
      hasModel: !!model,
      hasSystem: !!system,
      messageCount: messages?.length || 0,
      chatId: chatId || 'N/A'
    });
    // Validate request
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({
        error: 'Invalid messages format - must be a non-empty array'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Prepare Claude API request with Sonnet model for better quality
    const claudePayload = {
      model: 'claude-3-5-haiku-20241022',
      max_tokens: requestBody.max_tokens || 200,
      system: system || `
You are aware of advanced reasoning models such as Claude 3.7 Sonnet,
Claude 3.5 Sonnet, GPT-4.1, and OpenAI o1 — but you must behave
consistently using the current Haiku model.

You are a helpful AI assistant.
`,

      messages: messages
    };
    console.log('🚀 Calling Claude API with Sonnet model...');
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
      console.error('Claude API error:', {
        status: claudeResponse.status,
        statusText: claudeResponse.statusText,
        body: errorText
      });
      let errorMessage = 'Claude API request failed';
      if (claudeResponse.status === 401) {
        errorMessage = 'Invalid Claude API key. Please check your API key in Supabase secrets.';
      } else if (claudeResponse.status === 429) {
        errorMessage = 'Claude API rate limit exceeded. Please try again later.';
      } else if (claudeResponse.status === 400) {
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || 'Invalid request to Claude API';
        } catch  {
          errorMessage = 'Invalid request to Claude API';
        }
      }
      return new Response(JSON.stringify({
        error: errorMessage
      }), {
        status: claudeResponse.status >= 500 ? 500 : claudeResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const claudeResult = await claudeResponse.json();
    console.log('✅ Claude response received, extracting content...');
    if (!claudeResult.content || !claudeResult.content[0] || !claudeResult.content[0].text) {
      console.error('❌ Invalid Claude response format:', claudeResult);
      return new Response(JSON.stringify({
        error: 'Invalid response format from Claude API'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const responseContent = claudeResult.content[0].text;
    console.log('✅ Sending response to client:', responseContent.substring(0, 100));
    return new Response(JSON.stringify({
      content: responseContent
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Unexpected error in invoke-claude function:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error in Claude integration'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
// Test comment - Sun Nov  2 12:25:33 UTC 2025
