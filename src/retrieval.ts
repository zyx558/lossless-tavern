import type { SearchResult, DescribeResult, ExpandResult, SummaryNode } from './types';
import { searchMessages, searchSummaries, getSummaryById, getMessages } from './storage';
import { getSummaryTree, getChildrenOfSummary } from './dag';
import { estimateTokens } from './tokenizer';

export function grep(
  conversationId: string,
  query: string,
  options?: {
    scope?: 'messages' | 'summaries' | 'both';
    limit?: number;
  }
): SearchResult[] {
  const scope = options?.scope ?? 'both';
  const limit = options?.limit ?? 20;
  const results: SearchResult[] = [];

  if (scope === 'messages' || scope === 'both') {
    results.push(...searchMessages(conversationId, query, limit));
  }
  if (scope === 'summaries' || scope === 'both') {
    results.push(...searchSummaries(conversationId, query, limit));
  }

  results.sort((a, b) => a.rank - b.rank);
  return results.slice(0, limit);
}

export function describe(summaryId: string): DescribeResult | null {
  const summary = getSummaryById(summaryId);
  if (!summary) return null;

  const allSummaries = getSummaryTree([], summaryId);
  const children = getChildrenOfSummary(allSummaries, summaryId);

  const parentSummaries = summary.parentSummaryIds
    .map((id) => getSummaryById(id))
    .filter((s): s is SummaryNode => s !== null);

  const sourceMessages =
    summary.depth === 0
      ? getMessages(summary.conversationId, {
          start: summary.sourceMessageStart,
          end: summary.sourceMessageEnd,
          includeSummarized: true,
        })
      : [];

  return { summary, children, sourceMessages, parentSummaries };
}

export async function expand(
  config: any,
  summaryId: string,
  options?: {
    depth?: number;
    tokenCap?: number;
    includeMessages?: boolean;
  }
): Promise<ExpandResult | null> {
  const summary = getSummaryById(summaryId);
  if (!summary) return null;

  const maxDepth = options?.depth ?? 2;
  const tokenCap = options?.tokenCap ?? 4000;
  const includeMessages = options?.includeMessages ?? true;

  const sources: ExpandResult['sources'] = [];
  let totalTokens = 0;
  let truncated = false;

  sources.push({
    type: 'summary',
    id: summary.id,
    content: summary.content,
  });
  totalTokens += summary.tokenCount;

  if (summary.depth === 0 && includeMessages) {
    const messages = getMessages(summary.conversationId, {
      start: summary.sourceMessageStart,
      end: summary.sourceMessageEnd,
      includeSummarized: true,
    });

    for (const msg of messages) {
      if (totalTokens + msg.tokenCount > tokenCap) {
        truncated = true;
        break;
      }
      sources.push({
        type: 'message',
        id: String(msg.id),
        content: `[${msg.createdAt}] ${msg.name}: ${msg.content}`,
      });
      totalTokens += msg.tokenCount;
    }
  }

  if (maxDepth > 0) {
    for (const parentId of summary.parentSummaryIds) {
      if (totalTokens >= tokenCap) {
        truncated = true;
        break;
      }
      const parent = getSummaryById(parentId);
      if (!parent) continue;

      if (totalTokens + parent.tokenCount > tokenCap) {
        truncated = true;
        break;
      }
      sources.push({
        type: 'summary',
        id: parent.id,
        content: parent.content,
      });
      totalTokens += parent.tokenCount;
    }
  }

  const content = sources.map((s) => `[${s.type}:${s.id}]\n${s.content}`).join('\n\n---\n\n');

  return { content, sources, truncated, totalTokens };
}

export function formatGrepResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  return results
    .map((r, i) => {
      const type = r.type === 'message' ? 'MSG' : 'SUM';
      const id = r.id.slice(0, 12);
      const snippet = r.snippet.length > 150 ? r.snippet.slice(0, 150) + '...' : r.snippet;
      return `${i + 1}. [${type}:${id}] ${snippet}`;
    })
    .join('\n');
}

export function formatDescribeResult(result: DescribeResult): string {
  const { summary, children, parentSummaries, sourceMessages } = result;
  const lines: string[] = [];

  lines.push(`Summary: ${summary.id}`);
  lines.push(`Depth: ${summary.depth}`);
  lines.push(`Time: ${summary.earliestAt} ~ ${summary.latestAt}`);
  lines.push(`Tokens: ${summary.tokenCount}`);
  lines.push(`Children: ${children.length}`);
  lines.push(`Parents: ${parentSummaries.length}`);
  if (summary.depth === 0) {
    lines.push(`Source messages: ${sourceMessages.length}`);
  }
  lines.push('');
  lines.push('Content:');
  lines.push(summary.content);

  if (children.length > 0) {
    lines.push('');
    lines.push('Children:');
    for (const c of children) {
      lines.push(`  - ${c.id} (depth ${c.depth}, ${c.tokenCount} tokens)`);
    }
  }

  return lines.join('\n');
}
