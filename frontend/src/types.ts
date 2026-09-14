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

export interface AcademicPaper {
  doi: string;
  title: string;
  authors: string[];
  abstract?: string | null;
  publication_year?: number | null;
  venue?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publisher?: string | null;
  is_open_access: boolean;
  pdf_url?: string | null;
  landing_page_url?: string | null;
  citations_count?: number | null;
  source_database: string;
  bibtex?: string | null;
}

export interface ProjectNote {
  id: string;
  project_id: string;
  title: string;
  content: string;
  source_citation_ids: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
}

export type GraphRole = 'foundation' | 'frontier' | 'bridge' | 'corpus';
export type EdgeType = 'citation' | 'semantic_similarity' | 'co_authorship';

export interface GraphNode {
  id: string;
  title: string;
  label: string;
  authors: string[];
  year?: number | null;
  citations_count: number;
  role: GraphRole;
  doc_type: string;
  in_corpus: boolean;
  cluster_id: number;
  centrality: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
  label?: string | null;
}

export interface GraphMetrics {
  node_count: number;
  edge_count: number;
  foundational_papers: string[];
  frontier_papers: string[];
  bridge_papers: string[];
  density: number;
}

export interface NetworkGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metrics: GraphMetrics;
}

// ================= Timeline & Evolutionary Chronology =================

export interface LineageLink {
  source_id: string;
  title: string;
  year?: number | null;
}

export interface TimelineEvent {
  id: string;
  source_id: string;
  title: string;
  year: number;
  authors: string[];
  headline: string;
  summary: string;
  methodology?: string | null;
  limitations: string[];
  role: GraphRole;
  citations_count: number;
  built_upon_sources: LineageLink[];
}

export interface TimelineEra {
  year: number;
  era_name: string;
  events: TimelineEvent[];
}

export interface ProjectTimeline {
  project_id: string;
  total_events: number;
  year_span: [number, number];
  eras: TimelineEra[];
  narrative_arc?: string | null;
}

