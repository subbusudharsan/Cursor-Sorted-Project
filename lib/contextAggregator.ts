export interface ConversationContext {
  chatId: string;
  recipientId: string;
  currentUserId: string;

  // User perspectives
  summaryA: string;
  thoughtsA: string;
  summaryB?: string;
  thoughtsB?: string;

  // Hints and communication
  hintToContact?: {
    issue: string;
    timeline: string;
    full_text: string;
  };
  hintFromB?: string;

  // Conversation metadata
  conversationHistory: Array<{ sender_id: string; content: string }>;
  latestMessage: string;
  latestMessageSenderId: string;
  contactCategory: string;
  conversationPhase: string;
  conversationStage?: string;
  turnCount?: number;
  resolutionDetected: boolean;

  // Context quality indicators
  aiConfidenceLevel: string;
  hasUserAContext: boolean;
  hasUserBContext: boolean;
  hasConversationFlow: boolean;
}

export interface ValidationCriteria {
  perspectiveScore: number;
  historyRelevanceScore: number;
  summaryAlignmentScore: number;
  latestMessageScore: number;
  combinedScore: number;
  passed: boolean;
  reason?: string;
}

export interface ValidatedOption {
  text: string;
  validation: ValidationCriteria;
}

export function buildConversationContext(params: {
  chatId: string;
  recipientId: string;
  currentUserId: string;
  contextData: any;
  conversationHistory: Array<{ sender_id: string; content: string }>;
  latestMessage: string;
  latestMessageSenderId: string;
  contactCategory: string;
  aiConfidenceLevel?: string;
  conversationPhase?: string;
  resolutionDetected?: boolean;
}): ConversationContext {
  const {
    chatId,
    recipientId,
    currentUserId,
    contextData,
    conversationHistory,
    latestMessage,
    latestMessageSenderId,
    contactCategory,
    aiConfidenceLevel = 'high',
    conversationPhase = 'opening',
    resolutionDetected = false,
  } = params;

  const summaryA = contextData?.summary_a || contextData?.summary || '';
  const thoughtsA = contextData?.thoughts_a || contextData?.thoughts || '';
  const summaryB = contextData?.summary_b || '';
  const thoughtsB = contextData?.thoughts_b || '';
  const hintToContact = contextData?.hint_to_contact || null;
  const hintFromB = contextData?.hint_from_b || '';

  const hasUserAContext = summaryA.length > 20;
  const hasUserBContext = (hintFromB && hintFromB.length > 10) || (summaryB && summaryB.length > 20);
  const hasConversationFlow = conversationHistory && conversationHistory.length >= 2;

  return {
    chatId,
    recipientId,
    currentUserId,
    summaryA,
    thoughtsA,
    summaryB,
    thoughtsB,
    hintToContact,
    hintFromB,
    conversationHistory,
    latestMessage,
    latestMessageSenderId,
    contactCategory,
    conversationPhase,
    conversationStage: contextData?.conversationStage,
    turnCount: contextData?.turnCount,
    resolutionDetected,
    aiConfidenceLevel,
    hasUserAContext,
    hasUserBContext,
    hasConversationFlow,
  };
}

export function validateOptionRelevance(
  option: string,
  context: ConversationContext
): ValidationCriteria {
  const scores: ValidationCriteria = {
    perspectiveScore: 0,
    historyRelevanceScore: 0,
    summaryAlignmentScore: 0,
    latestMessageScore: 0,
    combinedScore: 0,
    passed: false,
  };

  // 1. Perspective Alignment Check (25%)
  scores.perspectiveScore = checkPerspectiveAlignment(option, context);

  // 2. Conversation History Relevance (25%)
  scores.historyRelevanceScore = checkHistoryRelevance(option, context);

  // 3. Summary Issue Alignment (25%)
  scores.summaryAlignmentScore = checkSummaryAlignment(option, context);

  // 4. Latest Message Responsiveness (25%)
  scores.latestMessageScore = checkLatestMessageResponse(option, context);

  // Calculate combined score
  scores.combinedScore =
    (scores.perspectiveScore * 0.25 +
      scores.historyRelevanceScore * 0.25 +
      scores.summaryAlignmentScore * 0.25 +
      scores.latestMessageScore * 0.25) * 100;

  // Pass if combined score >= 60%
  scores.passed = scores.combinedScore >= 60;

  if (!scores.passed) {
    const failedCriteria: string[] = [];
    if (scores.perspectiveScore < 0.6) failedCriteria.push('perspective');
    if (scores.historyRelevanceScore < 0.6) failedCriteria.push('history');
    if (scores.summaryAlignmentScore < 0.6) failedCriteria.push('summary');
    if (scores.latestMessageScore < 0.6) failedCriteria.push('latest message');
    scores.reason = `Low scores in: ${failedCriteria.join(', ')}`;
  }

  return scores;
}

