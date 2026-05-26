import type { AppConfig, SummaryNode, StoredMessage, InjectPrompt } from './types';
import { estimateTokens } from './tokenizer';
import { getSummaries, getMessages } from './storage';

const SUMMARY_XML_TEMPLATE = (s: SummaryNode) =>
  `<summary id="${s.id}" depth="${s.depth}" earliest_at="${s.earliestAt}" latest_at="${s.latestAt}">\n${s.content}\n</summary>`;

export function assembleContext(
  config: AppConfig,
  conversationId: string,
  contextWindowTokens: number
): { summaries: SummaryNode[]; recentMessages: StoredMessage[]; totalTokens: number } {
  const allSummaries = getSummaries(conversationId);
  const allMessages = getMessages(conversationId, { includeSummarized: false });

  const budget = Math.floor(contextWindowTokens * config.compaction.contextThreshold);
  const freshTail = allMessages.slice(-config.compaction.freshTailCount);
  const freshTailTokens = freshTail.reduce((sum, m) => sum + m.tokenCount + 4, 0);

  const remainingBudget = budget - freshTailTokens;
  if (remainingBudget <= 0) {
    return { summaries: [], recentMessages: freshTail, totalTokens: freshTailTokens };
  }

  const sortedSummaries = [...allSummaries].sort(
    (a, b) => new Date(a.earliestAt).getTime() - new Date(b.earliestAt).getTime()
  );

  let usedTokens = 0;
  const selectedSummaries: SummaryNode[] = [];

  for (const s of sortedSummaries) {
    if (usedTokens + s.tokenCount > remainingBudget) break;
    selectedSummaries.push(s);
    usedTokens += s.tokenCount;
  }

  const totalTokens = usedTokens + freshTailTokens;
  return { summaries: selectedSummaries, recentMessages: freshTail, totalTokens };
}

export function buildInjectionPrompts(
  summaries: SummaryNode[],
  conversationId: string
): InjectPrompt[] {
  if (summaries.length === 0) return [];

  const summaryText = summaries.map(SUMMARY_XML_TEMPLATE).join('\n\n');

  return [
    {
      id: 'lossless-tavern-summary',
      position: 'in_chat',
      depth: 0,
      role: 'system',
      content: `<compressed_history>\n${summaryText}\n</compressed_history>`,
    },
  ];
}

export function shouldCompact(
  config: AppConfig,
  currentTokens: number,
  contextWindowTokens: number
): boolean {
  return currentTokens >= contextWindowTokens * config.compaction.contextThreshold;
}

export function getCompactionStatus(
  conversationId: string,
  contextWindowTokens: number
): {
  messageCount: number;
  messageTokens: number;
  summaryCount: number;
  summaryTokens: number;
  totalTokens: number;
  contextWindow: number;
} {
  const messages = getMessages(conversationId, { includeSummarized: false });
  const summaries = getSummaries(conversationId);
  const messageTokens = messages.reduce((sum, m) => sum + m.tokenCount, 0);
  const summaryTokens = summaries.reduce((sum, s) => sum + s.tokenCount, 0);

  return {
    messageCount: messages.length,
    messageTokens,
    summaryCount: summaries.length,
    summaryTokens,
    totalTokens: messageTokens + summaryTokens,
    contextWindow: contextWindowTokens,
  };
}
