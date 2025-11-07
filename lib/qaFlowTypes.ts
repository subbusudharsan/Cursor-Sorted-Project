export type AnswerType = 'text' | 'dropdown' | 'tag' | 'skip';

export interface TaggedPerson {
  name: string;
  is_user_b: boolean;
  relationship?: string;
  contact_id?: string;
}

export interface QuestionResponse {
  question: string;
  answer: string;
  answer_type: AnswerType;
  tags?: string[];
  selected_option?: string;
}

export interface GeneratedQuestion {
  question: string;
  answer_type: AnswerType;
  options?: string[];
  placeholder?: string;
}

export interface QAFlowData {
  initial_description: string;
  question_responses: QuestionResponse[];
  tagged_persons: TaggedPerson[];
  final_summary?: string;
}

export interface AnalyzeDescriptionRequest {
  description: string;
  user_id: string;
  available_contacts?: Array<{ id: string; full_name: string; category?: string }>;
}

export interface AnalyzeDescriptionResponse {
  questions: GeneratedQuestion[];
  detected_contacts?: TaggedPerson[];
  fallback_used: boolean;
}

export interface GenerateSummaryRequest {
  initial_description: string;
  question_responses: QuestionResponse[];
  tagged_persons: TaggedPerson[];
}

export interface GenerateSummaryResponse {
  summary: string;
  key_points: string[];
  context_data: {
    summary: string;
    key_points: string[];
    pronoun_map: {
      user_b?: string;
      third_party?: Record<string, string>;
    };
    relationship_context?: {
      user_b_role: string;
      category?: string;
    };
  };
}
