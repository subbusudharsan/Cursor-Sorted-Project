/*
  # Groq AI Integration Function

  1. Purpose
    - Integrates with Groq Llama AI API for conversational responses
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
    // Prepare Groq API request
    const groqPayload = {
      model: 'llama-3.1-8b-instant',
      max_tokens: requestBody.max_tokens || 200,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: system || 'You are a helpful AI assistant.'
        },
        ...messages
      ]
    };
    console.log('🚀 Calling Groq API...');
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify(groqPayload)
    });
    console.log('📡 Groq API response status:', groqResponse.status);
    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error('Groq API error:', {
        status: groqResponse.status,
        statusText: groqResponse.statusText,
        body: errorText
      });
      let errorMessage = 'Groq API request failed';
      if (groqResponse.status === 401) {
        errorMessage = 'Invalid Groq API key. Please check your API key in Supabase secrets.';
      } else if (groqResponse.status === 429) {
        errorMessage = 'Groq API rate limit exceeded. Please try again later.';
      } else if (groqResponse.status === 400) {
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || 'Invalid request to Groq API';
        } catch  {
          errorMessage = 'Invalid request to Groq API';
        }
      }
      return new Response(JSON.stringify({
        error: errorMessage
      }), {
        status: groqResponse.status >= 500 ? 500 : groqResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const groqResult = await groqResponse.json();
    console.log('✅ Groq response received, extracting content...');
    if (!groqResult.choices || !groqResult.choices[0] || !groqResult.choices[0].message || !groqResult.choices[0].message.content) {
      console.error('❌ Invalid Groq response format:', groqResult);
      return new Response(JSON.stringify({
        error: 'Invalid response format from Groq API'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const responseContent = groqResult.choices[0].message.content;
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
      console.error('Unexpected error in invoke-groq function:', error);
      return new Response(JSON.stringify({
        error: 'Internal server error in Groq integration'
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
