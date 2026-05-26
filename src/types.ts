export interface LLMConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeout: number;
}

export interface CompactionConfig {
  contextThreshold: number;
  freshTailCount: number;
  leafChunkTokens: number;
  leafTargetTokens: number;
  condensedTargetTokens: number;
  leafMinFanout: number;
  condensedMinFanout: number;
  maxDepth: number;
  summaryModel: string;
}

export interface AppConfig {
  enabled: boolean;
  llm: LLMConfig;
  compaction: CompactionConfig;
  dbSaveDebounce: number;
  autoInject: boolean;
}

export interface Conversation {
  id: string;
  chatName: string;
  charName: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: number;
  conversationId: string;
  messageIndex: number;
  role: string;
  name: string;
  content: string;
  createdAt: string;
  tokenCount: number;
  isSummarized: number;
}

export interface SummaryNode {
  id: string;
  conversationId: string;
  depth: number;
  content: string;
  earliestAt: string;
  latestAt: string;
  tokenCount: number;
  sourceMessageStart: number;
  sourceMessageEnd: number;
  parentSummaryIds: string[];
  createdAt: string;
}

export interface ContextItem {
  id: number;
  conversationId: string;
  ordinal: number;
  itemType: 'message' | 'summary';
  itemId: string;
}

export interface SearchResult {
  type: 'message' | 'summary';
  id: string;
  content: string;
  snippet: string;
  rank: number;
}

export interface DescribeResult {
  summary: SummaryNode;
  children: SummaryNode[];
  sourceMessages: StoredMessage[];
  parentSummaries: SummaryNode[];
}

export interface ExpandResult {
  content: string;
  sources: Array<{
    type: 'message' | 'summary';
    id: string;
    content: string;
  }>;
  truncated: boolean;
  totalTokens: number;
}

export interface ChatMessage {
  message_id: number;
  name: string;
  role: 'system' | 'assistant' | 'user';
  is_hidden: boolean;
  message: string;
  data: Record<string, any>;
  extra: Record<string, any>;
  swipe_id: number;
  swipes: string[];
  swipes_data: Record<string, any>[];
}

export interface InjectPrompt {
  id: string;
  position: 'in_chat' | 'none';
  depth: number;
  role: 'system' | 'assistant' | 'user';
  content: string;
}

export interface APIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface APIRequest {
  model: string;
  messages: APIChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface APIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

declare global {
  interface Window {
    initSqlJs: (config?: any) => Promise<any>;
    TavernHelper: any;
    $: any;
    toastr: any;
  }
  const $: any;
}
