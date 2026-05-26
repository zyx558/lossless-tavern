import type { AppConfig, LLMConfig, CompactionConfig } from './types';

const STORAGE_KEY = 'lossless_tavern_config';

const DEFAULT_LLM: LLMConfig = {
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.2,
  maxTokens: 2000,
  timeout: 60000,
};

const DEFAULT_COMPACTION: CompactionConfig = {
  contextThreshold: 0.75,
  freshTailCount: 64,
  leafChunkTokens: 20000,
  leafTargetTokens: 1200,
  condensedTargetTokens: 2000,
  leafMinFanout: 8,
  condensedMinFanout: 4,
  maxDepth: 3,
  summaryModel: '',
};

const DEFAULT_CONFIG: AppConfig = {
  enabled: true,
  llm: DEFAULT_LLM,
  compaction: DEFAULT_COMPACTION,
  dbSaveDebounce: 1000,
  autoInject: true,
};

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      llm: { ...DEFAULT_LLM, ...parsed.llm },
      compaction: { ...DEFAULT_COMPACTION, ...parsed.compaction },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function updateConfig(partial: Partial<AppConfig>): AppConfig {
  const config = loadConfig();
  const merged = {
    ...config,
    ...partial,
    llm: { ...config.llm, ...partial.llm },
    compaction: { ...config.compaction, ...partial.compaction },
  };
  saveConfig(merged);
  return merged;
}

export function getSummaryModel(config: AppConfig): string {
  return config.compaction.summaryModel || config.llm.model;
}