function checkPerspectiveAlignment(option: string, context: ConversationContext): number {
  const isUserA = context.recipientId === context.currentUserId;
  const userSummary = isUserA ? context.summaryA : context.summaryB || '';
  const userThoughts = isUserA ? context.thoughtsA : context.thoughtsB || '';

  if (!userSummary && !userThoughts) return 0.5;

  const optionLower = option.toLowerCase();
  const summaryLower = userSummary.toLowerCase();
  const thoughtsLower = userThoughts.toLowerCase();

  const summaryWords = summaryLower.split(/\s+/).filter(w => w.length > 3);
  const thoughtsWords = thoughtsLower.split(/\s+/).filter(w => w.length > 3);
  const allContextWords = [...new Set([...summaryWords, ...thoughtsWords])];

  if (allContextWords.length === 0) return 0.5;

  let matchCount = 0;
  for (const word of allContextWords) {
    if (optionLower.includes(word)) {
      matchCount++;
    }
  }

  const matchRatio = matchCount / Math.min(allContextWords.length, 10);
  return Math.min(matchRatio * 1.5, 1.0);
}

function checkHistoryRelevance(option: string, context: ConversationContext): number {
  if (!context.conversationHistory || context.conversationHistory.length === 0) {
    return 1.0;
  }

  const recentMessages = context.conversationHistory.slice(-5);
  const optionLower = option.toLowerCase();

  const historyText = recentMessages.map(m => m.content.toLowerCase()).join(' ');
  const historyWords = historyText.split(/\s+/).filter(w => w.length > 3);
  const uniqueWords = [...new Set(historyWords)];

  if (uniqueWords.length === 0) return 0.8;

  let matchCount = 0;
  for (const word of uniqueWords.slice(0, 15)) {
    if (optionLower.includes(word)) {
      matchCount++;
    }
  }

  const matchRatio = matchCount / Math.min(uniqueWords.length, 15);
  return Math.min(matchRatio * 2, 1.0);
}

function checkSummaryAlignment(option: string, context: ConversationContext): number {
  const summary = context.summaryA || '';
  if (!summary || summary.length < 10) {
    return 0.7;
  }

  const optionLower = option.toLowerCase();
  const summaryLower = summary.toLowerCase();

  const summaryWords = summaryLower.split(/\s+/).filter(w => w.length > 4);
  const keyWords = [...new Set(summaryWords)].slice(0, 10);

  if (keyWords.length === 0) return 0.7;

  let matchCount = 0;
  for (const word of keyWords) {
    if (optionLower.includes(word)) {
      matchCount++;
    }
  }

  const matchRatio = matchCount / keyWords.length;

  if (context.conversationPhase === 'discussion' || context.conversationPhase === 'closure') {
    return Math.min(matchRatio * 1.8, 1.0);
  }

  return Math.min(matchRatio * 1.2 + 0.3, 1.0);
}

function checkLatestMessageResponse(option: string, context: ConversationContext): number {
  if (!context.latestMessage || context.latestMessage.length < 3) {
    return 0.8;
  }

  const optionLower = option.toLowerCase();
  const latestLower = context.latestMessage.toLowerCase();

  const latestWords = latestLower.split(/\s+/).filter(w => w.length > 3);
  const keyWords = [...new Set(latestWords)];

  if (keyWords.length === 0) return 0.8;

  let matchCount = 0;
  for (const word of keyWords) {
    if (optionLower.includes(word)) {
      matchCount++;
    }
  }

  const thematicResponses = [
    'how', 'why', 'what', 'when', 'where', 'who',
    'feel', 'think', 'understand', 'agree', 'sorry',
    'thanks', 'appreciate', 'glad', 'hope'
  ];

  let thematicMatch = false;
  for (const theme of thematicResponses) {
    if (latestLower.includes(theme) && optionLower.includes(theme)) {
      thematicMatch = true;
      break;
    }
  }

  const matchRatio = matchCount / Math.min(keyWords.length, 8);
  const baseScore = Math.min(matchRatio * 2, 0.9);

  return thematicMatch ? Math.min(baseScore + 0.3, 1.0) : baseScore;
}

export function filterValidOptions(
  options: string[],
  context: ConversationContext,
  minScore: number = 60
): ValidatedOption[] {
  const validatedOptions = options.map(option => ({
    text: option,
    validation: validateOptionRelevance(option, context),
  }));

  const passedOptions = validatedOptions.filter(vo => vo.validation.combinedScore >= minScore);

  console.log(`📊 Option Validation Results:
    Total options: ${options.length}
    Passed: ${passedOptions.length}
    Failed: ${validatedOptions.length - passedOptions.length}
  `);

  validatedOptions.forEach((vo, idx) => {
    console.log(`
      Option ${idx + 1}: "${vo.text}"
      - Perspective: ${(vo.validation.perspectiveScore * 100).toFixed(0)}%
      - History: ${(vo.validation.historyRelevanceScore * 100).toFixed(0)}%
      - Summary: ${(vo.validation.summaryAlignmentScore * 100).toFixed(0)}%
      - Latest Msg: ${(vo.validation.latestMessageScore * 100).toFixed(0)}%
      - Combined: ${vo.validation.combinedScore.toFixed(0)}%
      - Status: ${vo.validation.passed ? '✅ PASS' : `❌ FAIL (${vo.validation.reason})`}
    `);
  });

  return passedOptions.length >= 2 ? passedOptions : validatedOptions.slice(0, 3);
}
