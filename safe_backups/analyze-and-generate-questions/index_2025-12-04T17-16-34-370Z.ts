/*
  # Analyze and Generate Questions Function

  1. Purpose
    - Analyzes user's initial description
    - Generates 3 contextual follow-up questions using Groq Llama AI
    - Detects mentioned contacts and relationships
    - Provides fallback questions if AI fails

  2. Security
    - Uses environment variables for API keys
    - Validates request format
    - Handles CORS properly

  3. Response Format
    - Returns array of generated questions with answer types
    - Includes detected contacts/persons
    - Indicates if fallback questions were used
*/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};

const FALLBACK_QUESTIONS = [
  {
    question: "What specifically happened?",
    answer_type: "text" as const,
    placeholder: "Describe the situation in more detail..."
  },
  {
    question: "How did this make you feel?",
    answer_type: "dropdown" as const,
    options: ["Hurt", "Angry", "Disappointed", "Confused", "Frustrated", "Sad", "Other"]
  },
  {
    question: "What would you like to happen next?",
    answer_type: "text" as const,
    placeholder: "What outcome are you hoping for?"
  }
];

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }

  try {
    console.log('🔍 analyze-and-generate-questions function called');

    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');

    const requestBody = await req.json();
    const { description, user_id, available_contacts } = requestBody;

    console.log('📝 Request received:', {
      descriptionLength: description?.length || 0,
      userId: user_id,
      contactCount: available_contacts?.length || 0
    });

    if (!description || typeof description !== 'string') {
      return new Response(JSON.stringify({
        error: 'Description is required and must be a string'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    if (!GROQ_API_KEY) {
      console.warn('⚠️ Groq API key not configured, using fallback questions');
      return new Response(JSON.stringify({
        questions: FALLBACK_QUESTIONS,
        detected_contacts: [],
        fallback_used: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const contactContext = available_contacts && available_contacts.length > 0
      ? `\n\nAvailable contacts: ${available_contacts.map((c: any) => `${c.full_name} (${c.category || 'General'})`).join(', ')}`
      : '';

    const systemPrompt = `You are an empathetic AI assistant helping someone prepare for a difficult conversation.

Your task is to:
1. Analyze their initial description carefully
2. Generate EXACTLY 3 thoughtful, contextual follow-up questions
3. DO NOT ask about information already provided in the description
4. Focus ONLY on: emotional impact, desired outcome, and key missing context
5. Detect any people mentioned (look for names, pronouns like "he/she/they", or relationship words like "friend", "mom", "boss")

CRITICAL RULES:
- Generate EXACTLY 3 questions, no more, no less
- Each question must gather NEW information not in the description
- Questions must be SHORT (under 12 words)
- NO repetition of information already provided
- Focus on: What happened (if unclear), How they feel, What they want

Answer types:
- "text": Open-ended response (preferred for most questions)
- "dropdown": Limited predefined options (ONLY for emotions/feelings)

Return ONLY valid JSON with this structure:
{
  "questions": [
    {
      "question": "string (under 12 words)",
      "answer_type": "text" | "dropdown",
      "options": ["array of strings"] (only if dropdown),
      "placeholder": "string" (optional hint text)
    }
  ],
  "detected_contacts": [
    {
      "name": "string",
      "is_user_b": boolean (true if this is who they're talking TO),
      "relationship": "string" (if mentioned)
    }
  ]
}

Guidelines:
- EXACTLY 3 questions
- Each question explores ONE new aspect
- Keep questions short, direct, and empathetic
- Use dropdown ONLY for emotions (limit to 5-6 options)
- Avoid asking what's already clear from the description`;

    const groqPayload = {
      model: 'llama-3.1-8b-instant',
      max_tokens: 1500,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `Analyze this description and generate follow-up questions:\n\n"${description}"${contactContext}\n\nRespond with ONLY the JSON structure specified in the system prompt.`
        }
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
      console.error('Groq API error:', errorText);

      return new Response(JSON.stringify({
        questions: FALLBACK_QUESTIONS,
        detected_contacts: [],
        fallback_used: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const groqData = await groqResponse.json();
    const responseText = groqData.choices?.[0]?.message?.content || '';

    console.log('📄 Groq response received:', responseText.substring(0, 200));

    let parsedResponse;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse Groq response:', parseError);
      return new Response(JSON.stringify({
        questions: FALLBACK_QUESTIONS,
        detected_contacts: [],
        fallback_used: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    if (!parsedResponse.questions || !Array.isArray(parsedResponse.questions)) {
      console.error('Invalid questions format in response');
      return new Response(JSON.stringify({
        questions: FALLBACK_QUESTIONS,
        detected_contacts: [],
        fallback_used: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log('✅ Generated questions:', parsedResponse.questions.length);

    return new Response(JSON.stringify({
      questions: parsedResponse.questions,
      detected_contacts: parsedResponse.detected_contacts || [],
      fallback_used: false
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('❌ Error in analyze-and-generate-questions:', error);

    return new Response(JSON.stringify({
      questions: FALLBACK_QUESTIONS,
      detected_contacts: [],
      fallback_used: true,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
