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
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  evidence_found?: boolean;
  active_sources_consulted?: string[];
  timestamp: string;
}

export interface HighlightTarget {
  source_id: string;
  start_char: number;
  end_char: number;
  quote_snippet: string;
}
