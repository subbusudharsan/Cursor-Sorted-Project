import { supabase } from './supabase';

export interface Entity {
  id: string;
  chat_id: string;
  entity_name: string;
  entity_type: 'conversation_participant' | 'third_party_person' | 'group' | 'object' | 'event';
  role_in_conversation: string;
  preferred_pronouns: string;
  user_id?: string;
  relationship_to_user_a?: string;
  metadata?: any;
}

export interface Action {
  id: string;
  chat_id: string;
  subject_entity_id: string;
  action_verb: string;
  object_entity_id?: string;
  action_context?: string;
  timestamp_occurred?: string;
}

export interface PronounResolution {
  id: string;
  chat_id: string;
  pronoun_used: string;
  resolved_entity_id: string;
  context_message: string;
  confidence_score: number;
}

export interface StructuredContextAnswer {
  id: string;
  chat_id: string;
  question_key: string;
  question_text: string;
  answer_type: 'text' | 'entity_selection' | 'date' | 'multiple_choice' | 'action_description';
  answer_value: any;
  answered_by: string;
}

export async function createEntity(
  chatId: string,
  name: string,
  type: Entity['entity_type'],
  role: string,
  pronouns: string = 'they/them',
  userId?: string,
  relationship?: string,
  metadata?: any
): Promise<Entity | null> {
  try {
    const { data, error } = await supabase
      .from('entity_registry')
      .insert({
        chat_id: chatId,
        entity_name: name,
        entity_type: type,
        role_in_conversation: role,
        preferred_pronouns: pronouns,
        user_id: userId,
        relationship_to_user_a: relationship,
        metadata: metadata || {}
      })
      .select()
      .single();

    if (error) throw error;
    return data as Entity;
  } catch (error) {
    console.error('Failed to create entity:', error);
    return null;
  }
}

export async function getEntitiesForChat(chatId: string): Promise<Entity[]> {
  try {
    const { data, error } = await supabase
      .from('entity_registry')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []) as Entity[];
  } catch (error) {
    console.error('Failed to fetch entities:', error);
    return [];
  }
}

