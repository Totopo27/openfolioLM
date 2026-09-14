export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  doc_count: number;
  message_count: number;
}

export interface SourceDocument {
  id: string;
  filename: string;
  mime_type: string;
  raw_markdown: string;
  char_count: number;
  created_at: string;
  metadata?: Record<string, any>;
}

export interface Citation {
  index: number;
  chunk_id: string;
  source_id: string;
  source_filename: string;
  heading_path: string[];
  start_char: number;
  end_char: number;
  quote_snippet: string;
}

export interface GroundedResponse {
  answer: string;
  citations: Citation[];
  active_sources_consulted: string[];
  evidence_found: boolean;
  factual_score?: number;
  hallucination_risk?: 'low' | 'medium' | 'high';
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  evidence_found?: boolean;
  active_sources_consulted?: string[];
  factual_score?: number;
  hallucination_risk?: 'low' | 'medium' | 'high';
  timestamp: string;
}

export interface HighlightTarget {
  source_id: string;
  start_char: number;
  end_char: number;
  quote_snippet: string;
}

export interface ModelEngine {
  id: string;
  provider: 'gemini' | 'ollama' | string;
  model: string;
  name: string;
  is_available: boolean;
}

export type DocumentTypeEnum =
  | 'research_paper'
  | 'policy_plan'
  | 'technical_report'
  | 'legal_regulatory'
  | 'general';

export interface AreaAnalysis {
  area: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
}

export interface FODAMatrix {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

export interface DocumentDossier {
  source_id: string;
  title: string;
  doc_type: DocumentTypeEnum;
  executive_summary: string;
  authors_or_entities: string[];
  key_claims: string[];
  methodology_or_approach?: string | null;
  multidimensional_analysis: AreaAnalysis[];
  foda: FODAMatrix;
  limitations: string[];
  verdict: string;
  confidence_score: number;
  created_at: string;
}

