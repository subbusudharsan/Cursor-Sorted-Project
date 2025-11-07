/**
 * Tag Parser Utility
 *
 * Handles parsing and management of @ (registered contacts) and # (unregistered entities) tags
 */

export interface TaggedEntity {
  type: 'registered' | 'unregistered';
  tag: string; // e.g., '@John' or '#Sarah'
  entity_name: string; // Display name without prefix
  entity_type?: 'registered_contact' | 'third_party_person' | 'group' | 'object' | 'event' | 'conversation_participant';
  role_in_conversation?: string; // e.g., 'User B', 'mentioned', 'subject'
  is_registered?: boolean; // true for @ tags, false for # tags
  is_participant?: boolean; // true if part of conversation
  participant_slot?: 'A' | 'B'; // 'A' = current user, 'B' = chat contact
  preferred_pronouns?: string; // Preferred pronouns: 'they/them', 'he/him', 'she/her', 'you/your/yours', 'it/its', or null
  tag_symbol?: '@' | '#';
  user_id?: string; // For registered contacts
  contactId?: string; // Only for registered contacts (deprecated, use user_id)
  name?: string; // Deprecated, use entity_name
  role?: 'recipient' | 'subject'; // Deprecated, use role_in_conversation
  category?: string; // Category hint: 'person', 'group', 'organization'
}

/**
 * Extract all @ and # tags from text
 */
export function extractTags(text: string): { atTags: string[]; hashTags: string[] } {
  const atMatches = text.match(/@(\w+)/g) || [];
  const hashMatches = text.match(/#(\w+)/g) || [];

  return {
    atTags: atMatches.map(t => t.substring(1)), // Remove @ prefix
    hashTags: hashMatches.map(t => t.substring(1)), // Remove # prefix
  };
}

/**
 * Get the last tag being typed (for autocomplete)
 * Detects @ or # anywhere in text and closes on space or punctuation
 */
export function getLastTypingTag(text: string, cursorPosition?: number): { type: '@' | '#' | null; search: string; startPos: number } {
  // Use text length if cursor position is beyond text length or not provided
  const pos = cursorPosition !== undefined && cursorPosition <= text.length ? cursorPosition : text.length;
  const beforeCursor = text.substring(0, pos);

  // Find last @ or # before cursor (prioritize most recent)
  const lastAt = beforeCursor.lastIndexOf('@');
  const lastHash = beforeCursor.lastIndexOf('#');

  const lastTagPos = Math.max(lastAt, lastHash);

  if (lastTagPos === -1) {
    return { type: null, search: '', startPos: -1 };
  }

  const tagType = beforeCursor[lastTagPos] as '@' | '#';
  const afterTag = beforeCursor.substring(lastTagPos + 1);

  // Check if there's a space or punctuation immediately after the tag (dropdown should close)
  // For both @ and # tags, keep dropdown open while typing, only close on space/punctuation
  if (afterTag.length > 0) {
    const punctuationRegex = /[\s\n.,!?;:]/;
    const firstChar = afterTag[0];
    if (punctuationRegex.test(firstChar)) {
      return { type: null, search: '', startPos: -1 };
    }
    // If no space/punctuation, keep tag active (user is still typing)
  }

  // Extract the search term (text after @ or # until space/punctuation/end)
  // This will be empty string if cursor is right after # or @
  const searchMatch = afterTag.match(/^(\w*)/);
  const search = searchMatch ? searchMatch[1] : '';

  return {
    type: tagType,
    search: search,
    startPos: lastTagPos,
  };
}

/**
 * Replace the tag being typed with a completed tag
 * Handles tags at any position and preserves surrounding text
 */
export function replaceTypingTag(
  text: string,
  startPos: number,
  tagType: '@' | '#',
  replacement: string
): string {
  const beforeTag = text.substring(0, startPos);
  const afterTag = text.substring(startPos);

  // Find where the tag text ends (space, punctuation, or end of string)
  const endMatch = afterTag.match(/^[@#]\w*/);
  const tagLength = endMatch ? endMatch[0].length : 1;
  const afterTagText = afterTag.substring(tagLength);

  // Check if there's already punctuation or space right after the tag
  const hasImmediatePunctuation = /^[\s.,!?;:]/.test(afterTagText);

  // Add space only if there's no immediate punctuation or space
  const spacing = hasImmediatePunctuation ? '' : ' ';

  return `${beforeTag}${tagType}${replacement}${spacing}${afterTagText}`;
}

/**
 * Parse text and return structured tagged entities
 */
export function parseTaggedEntities(
  text: string,
  registeredContacts: { id: string; name: string }[]
): TaggedEntity[] {
  const { atTags, hashTags } = extractTags(text);
  const entities: TaggedEntity[] = [];

  // Process @ tags (registered contacts)
  atTags.forEach(tag => {
    const contact = registeredContacts.find(
      c => c.name.toLowerCase().includes(tag.toLowerCase())
    );

    if (contact) {
      entities.push({
        type: 'registered',
        tag: `@${tag}`,
        name: contact.name,
        contactId: contact.id,
        role: 'recipient', // @ tags are people you're talking TO
      });
    }
  });

  // Process # tags (unregistered entities)
  hashTags.forEach(tag => {
    const { pronouns, category } = inferPronounsFromTag(tag);
    entities.push({
      type: 'unregistered',
      tag: `#${tag}`,
      name: tag,
      role: 'subject', // # tags are people/things you're talking ABOUT
      pronouns,
      category,
    });
  });

  return entities;
}

/**
 * Get common # tag suggestions
 */
export function getCommonHashTags(): string[] {
  return [
    'coworkers',
    'family',
    'friends',
    'boss',
    'team',
    'neighbor',
    'others',
  ];
}

/**
 * Infer pronouns and category from tag name
 */
export function inferPronounsFromTag(tagName: string): { pronouns: string; category: string } {
  const lowerTag = tagName.toLowerCase();

  // Group tags - plural forms suggest they/them
  const groupIndicators = ['coworkers', 'friends', 'family', 'team', 'members', 'group', 'people'];
  if (groupIndicators.some(ind => lowerTag.includes(ind))) {
    return { pronouns: 'they/them', category: 'group' };
  }

  // Organization/company tags
  const orgIndicators = ['company', 'organization', 'business', 'corp'];
  if (orgIndicators.some(ind => lowerTag.includes(ind))) {
    return { pronouns: 'they/them', category: 'organization' };
  }

  // Single person indicators - default to they/them for unknown gender
  const personIndicators = ['boss', 'neighbor', 'manager', 'friend', 'colleague', 'coworker'];
  if (personIndicators.some(ind => lowerTag.includes(ind))) {
    return { pronouns: 'they/them', category: 'person' };
  }

  // Default: assume person with neutral pronouns
  return { pronouns: 'they/them', category: 'person' };
}

/**
 * Format tags for display
 */
export function formatTagsForDisplay(entities: TaggedEntity[]): string {
  if (entities.length === 0) return '';

  const registered = entities.filter(e => e.type === 'registered');
  const unregistered = entities.filter(e => e.type === 'unregistered');

  const parts: string[] = [];

  if (registered.length > 0) {
    parts.push(`Talking with: ${registered.map(e => e.tag).join(', ')}`);
  }

  if (unregistered.length > 0) {
    parts.push(`Discussing: ${unregistered.map(e => e.tag).join(', ')}`);
  }

  return parts.join(' | ');
}
