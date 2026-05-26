import type { SummaryNode } from './types';
import { estimateTokens } from './tokenizer';
import { getSummaryById } from './storage';

export function generateSummaryId(): string {
  return `sum_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createSummaryNode(
  conversationId: string,
  depth: number,
  content: string,
  earliestAt: string,
  latestAt: string,
  sourceMessageStart: number,
  sourceMessageEnd: number,
  parentSummaryIds: string[] = []
): SummaryNode {
  return {
    id: generateSummaryId(),
    conversationId,
    depth,
    content,
    earliestAt,
    latestAt,
    tokenCount: estimateTokens(content),
    sourceMessageStart,
    sourceMessageEnd,
    parentSummaryIds,
    createdAt: new Date().toISOString(),
  };
}

export function getSummaryTree(
  summaries: SummaryNode[],
  rootId: string
): SummaryNode[] {
  const byId = new Map(summaries.map((s) => [s.id, s]));
  const tree: SummaryNode[] = [];
  const visited = new Set<string>();

  function walk(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id) || getSummaryById(id);
    if (!node) return;
    tree.push(node);
    for (const pid of node.parentSummaryIds) {
      walk(pid);
    }
  }

  walk(rootId);
  return tree;
}

export function getChildrenOfSummary(
  summaries: SummaryNode[],
  parentId: string
): SummaryNode[] {
  return summaries.filter((s) => s.parentSummaryIds.includes(parentId));
}

export function getRootSummaries(summaries: SummaryNode[]): SummaryNode[] {
  const childIds = new Set<string>();
  for (const s of summaries) {
    for (const pid of s.parentSummaryIds) {
      childIds.add(pid);
    }
  }
  return summaries.filter((s) => !childIds.has(s.id));
}

export function getDeepestDepth(summaries: SummaryNode[]): number {
  if (summaries.length === 0) return -1;
  return Math.max(...summaries.map((s) => s.depth));
}
