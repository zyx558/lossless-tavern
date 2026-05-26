import type { AppConfig, APIChatMessage, APIRequest, APIResponse } from './types';
import { getSummaryModel } from './config';

export async function callLLM(
  config: AppConfig,
  messages: APIChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    model?: string;
  }
): Promise<string> {
  const model = options?.model || getSummaryModel(config);
  const body: APIRequest = {
    model,
    messages,
    temperature: options?.temperature ?? config.llm.temperature,
    max_tokens: options?.maxTokens ?? config.llm.maxTokens,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llm.timeout);

  try {
    const resp = await fetch(config.llm.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`LLM API error ${resp.status}: ${text}`);
    }

    const data: APIResponse = await resp.json();
    return data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timeout);
  }
}

export async function summarizeMessages(
  config: AppConfig,
  messages: Array<{ role: string; name: string; content: string; timestamp: string }>,
  prompt: string,
  previousSummary?: string
): Promise<string> {
  const systemContent = previousSummary
    ? `${prompt}\n\nPrevious summary for context continuity:\n${previousSummary}`
    : prompt;

  const userContent = messages
    .map((m) => `[${m.timestamp}] ${m.name} (${m.role}): ${m.content}`)
    .join('\n\n');

  return callLLM(config, [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ]);
}

export async function expandSummary(
  config: AppConfig,
  summaryContent: string,
  childContents: string[],
  question: string
): Promise<string> {
  const context = [
    `Summary:\n${summaryContent}`,
    ...childContents.map((c, i) => `Sub-summary ${i + 1}:\n${c}`),
  ].join('\n\n---\n\n');

  return callLLM(
    config,
    [
      {
        role: 'system',
        content:
          'You are a helpful assistant. Given the following compressed conversation history, answer the user\'s question. Be specific and cite details from the original text.',
      },
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
    ],
    { temperature: 0.3 }
  );
}
