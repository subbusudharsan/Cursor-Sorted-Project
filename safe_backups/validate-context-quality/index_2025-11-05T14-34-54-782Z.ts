/*
  # Context Quality Validation Function - Enhanced

  1. Purpose
    - Validates the quality and completeness of conversation context
    - Provides confidence scoring for AI option generation
    - Implements preprocessing layer for context cleaning

  2. Enhanced Validation Criteria
    - Latest message availability and relevance
    - Full conversation history completeness
    - Original issue context presence
    - Temporal consistency and session continuity
    - Conversation flow and coherence

  3. Quality Metrics
    - Context completeness score (0.0 - 1.0)
    - Recency relevance score (0.0 - 1.0)
    - Conversation coherence score (0.0 - 1.0)
    - Overall confidence rating
*/ import { createClient } from 'npm:@supabase/supabase-js@2.44.2';
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
// FORCED LOGGING - Multiple methods to ensure visibility
function forceLog(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] [VALIDATE-CONTEXT-FIXED] ${message}`;
  // BULLET 1&2 FIX: Use ALL logging methods including console.warn for maximum visibility
  console.log(logMsg);
  console.info(logMsg);
  console.warn(logMsg);
  console.error(logMsg); // Force visibility with error level
  if (data) {
    const dataMsg = `[${timestamp}] [VALIDATE-CONTEXT-FIXED] DATA: ${JSON.stringify(data, null, 2)}`;
    console.log(dataMsg);
    console.info(dataMsg);
    console.warn(dataMsg);
    console.error(dataMsg);
  }
}
function calculateRecencyScore(latestMessageTime: string) {
  const now = new Date();
  const messageTime = new Date(latestMessageTime);
  const ageMinutes = (now.getTime() - messageTime.getTime()) / (1000 * 60);
  // Enhanced scoring with more granular time windows
  if (ageMinutes <= 2) return 1.0;
  if (ageMinutes <= 5) return 0.95;
  if (ageMinutes <= 10) return 0.9;
  if (ageMinutes <= 15) return 0.85;
  if (ageMinutes <= 30) return 0.7;
  if (ageMinutes <= 60) return 0.5;
  if (ageMinutes <= 120) return 0.3;
  return 0.1;
}
function calculateCompletenessScore(messageCount, hasOriginalIssue, conversationThemes) {
  let score = 0.0;
  // Base score from message count with enhanced thresholds
  if (messageCount >= 15) score += 0.4;
  else if (messageCount >= 10) score += 0.35;
  else if (messageCount >= 5) score += 0.25;
  else if (messageCount >= 2) score += 0.15;
  else score += 0.05;
  // Bonus for original issue context
  if (hasOriginalIssue) score += 0.3;
  // Bonus for conversation depth and themes
  if (messageCount >= 20) score += 0.15;
  else if (messageCount >= 10) score += 0.1;
  // Bonus for identified themes (indicates meaningful conversation)
  if (conversationThemes.length >= 3) score += 0.1;
  else if (conversationThemes.length >= 1) score += 0.05;
  return Math.min(1.0, score);
}
function calculateCoherenceScore(messages) {
  if (messages.length < 2) return 0.2;
  let coherenceScore = 0.0;
  let alternatingPattern = 0;
  let reasonableTimingCount = 0;
  let meaningfulExchanges = 0;
  // Check for natural conversation flow (alternating speakers)
  for(let i = 1; i < messages.length; i++){
    if (messages[i].sender_type !== messages[i - 1].sender_type) {
      alternatingPattern++;
    }
    // Check for reasonable message timing
    const timeDiff = new Date(messages[i].created_at).getTime() - new Date(messages[i - 1].created_at).getTime();
    const minutesDiff = timeDiff / (1000 * 60);
    // Reasonable timing: between 10 seconds and 60 minutes
    if (minutesDiff >= 0.17 && minutesDiff <= 60) {
      reasonableTimingCount++;
    }
    // Check for meaningful exchanges (messages with substance)
    if (messages[i].content.length > 10 && messages[i - 1].content.length > 10) {
      meaningfulExchanges++;
    }
  }
  const alternatingRatio = alternatingPattern / (messages.length - 1);
  const timingRatio = reasonableTimingCount / (messages.length - 1);
  const meaningfulRatio = meaningfulExchanges / (messages.length - 1);
  coherenceScore = alternatingRatio * 0.4 + timingRatio * 0.3 + meaningfulRatio * 0.3;
  return Math.min(1.0, coherenceScore);
}
function calculateLatestResponseQuality(latestMessage) {
  if (!latestMessage) return 0.0;
  let quality = 0.0;
  const content = latestMessage.content || '';
  // Length indicates substance
  if (content.length >= 50) quality += 0.4;
  else if (content.length >= 20) quality += 0.3;
  else if (content.length >= 5) quality += 0.2;
  else quality += 0.1;
  // Check for emotional content or questions (indicates engagement)
  const emotionalWords = /\b(feel|think|believe|worry|hope|fear|love|hate|angry|sad|happy|excited|confused|frustrated)\b/i;
  const questions = /\?/g;
  if (emotionalWords.test(content)) quality += 0.3;
  if (questions.test(content)) quality += 0.2;
  // Avoid very short or generic responses
  const genericResponses = /^(ok|okay|yes|no|sure|maybe|idk|lol|haha)$/i;
  if (genericResponses.test(content.trim())) quality -= 0.2;
  return Math.max(0.0, Math.min(1.0, quality));
}
function extractConversationThemes(messages) {
  const allText = messages.map((m)=>m.content || '').join(' ').toLowerCase();
  const themes = [];
  // Enhanced theme detection patterns
  const themePatterns = [
    {
      pattern: /jealous|envy|envious|resentment/,
      theme: 'jealousy'
    },
    {
      pattern: /family|relatives|parents|siblings|mother|father|mom|dad/,
      theme: 'family_dynamics'
    },
    {
      pattern: /work|job|career|boss|colleague|office|workplace/,
      theme: 'work_stress'
    },
    {
      pattern: /relationship|partner|boyfriend|girlfriend|spouse|dating/,
      theme: 'romantic_relationship'
    },
    {
      pattern: /friend|friendship|social|buddy|pal/,
      theme: 'friendship'
    },
    {
      pattern: /money|financial|budget|expensive|cost|afford/,
      theme: 'financial_concerns'
    },
    {
      pattern: /health|sick|doctor|medical|hospital|pain/,
      theme: 'health_issues'
    },
    {
      pattern: /stress|pressure|overwhelm|anxiety|panic/,
      theme: 'stress_management'
    },
    {
      pattern: /communication|talk|discuss|conversation|listen/,
      theme: 'communication_issues'
    },
    {
      pattern: /trust|betrayal|lie|honest|truth|deceive/,
      theme: 'trust_issues'
    },
    {
      pattern: /angry|mad|furious|rage|irritated/,
      theme: 'anger_management'
    },
    {
      pattern: /sad|depressed|down|blue|grief|loss/,
      theme: 'sadness_grief'
    },
    {
      pattern: /decision|choice|choose|option|dilemma/,
      theme: 'decision_making'
    },
    {
      pattern: /conflict|argument|fight|disagree|dispute/,
      theme: 'conflict_resolution'
    }
  ];
  themePatterns.forEach(({ pattern, theme })=>{
    if (pattern.test(allText)) {
      themes.push(theme);
    }
  });
  return themes;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  // ABSOLUTE FORCED LOGGING
  forceLog("🔍 BULLET 1&2 FIX: VALIDATE-CONTEXT-QUALITY FUNCTION INVOKED");
  console.error("🔍 BULLET 1&2 FIX: VALIDATE-CONTEXT-QUALITY FUNCTION INVOKED - ERROR LEVEL");
  try {
    forceLog('🔍 BULLET 1&2 FIX: VALIDATION START');
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    const { chatId, userId, sessionId, requireMinimumHistory = 1, validateLatestResponse = true } = await req.json();
    forceLog('📥 VALIDATION INPUT', {
      chatId,
      userId,
      sessionId,
      requireMinimumHistory,
      validateLatestResponse
    });
    if (!chatId || !userId) {
      forceLog('❌ MISSING VALIDATION PARAMETERS', {
        chatId: !!chatId,
        userId: !!userId
      });
      return new Response(JSON.stringify({
        error: 'Missing required parameters: chatId or userId',
        validation_status: 'error'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Fetch chat context and metadata with enhanced validation
    const { data: chatData, error: chatError } = await supabaseAdmin.from('chats').select('context_data, ai_source_chat_id, created_at, last_message_at, user_id, contact_id').eq('id', chatId).single();
    if (chatError) {
      forceLog('❌ CHAT VALIDATION FETCH ERROR', chatError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch chat context - validation impossible',
        validation_status: 'error'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Fetch complete conversation messages with enhanced metadata
    const { data: messages, error: messagesError } = await supabaseAdmin.from('messages').select('content, sender_type, sender_id, created_at, message_type').eq('chat_id', chatId).order('created_at', {
      ascending: true
    });
    if (messagesError) {
      forceLog('❌ MESSAGES VALIDATION FETCH ERROR', messagesError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch messages - cannot validate context',
        validation_status: 'error'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const messageList = messages || [];
    const hasOriginalIssue = !!(chatData.context_data?.original_issue || chatData.ai_source_chat_id);
    const latestMessage = messageList[messageList.length - 1];
    const conversationThemes = extractConversationThemes(messageList);
    forceLog('📊 VALIDATION DATA', {
      messageCount: messageList.length,
      hasOriginalIssue,
      hasLatestMessage: !!latestMessage,
      themesDetected: conversationThemes.length,
      themes: conversationThemes
    });
    // Calculate enhanced quality scores
    const completenessScore = calculateCompletenessScore(messageList.length, hasOriginalIssue, conversationThemes);
    const recencyScore = latestMessage ? calculateRecencyScore(latestMessage.created_at) : 0.0;
    const coherenceScore = calculateCoherenceScore(messageList);
    const latestResponseQuality = validateLatestResponse ? calculateLatestResponseQuality(latestMessage) : 1.0;
    // Enhanced overall score calculation
    const themeScore = conversationThemes.length > 0 ? 0.2 : 0.0;
    const overallScore = completenessScore * 0.25 + recencyScore * 0.25 + coherenceScore * 0.2 + latestResponseQuality * 0.2 + themeScore * 0.1;
    forceLog('📊 QUALITY SCORES', {
      completenessScore,
      recencyScore,
      coherenceScore,
      latestResponseQuality,
      themeScore,
      overallScore
    });
    // Determine validation status with enhanced thresholds
    let validationStatus;
    // BULLET 1 FIX: Lowered thresholds to allow more contexts to pass and prevent option changes
    if (overallScore >= 0.3) validationStatus = 'excellent';
    else if (overallScore >= 0.2) validationStatus = 'good';
    else if (overallScore >= 0.1) validationStatus = 'fair';
    else if (overallScore >= 0.02) validationStatus = 'poor';
    else validationStatus = 'insufficient';
    forceLog('✅ BULLET 1&2 FIX: VALIDATION STATUS', {
      status: validationStatus,
      score: overallScore
    });
    // Generate enhanced recommendations
    const recommendations = [];
    if (completenessScore < 0.5) {
      recommendations.push('Conversation needs more context - encourage longer exchanges to build understanding');
    }
    if (recencyScore < 0.6) {
      recommendations.push('Latest message is getting stale - consider refreshing context or prompting for new input');
    }
    if (coherenceScore < 0.5) {
      recommendations.push('Conversation flow could be improved - check for natural alternation and meaningful exchanges');
    }
    if (latestResponseQuality < 0.4) {
      recommendations.push('Latest response lacks substance - may need clarification or more detailed input');
    }
    if (!hasOriginalIssue) {
      recommendations.push('Missing original issue context - may affect option relevance and continuity');
    }
    if (messageList.length < requireMinimumHistory) {
      recommendations.push(`Need at least ${requireMinimumHistory} messages for quality context generation`);
    }
    if (conversationThemes.length === 0) {
      recommendations.push('No clear themes detected - conversation may lack focus or depth');
    }
    if (themeScore === 0.0) {
      recommendations.push('Missing conversation themes - options may lack contextual relevance');
    }
    const latestMessageAge = latestMessage ? (new Date().getTime() - new Date(latestMessage.created_at).getTime()) / (1000 * 60) : 0;
    // Enhanced quality indicators
    const qualityIndicators = {
      sufficient_history: messageList.length >= requireMinimumHistory,
      recent_activity: recencyScore >= 0.2,
      coherent_flow: coherenceScore >= 0.2,
      original_context_available: hasOriginalIssue,
      latest_response_clear: latestResponseQuality >= 0.1,
      themes_detected: conversationThemes.length > 0
    };
    forceLog('🎯 BULLET 1&2 FIX: QUALITY INDICATORS', qualityIndicators);
    const qualityReport = {
      overall_score: overallScore,
      completeness_score: completenessScore,
      recency_score: recencyScore,
      coherence_score: coherenceScore,
      latest_response_quality: latestResponseQuality,
      validation_status: validationStatus,
      recommendations: recommendations,
      context_summary: {
        message_count: messageList.length,
        latest_message_age_minutes: Math.round(latestMessageAge),
        has_original_issue: hasOriginalIssue,
        conversation_depth: Math.min(10, Math.floor(messageList.length / 2)),
        has_recent_activity: recencyScore >= 0.7,
        conversation_themes: conversationThemes
      },
      quality_indicators: qualityIndicators
    };
    forceLog('📋 FINAL QUALITY REPORT', {
      overallScore: qualityReport.overall_score,
      validationStatus: qualityReport.validation_status,
      readyForGeneration: validationStatus !== 'insufficient' && qualityIndicators.latest_response_clear && qualityIndicators.themes_detected
    });
    return new Response(JSON.stringify({
      success: true,
      quality_report: qualityReport,
      chat_id: chatId,
      user_id: userId,
      session_id: sessionId,
      validation_passed: validationStatus !== 'insufficient',
      confidence_threshold_met: overallScore >= 0.15,
      ready_for_option_generation: overallScore >= 0.02 && qualityIndicators.latest_response_clear,
      timestamp: new Date().toISOString(),
      display_format_suggestion: 'vertical',
      anti_regeneration_enabled: true,
      processing_metadata: {
        themes_detected: conversationThemes.length,
        quality_indicators_passed: Object.values(qualityIndicators).filter(Boolean).length,
        total_quality_checks: Object.keys(qualityIndicators).length
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    forceLog('💥 CRITICAL ERROR', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return new Response(JSON.stringify({
      error: 'Internal server error in context validation',
      validation_status: 'error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
