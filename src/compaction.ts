import type { AppConfig, StoredMessage, SummaryNode } from './types';
import { summarizeMessages } from './api-client';
import { estimateTokens } from './tokenizer';
import { createSummaryNode } from './dag';
import {
  getMessages,
  getSummaries,
  getSummariesByDepth,
  storeSummary,
  markMessagesSummarized,
} from './storage';

const LEAF_PROMPT = `You are a conversation summarizer. Summarize the following chat messages into a concise narrative summary.

Rules:
- Preserve key decisions, important facts, character actions, and plot points
- Include timestamps for temporal context
- Keep names and important details
- Be concise but comprehensive
- Target length: 800-1200 tokens
- Focus on information that would be needed to continue the conversation`;

const D1_PROMPT = `You are condensing leaf-level summaries into a higher-level summary.

Rules:
- Preserve key decisions, completed tasks, in-progress items, and blockers
- Include the time range covered
- Remove redundant information already captured in the leaf summaries
- Target length: 1500-2000 tokens`;

const D2_PROMPT = `You are condensing session-level summaries into higher-level memory.

Rules:
- Focus on trajectory, decisions that evolved, and active constraints
- Include the time range covered
- Preserve only the most important context
- Target length: 1500-2000 tokens`;

const D3_PLUS_PROMPT = `You are creating a high-level memory node that may persist for the rest of the conversation.

Rules:
- Keep only durable context: key decisions, accomplishments, and constraints
- Remove transient details
- Include the time range covered
- Target length: 1000-1500 tokens`;

const AGGRESSIVE_LEAF_PROMPT = `Summarize these messages very concisely. Keep only durable facts and current task state. Target: 400-600 tokens.`;

const AGGRESSIVE_CONDENSED_PROMPT = `Condense these summaries very concisely. Keep only the most critical information. Target: 500-800 tokens.`;

function getPromptForDepth(depth: number, aggressive: boolean): string {
  if (depth === 0) return aggressive ? AGGRESSIVE_LEAF_PROMPT : LEAF_PROMPT;
  if (depth === 1) return aggressive ? AGGRESSIVE_CONDENSED_PROMPT : D1_PROMPT;
  if (depth === 2) return aggressive ? AGGRESSIVE_CONDENSED_PROMPT : D2_PROMPT;
  return aggressive ? AGGRESSIVE_CONDENSED_PROMPT : D3_PLUS_PROMPT;
}

function getTargetTokens(config: AppConfig, depth: number): number {
  if (depth === 0) return config.compaction.leafTargetTokens;
  return config.compaction.condensedTargetTokens;
}

export async function compactLeaf(
  config: AppConfig,
  conversationId: string
): Promise<boolean> {
  const { freshTailCount, leafMinFanout, leafChunkTokens } = config.compaction;

  const messages = getMessages(conversationId, { includeSummarized: false });
  if (messages.length < freshTailCount + leafMinFanout) return false;

  const evictable = messages.slice(0, messages.length - freshTailCount);
  if (evictable.length < leafMinFanout) return false;

  let chunk: StoredMessage[] = [];
  let totalTokens = 0;
  for (const msg of evictable) {
    if (totalTokens + msg.tokenCount > leafChunkTokens && chunk.length >= leafMinFanout) break;
    chunk.push(msg);
    totalTokens += msg.tokenCount;
  }

  if (chunk.length < leafMinFanout) return false;

  const existingSummaries = getSummaries(conversationId, 0);
  const previousSummary = existingSummaries.length > 0
    ? existingSummaries[existingSummaries.length - 1].content
    : undefined;

  const summaryMessages = chunk.map((m) => ({
    role: m.role,
    name: m.name,
    content: m.content,
    timestamp: m.createdAt,
  }));

  let content = '';
  try {
    content = await summarizeMessages(config, summaryMessages, LEAF_PROMPT, previousSummary);
  } catch {
    try {
      content = await summarizeMessages(config, summaryMessages, AGGRESSIVE_LEAF_PROMPT, previousSummary);
    } catch {
      content = chunk.map((m) => `${m.name}: ${m.content}`).join('\n').slice(0, 2000);
      content = `[Truncated for context management]\n${content}`;
    }
  }

  if (estimateTokens(content) > getTargetTokens(config, 0) * 1.5) {
    try {
      content = await summarizeMessages(
        config,
        [{ role: 'system', name: 'System', content, timestamp: new Date().toISOString() }],
        AGGRESSIVE_LEAF_PROMPT
      );
    } catch { }
  }

  const summary = createSummaryNode(
    conversationId,
    0,
    content,
    chunk[0].createdAt,
    chunk[chunk.length - 1].createdAt,
    chunk[0].messageIndex,
    chunk[chunk.length - 1].messageIndex
  );

  storeSummary(summary);
  markMessagesSummarized(conversationId, chunk[0].messageIndex, chunk[chunk.length - 1].messageIndex);

  return true;
}

export async function compactCondensed(
  config: AppConfig,
  conversationId: string,
  targetDepth: number
): Promise<boolean> {
  const { condensedMinFanout, maxDepth } = config.compaction;
  if (targetDepth > maxDepth) return false;

  const sourceSummaries = getSummariesByDepth(conversationId, targetDepth);
  if (sourceSummaries.length < condensedMinFanout) return false;

  const chunk = sourceSummaries.slice(0, condensedMinFanout);

  const content = chunk.map((s) => {
    const timeHeader = `[${s.earliestAt} to ${s.latestAt}]`;
    return `${timeHeader}\n${s.content}`;
  }).join('\n\n---\n\n');

  const prompt = getPromptForDepth(targetDepth + 1, false);

  let summarized = '';
  try {
    summarized = await summarizeMessages(
      config,
      [{ role: 'user', name: 'Summaries', content, timestamp: new Date().toISOString() }],
      prompt
    );
  } catch {
    try {
      const aggressivePrompt = getPromptForDepth(targetDepth + 1, true);
      summarized = await summarizeMessages(
        config,
        [{ role: 'user', name: 'Summaries', content, timestamp: new Date().toISOString() }],
        aggressivePrompt
      );
    } catch {
      summarized = content.slice(0, 2000);
      summarized = `[Truncated for context management]\n${summarized}`;
    }
  }

  const parentIds = chunk.map((s) => s.id);
  const earliest = chunk[0].earliestAt;
  const latest = chunk[chunk.length - 1].latestAt;

  const summary = createSummaryNode(
    conversationId,
    targetDepth + 1,
    summarized,
    earliest,
    latest,
    chunk[0].sourceMessageStart,
    chunk[chunk.length - 1].sourceMessageEnd,
    parentIds
  );

  storeSummary(summary);
  return true;
}

export async function runCompaction(
  config: AppConfig,
  conversationId: string
): Promise<{ leafCompacted: boolean; condensedCompacted: boolean }> {
  let leafCompacted = false;
  let condensedCompacted = false;

  leafCompacted = await compactLeaf(config, conversationId);

  for (let depth = 0; depth < config.compaction.maxDepth; depth++) {
    const result = await compactCondensed(config, conversationId, depth);
    if (result) condensedCompacted = true;
    else break;
  }

  return { leafCompacted, condensedCompacted };
}