export async function logAction(
  chatId: string,
  subjectEntityId: string,
  actionVerb: string,
  objectEntityId?: string,
  context?: string,
  timestampOccurred?: string
): Promise<Action | null> {
  try {
    const { data, error } = await supabase
      .from('action_log')
      .insert({
        chat_id: chatId,
        subject_entity_id: subjectEntityId,
        action_verb: actionVerb,
        object_entity_id: objectEntityId,
        action_context: context,
        timestamp_occurred: timestampOccurred || new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return data as Action;
  } catch (error) {
    console.error('Failed to log action:', error);
    return null;
  }
}

export async function getActionsForChat(chatId: string): Promise<Action[]> {
  try {
    const { data, error } = await supabase
      .from('action_log')
      .select('*')
      .eq('chat_id', chatId)
      .order('timestamp_occurred', { ascending: false });

    if (error) throw error;
    return (data || []) as Action[];
  } catch (error) {
    console.error('Failed to fetch actions:', error);
    return [];
  }
}

export async function resolvePronoun(
  text: string,
  chatId: string,
  contextMessage?: string
): Promise<{ entityId: string; entityName: string; confidence: number } | null> {
  const entities = await getEntitiesForChat(chatId);

  if (entities.length === 0) {
    return null;
  }

  const pronouns = extractPronouns(text.toLowerCase());

  if (pronouns.length === 0) {
    return null;
  }

  const pronoun = pronouns[0];

  for (const entity of entities) {
    if (entity.preferred_pronouns.toLowerCase().includes(pronoun)) {
      await supabase.from('pronoun_resolutions').insert({
        chat_id: chatId,
        pronoun_used: pronoun,
        resolved_entity_id: entity.id,
        context_message: contextMessage || text,
        confidence_score: 0.8
      });

      return {
        entityId: entity.id,
        entityName: entity.entity_name,
        confidence: 0.8
      };
    }
  }

  return null;
}

function extractPronouns(text: string): string[] {
  const pronounList = [
    'he', 'him', 'his',
    'she', 'her', 'hers',
    'they', 'them', 'their', 'theirs',
    'you', 'your', 'yours',
    'it', 'its'
  ];

  const words = text.split(/\s+/);
  return words.filter(word => pronounList.includes(word.toLowerCase()));
}

export async function saveStructuredContext(
  chatId: string,
  questionKey: string,
  questionText: string,
  answerType: StructuredContextAnswer['answer_type'],
  answerValue: any,
  answeredBy: string
): Promise<StructuredContextAnswer | null> {
  try {
    const { data, error } = await supabase
      .from('structured_context_data')
      .insert({
        chat_id: chatId,
        question_key: questionKey,
        question_text: questionText,
        answer_type: answerType,
        answer_value: answerValue,
        answered_by: answeredBy
      })
      .select()
      .single();

    if (error) throw error;
    return data as StructuredContextAnswer;
  } catch (error) {
    console.error('Failed to save structured context:', error);
    return null;
  }
}

export async function getStructuredContext(chatId: string): Promise<StructuredContextAnswer[]> {
  try {
    const { data, error } = await supabase
      .from('structured_context_data')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []) as StructuredContextAnswer[];
  } catch (error) {
    console.error('Failed to fetch structured context:', error);
    return [];
  }
}

export function buildEntityContext(entities: Entity[], actions: Action[]): string {
  if (entities.length === 0) {
    return '';
  }

  let context = '\n\n📋 ENTITY REGISTRY (Clear pronoun mappings):\n';

  entities.forEach((entity, index) => {
    context += `\n${index + 1}. ${entity.entity_name}:`;
    context += `\n   - Type: ${entity.entity_type}`;
    context += `\n   - Role: ${entity.role_in_conversation}`;
    context += `\n   - Pronouns: ${entity.preferred_pronouns}`;
    if (entity.relationship_to_user_a) {
      context += `\n   - Relationship to User A: ${entity.relationship_to_user_a}`;
    }
  });

  if (actions.length > 0) {
    context += '\n\n📝 ACTION LOG (Who did what to whom):\n';

    const recentActions = actions.slice(0, 10);
    recentActions.forEach((action, index) => {
      const subject = entities.find(e => e.id === action.subject_entity_id);
      const object = action.object_entity_id
        ? entities.find(e => e.id === action.object_entity_id)
        : null;

      context += `\n${index + 1}. ${subject?.entity_name || 'Unknown'} ${action.action_verb}`;
      if (object) {
        context += ` ${object.entity_name}`;
      }
      if (action.action_context) {
        context += ` (${action.action_context})`;
      }
    });
  }

  context += '\n\n⚠️ PRONOUN USAGE RULES:';
  context += '\n- Use entity names when possible for clarity';
  context += '\n- When using pronouns, ensure they match the entity registry';
  context += '\n- "you" = the person receiving the message';
  context += '\n- Use registered pronouns for all third parties';

  return context;
}

export function validatePronounUsage(
  text: string,
  entities: Entity[]
): { valid: boolean; issues: string[] } {
  const pronouns = extractPronouns(text.toLowerCase());
  const issues: string[] = [];

  for (const pronoun of pronouns) {
    if (pronoun === 'you' || pronoun === 'your' || pronoun === 'yours') {
      continue;
    }

    const matchingEntities = entities.filter(e =>
      e.preferred_pronouns.toLowerCase().includes(pronoun)
    );

    if (matchingEntities.length === 0) {
      issues.push(`Pronoun "${pronoun}" used but no matching entity found in registry`);
    } else if (matchingEntities.length > 1) {
      issues.push(`Pronoun "${pronoun}" is ambiguous - could refer to: ${matchingEntities.map(e => e.entity_name).join(', ')}`);
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

export function normalizePronounReferences(
  text: string,
  currentUserName: string,
  targetEntityName: string
): string {
  // Replace current user's name with "you"
  const youPattern = new RegExp(`\\b${currentUserName}\\b`, "gi");
  text = text.replace(youPattern, "you");

  // Replace target entity name (e.g., Sara) if needed
  if (targetEntityName && targetEntityName.toLowerCase() !== currentUserName.toLowerCase()) {
    const thirdPartyPattern = new RegExp(`\\b${targetEntityName}\\b`, "gi");
    text = text.replace(thirdPartyPattern, targetEntityName); // keep actual name for third person
  }

  // Small cleanup: capitalize first letter
  return text.charAt(0).toUpperCase() + text.slice(1);
}
