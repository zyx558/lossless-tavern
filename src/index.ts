import { loadConfig } from './config';
import { initStorage, isStorageReady, getOrCreateConversation, storeMessage, getMessages, getMessageCount, getMessageTokenTotal, getSummaryCount, getSummaryTokenTotal } from './storage';
import { runCompaction } from './compaction';
import { assembleContext, buildInjectionPrompts, shouldCompact } from './assembler';
import { createUI } from './ui';
import { estimateTokens } from './tokenizer';
import type { ChatMessage } from './types';

const CONTEXT_WINDOW = 128000;
let currentConversationId: string | null = null;
let isCompacting = false;
let injectionHandle: { uninject: () => void } | null = null;

function getTH(): any {
  return window.TavernHelper;
}

function getCharName(): string {
  try {
    return getTH()?.getCurrentCharacterName?.() ?? 'Unknown';
  } catch {
    return 'Unknown';
  }
}

function getChatName(): string {
  try {
    return 'current';
  } catch {
    return 'current';
  }
}

async function syncConversation(): Promise<void> {
  if (!isStorageReady()) return;
  const charName = getCharName();
  const chatName = getChatName();
  const conv = getOrCreateConversation(chatName, charName);
  currentConversationId = conv.id;
}

async function syncMessages(): Promise<void> {
  if (!isStorageReady() || !currentConversationId) return;
  const th = getTH();
  if (!th) return;

  const lastId = th.getLastMessageId();
  if (lastId < 0) return;

  const existingCount = getMessageCount(currentConversationId);
  const startIdx = existingCount;

  if (startIdx <= lastId) {
    const messages: ChatMessage[] = th.getChatMessages(`${startIdx}-${lastId}`);
    for (const msg of messages) {
      storeMessage(
        currentConversationId,
        msg.message_id,
        msg.role,
        msg.name,
        msg.message
      );
    }
  }
}

async function injectSummaries(): Promise<void> {
  if (!isStorageReady() || !currentConversationId) return;
  const config = loadConfig();
  if (!config.autoInject) return;

  if (injectionHandle) {
    injectionHandle.uninject();
    injectionHandle = null;
  }

  const { summaries } = assembleContext(config, currentConversationId, CONTEXT_WINDOW);
  if (summaries.length === 0) return;

  const prompts = buildInjectionPrompts(summaries, currentConversationId);
  if (prompts.length === 0) return;

  injectionHandle = getTH()?.injectPrompts?.(prompts, { once: false }) ?? null;
}

async function checkAndCompact(): Promise<void> {
  if (!isStorageReady() || !currentConversationId || isCompacting) return;
  const config = loadConfig();
  if (!config.enabled) return;
  if (!config.llm.apiKey) return;

  const msgTokens = getMessageTokenTotal(currentConversationId);
  const sumTokens = getSummaryTokenTotal(currentConversationId);
  const totalTokens = msgTokens + sumTokens;

  if (!shouldCompact(config, totalTokens, CONTEXT_WINDOW)) return;

  isCompacting = true;
  try {
    const result = await runCompaction(config, currentConversationId);
    if (result.leafCompacted || result.condensedCompacted) {
      await injectSummaries();
      window.toastr?.success?.('Context compacted successfully.', 'Lossless Tavern');
    }
  } catch (e: any) {
    console.error('[LosslessTavern] Compaction error:', e);
    window.toastr?.error?.(`Compaction failed: ${e.message}`, 'Lossless Tavern');
  } finally {
    isCompacting = false;
  }
}

function registerEvents(): void {
  const th = getTH();
  if (!th) {
    console.warn('[LosslessTavern] TavernHelper not available');
    return;
  }

  th.eventOn('tavern_events.MESSAGE_SENT', async () => {
    await syncMessages();
    await injectSummaries();
    await checkAndCompact();
  });

  th.eventOn('tavern_events.MESSAGE_RECEIVED', async () => {
    await syncMessages();
    await injectSummaries();
    await checkAndCompact();
  });

  th.eventOn('tavern_events.CHAT_LOADED', async () => {
    await syncConversation();
    await syncMessages();
    await injectSummaries();
  });

  th.eventOn('tavern_events.CHAT_CREATED', async () => {
    await syncConversation();
  });

  th.eventOn('tavern_events.MESSAGE_DELETED', async () => {
    await syncMessages();
    await injectSummaries();
  });

  th.eventOn('tavern_events.MESSAGE_EDITED', async () => {
    await syncMessages();
    await injectSummaries();
  });

  console.log('[LosslessTavern] Events registered');
}

async function manualCompact(): Promise<void> {
  if (!isStorageReady() || !currentConversationId) {
    window.toastr?.warning?.('No active conversation.', 'Lossless Tavern');
    return;
  }
  const config = loadConfig();
  if (!config.llm.apiKey) {
    window.toastr?.warning?.('Please configure API key first.', 'Lossless Tavern');
    return;
  }

  isCompacting = true;
  try {
    window.toastr?.info?.('Running compaction...', 'Lossless Tavern');
    const result = await runCompaction(config, currentConversationId);
    await injectSummaries();

    if (result.leafCompacted || result.condensedCompacted) {
      const msgCount = getMessageCount(currentConversationId);
      const sumCount = getSummaryCount(currentConversationId);
      window.toastr?.success?.(
        `Compacted! Messages: ${msgCount}, Summaries: ${sumCount}`,
        'Lossless Tavern'
      );
    } else {
      window.toastr?.info?.('Nothing to compact.', 'Lossless Tavern');
    }
  } catch (e: any) {
    window.toastr?.error?.(`Compaction failed: ${e.message}`, 'Lossless Tavern');
  } finally {
    isCompacting = false;
  }
}

async function main(): Promise<void> {
  console.log('[LosslessTavern] Initializing...');

  const config = loadConfig();

  try {
    await initStorage(config.dbSaveDebounce);
    console.log('[LosslessTavern] Storage initialized');
  } catch (e) {
    console.error('[LosslessTavern] Storage init failed:', e);
    return;
  }

  await syncConversation();
  await syncMessages();

  registerEvents();

  createUI();

  (window as any).losslessTavern = {
    compact: manualCompact,
    status: () => {
      if (!currentConversationId) return 'No conversation';
      return {
        conversationId: currentConversationId,
        messageCount: getMessageCount(currentConversationId),
        messageTokens: getMessageTokenTotal(currentConversationId),
        summaryCount: getSummaryCount(currentConversationId),
        summaryTokens: getSummaryTokenTotal(currentConversationId),
      };
    },
  };

  await injectSummaries();

  console.log('[LosslessTavern] Ready');
}

$(() => {
  main().catch((e) => {
    console.error('[LosslessTavern] Init error:', e);
  });
});
