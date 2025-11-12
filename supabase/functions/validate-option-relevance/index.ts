/*
  # Validate Option Relevance Function - BATCH OPTIMIZED VERSION

  1. Purpose
    - Validates multiple options in a SINGLE Claude API call (major performance improvement)
    - Ensures options stay focused on core issue throughout conversation
    - Combines summary + conversation history into unified context check

  2. Validation Gates (Optimized to 2 gates + duplicate check)
    - Gate 1: Unified Context Relevance (combines issue + latest message check)
    - Gate 2: No Repetition (not shown to this recipient before)

  3. Performance Improvements
    - Batch validation: 1 API call instead of 3-5 separate calls
    - Unified context: Combined summary + conversation history validation
    - Parallel processing: All options validated simultaneously

  4. Security
    - Uses environment variables for API keys
    - Validates request format
    - Handles CORS properly
*/ import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
// Extract keywords from text (simple implementation)
function extractKeywords(text: string): string[] {
  if (!text) return [];
  const stopWords = [
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'by',
    'from',
    'is',
    'was',
    'are',
    'were',
    'been',
    'be',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should'
  ];
  const words = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w: string)=>w.length > 3 && !stopWords.includes(w));
  // Return unique words
  return [
    ...new Set(words)
  ];
}
// Check for keyword overlap
function hasKeywordOverlap(text: string, keywords: string[]) {
  const textLower = text.toLowerCase();
  const found = keywords.filter((kw: string)=>textLower.includes(kw));
  return {
    found,
    hasOverlap: found.length > 0
  };
}
// Fuzzy match for repetition detection (Levenshtein-like simple version)
function isSimilar(str1: string, str2: string): boolean {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return true;
  // Check word overlap
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const overlap = words1.filter((w: string)=>words2.includes(w)).length;
  const similarity = overlap / Math.max(words1.length, words2.length);
  return similarity > 0.7; // 70% word overlap = similar
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    const CLAUDE_API_KEY = Deno.env.get('CLAUDE_API_KEY');
    if (!CLAUDE_API_KEY) {
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
    const { options, summary, thoughts, latestMessage, conversationHistory = [], previousOptions = [], hintFromB = "", isRecipientUserA = true } = await req.json();
    console.log('🔍 BATCH VALIDATING OPTIONS:', {
      optionCount: options.length,
      hasSummary: !!summary,
      hasLatestMessage: !!latestMessage,
      historyLength: conversationHistory.length,
      previousOptionsCount: previousOptions.length,
      hasHint: !!hintFromB
    });
    const startTime = Date.now();
    // ========================================
    // STEP 1: Quick duplicate check (local, no API call)
    // ========================================
    const duplicateChecks = options.map((option: string)=>({
        option,
        isDuplicate: previousOptions.some((prevOpt: string)=>isSimilar(option, prevOpt))
      }));
    const nonDuplicateOptions = duplicateChecks.filter((check: any)=>!check.isDuplicate).map((check: any)=>check.option);
    console.log(`✓ Duplicate Check: ${nonDuplicateOptions.length}/${options.length} options are unique`);
    // ========================================
    // STEP 2: Batch validate all non-duplicate options in SINGLE Claude call
    // ========================================
    const validationResults: any[] = [];
    if (nonDuplicateOptions.length > 0) {
      // Build unified context (summary + conversation history combined)
      const fullContext = [
        summary,
        thoughts
      ].filter(Boolean).join('\n\nEmotional context: ').trim();
      const recentHistory = conversationHistory.slice(-3).map((m: any)=>m.content).join(' ');
      const unifiedContext = `${fullContext}\n\nRecent conversation: ${recentHistory}`.trim();
      // Add hint and issue emphasis
      const issueFocus = summary ? `The core issue: "${summary}"` : "No explicit issue provided.";
      const hintFocus = hintFromB ? `The emotional hint from other person: "${hintFromB}"` : "No emotional hint provided.";
      // Single batch validation prompt for ALL options
      const batchPrompt = `
${issueFocus}
${hintFocus}

Context:
- Core issue/summary: "${fullContext}"
- Latest message: "${latestMessage}"
- Recent conversation history: "${recentHistory}"

Evaluate these ${nonDuplicateOptions.length} response options:
${nonDuplicateOptions.map((opt: string, i: number)=>`${i + 1}. "${opt}"`).join('\n')}

Check each option:
1. Does it respond to or align with the main issue?
2. Does it naturally connect to the emotional hint (if present)?
3. Is it contextually relevant to the latest message?

Respond with ONLY a JSON array of ${nonDuplicateOptions.length} "Yes" or "No" answers.
Example: ["Yes", "No", "Yes"]

Your answer:`;
      try {
        const batchResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 100,
            temperature: 0,
            messages: [
              {
                role: 'user',
                content: batchPrompt
              }
            ]
          })
        });
        if (batchResponse.ok) {
          const result = await batchResponse.json();
          const responseText = result.content[0].text.trim();
          // Parse the JSON array response
          const jsonMatch = responseText.match(/\[.*\]/);
          if (jsonMatch) {
            const answers = JSON.parse(jsonMatch[0]);
            // Map answers back to options
            nonDuplicateOptions.forEach((option: string, index: number)=>{
              const passed = answers[index]?.toLowerCase().includes('yes') ?? false;
              (validationResults as any[]).push({
                option,
                contextRelevance: passed,
                isDuplicate: false,
                overallPass: passed,
                failureReason: passed ? '' : 'not contextually relevant',
                score: passed ? 1.0 : 0
              });
            });
            console.log(`✅ Batch validation completed: ${validationResults.filter((r: any)=>r.overallPass).length}/${nonDuplicateOptions.length} passed`);
          } else {
            // Fallback: accept all if can't parse
            console.warn('⚠️ Could not parse batch validation response, accepting all');
            nonDuplicateOptions.forEach((option: string)=>{
              validationResults.push({
                option,
                contextRelevance: true,
                isDuplicate: false,
                overallPass: true,
                failureReason: '',
                score: 0.8
              });
            });
          }
        } else {
          // Fallback: accept all if API fails
          console.warn('⚠️ Batch validation API failed, accepting all options');
          nonDuplicateOptions.forEach((option: string)=>{
            validationResults.push({
              option,
              contextRelevance: true,
              isDuplicate: false,
              overallPass: true,
              failureReason: '',
              score: 0.7
            });
          });
        }
      } catch (error) {
        console.error('❌ Batch validation error:', error);
        // Fallback: accept all on error
        nonDuplicateOptions.forEach((option: string)=>{
          validationResults.push({
            option,
            contextRelevance: true,
            isDuplicate: false,
            overallPass: true,
            failureReason: '',
            score: 0.7
          });
        });
      }
    }
    // Add duplicate options with failed status
    duplicateChecks.filter((check: any)=>check.isDuplicate).forEach((check: any)=>{
      validationResults.push({
        option: check.option,
        contextRelevance: false,
        isDuplicate: true,
        overallPass: false,
        failureReason: 'too similar to previous option',
        score: 0
      });
    });
    const totalTime = Date.now() - startTime;
    const passedCount = validationResults.filter((r: any)=>r.overallPass).length;
    console.log(`\n🎯 BATCH VALIDATION COMPLETE (${totalTime}ms): ${passedCount}/${options.length} options passed`);
    return new Response(JSON.stringify({
      results: validationResults,
      totalTime
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('❌ Validation error:', error);
    return new Response(JSON.stringify({
      error: 'Validation failed',
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
