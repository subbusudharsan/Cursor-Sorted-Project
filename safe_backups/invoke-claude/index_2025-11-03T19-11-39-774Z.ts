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
    console.log('🤖 invoke-claude function called');
    // Check environment variables
    const CLAUDE_API_KEY = Deno.env.get('CLAUDE_API_KEY');
    if (!CLAUDE_API_KEY) {
      console.error('❌ CLAUDE_API_KEY environment variable not found');
      return new Response(JSON.stringify({
        error: 'Claude API key not configured. Please set CLAUDE_API_KEY in Supabase Edge Function secrets.'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Validate API key format
    if (!CLAUDE_API_KEY.startsWith('sk-ant-')) {
      console.error('Invalid Claude API key format');
      return new Response(JSON.stringify({
        error: 'Invalid Claude API key format. Please check your API key in Supabase secrets.'
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
      model: 'claude-3-haiku-20240307',
      max_tokens: requestBody.max_tokens || 1024,
      system: system || 'You are a helpful AI assistant.',
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
