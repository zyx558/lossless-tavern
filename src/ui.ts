import type { AppConfig } from './types';
import { loadConfig, saveConfig, updateConfig } from './config';
import { grep, describe, expand, formatGrepResults, formatDescribeResult } from './retrieval';
import { getCompactionStatus } from './assembler';
import { getConversation, getDatabaseSize, getSummaryCount } from './storage';

const PANEL_ID = 'lossless-tavern-panel';

export function createUI(): void {
  if (document.getElementById(PANEL_ID)) return;

  const style = document.createElement('style');
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
    }
    #${PANEL_ID} .lt-btn {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #2563eb;
      color: white;
      border: none;
      cursor: pointer;
      font-size: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transition: background 0.2s;
    }
    #${PANEL_ID} .lt-btn:hover { background: #1d4ed8; }
    #${PANEL_ID} .lt-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 10001;
    }
    #${PANEL_ID} .lt-overlay.active { display: block; }
    #${PANEL_ID} .lt-modal {
      display: none;
      position: fixed;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 600px;
      max-width: 90vw;
      max-height: 80vh;
      background: #1e1e2e;
      color: #cdd6f4;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
      z-index: 10002;
      overflow: hidden;
      display: none;
    }
    #${PANEL_ID} .lt-modal.active { display: flex; flex-direction: column; }
    #${PANEL_ID} .lt-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: #181825;
      border-bottom: 1px solid #313244;
    }
    #${PANEL_ID} .lt-header h3 { margin: 0; font-size: 15px; color: #cdd6f4; }
    #${PANEL_ID} .lt-close {
      background: none; border: none; color: #6c7086; cursor: pointer;
      font-size: 20px; padding: 0 4px;
    }
    #${PANEL_ID} .lt-close:hover { color: #cdd6f4; }
    #${PANEL_ID} .lt-tabs {
      display: flex;
      border-bottom: 1px solid #313244;
      background: #181825;
    }
    #${PANEL_ID} .lt-tab {
      padding: 8px 16px;
      cursor: pointer;
      color: #6c7086;
      border: none;
      background: none;
      border-bottom: 2px solid transparent;
      font-size: 13px;
    }
    #${PANEL_ID} .lt-tab.active {
      color: #89b4fa;
      border-bottom-color: #89b4fa;
    }
    #${PANEL_ID} .lt-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    #${PANEL_ID} .lt-field {
      margin-bottom: 12px;
    }
    #${PANEL_ID} .lt-field label {
      display: block;
      margin-bottom: 4px;
      color: #a6adc8;
      font-size: 12px;
    }
    #${PANEL_ID} .lt-field input, #${PANEL_ID} .lt-field textarea {
      width: 100%;
      padding: 6px 10px;
      background: #313244;
      border: 1px solid #45475a;
      border-radius: 6px;
      color: #cdd6f4;
      font-size: 13px;
      box-sizing: border-box;
    }
    #${PANEL_ID} .lt-field input:focus, #${PANEL_ID} .lt-field textarea:focus {
      outline: none;
      border-color: #89b4fa;
    }
    #${PANEL_ID} .lt-field textarea {
      min-height: 80px;
      resize: vertical;
      font-family: monospace;
    }
    #${PANEL_ID} .lt-row {
      display: flex;
      gap: 12px;
    }
    #${PANEL_ID} .lt-row .lt-field { flex: 1; }
    #${PANEL_ID} .lt-save-btn {
      padding: 8px 20px;
      background: #a6e3a1;
      color: #1e1e2e;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
    }
    #${PANEL_ID} .lt-save-btn:hover { background: #94e2d5; }
    #${PANEL_ID} .lt-status-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    #${PANEL_ID} .lt-stat {
      background: #313244;
      padding: 10px;
      border-radius: 8px;
    }
    #${PANEL_ID} .lt-stat .label { color: #6c7086; font-size: 11px; }
    #${PANEL_ID} .lt-stat .value { color: #cdd6f4; font-size: 18px; font-weight: 600; margin-top: 2px; }
    #${PANEL_ID} .lt-search-box {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    #${PANEL_ID} .lt-search-box input { flex: 1; }
    #${PANEL_ID} .lt-search-btn {
      padding: 6px 14px;
      background: #89b4fa;
      color: #1e1e2e;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      white-space: nowrap;
    }
    #${PANEL_ID} .lt-results {
      max-height: 300px;
      overflow-y: auto;
      background: #181825;
      border-radius: 6px;
      padding: 8px;
      font-family: monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    #${PANEL_ID} .lt-scope-select {
      padding: 6px 10px;
      background: #313244;
      border: 1px solid #45475a;
      border-radius: 6px;
      color: #cdd6f4;
      font-size: 13px;
    }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <button class="lt-btn" id="lt-toggle">LCM</button>
    <div class="lt-overlay" id="lt-overlay"></div>
    <div class="lt-modal" id="lt-modal">
      <div class="lt-header">
        <h3>Lossless Context Manager</h3>
        <button class="lt-close" id="lt-close">&times;</button>
      </div>
      <div class="lt-tabs">
        <button class="lt-tab active" data-tab="status">Status</button>
        <button class="lt-tab" data-tab="config">Config</button>
        <button class="lt-tab" data-tab="search">Search</button>
        <button class="lt-tab" data-tab="describe">Describe</button>
      </div>
      <div class="lt-body" id="lt-body"></div>
    </div>
  `;
  document.body.appendChild(panel);

  document.getElementById('lt-toggle')!.addEventListener('click', openModal);
  document.getElementById('lt-overlay')!.addEventListener('click', closeModal);
  document.getElementById('lt-close')!.addEventListener('click', closeModal);

  panel.querySelectorAll('.lt-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      panel.querySelectorAll('.lt-tab').forEach((t) => t.classList.remove('active'));
      target.classList.add('active');
      renderTab(target.dataset.tab!);
    });
  });

  renderTab('status');
}

function openModal() {
  document.getElementById('lt-overlay')!.classList.add('active');
  document.getElementById('lt-modal')!.classList.add('active');
  renderTab('status');
}

function closeModal() {
  document.getElementById('lt-overlay')!.classList.remove('active');
  document.getElementById('lt-modal')!.classList.remove('active');
}

function renderTab(tab: string) {
  const body = document.getElementById('lt-body')!;
  switch (tab) {
    case 'status': renderStatus(body); break;
    case 'config': renderConfig(body); break;
    case 'search': renderSearch(body); break;
    case 'describe': renderDescribe(body); break;
  }
}

function renderStatus(body: HTMLElement) {
  const config = loadConfig();
  const charName = window.TavernHelper?.getCurrentCharacterName?.() ?? 'Unknown';
  const chatName = 'current';
  const conv = getConversation(chatName, charName);
  const dbSize = getDatabaseSize();

  let statusHtml = '<div class="lt-status-grid">';
  statusHtml += `<div class="lt-stat"><div class="label">Enabled</div><div class="value">${config.enabled ? 'Yes' : 'No'}</div></div>`;
  statusHtml += `<div class="lt-stat"><div class="label">DB Size</div><div class="value">${(dbSize / 1024).toFixed(1)} KB</div></div>`;

  if (conv) {
    const status = getCompactionStatus(conv.id, 128000);
    statusHtml += `<div class="lt-stat"><div class="label">Messages</div><div class="value">${status.messageCount}</div></div>`;
    statusHtml += `<div class="lt-stat"><div class="label">Summaries</div><div class="value">${status.summaryCount}</div></div>`;
    statusHtml += `<div class="lt-stat"><div class="label">Msg Tokens</div><div class="value">${status.messageTokens.toLocaleString()}</div></div>`;
    statusHtml += `<div class="lt-stat"><div class="label">Sum Tokens</div><div class="value">${status.summaryTokens.toLocaleString()}</div></div>`;
  } else {
    statusHtml += `<div class="lt-stat"><div class="label">Status</div><div class="value">No active conversation</div></div>`;
  }

  statusHtml += '</div>';
  body.innerHTML = statusHtml;
}

function renderConfig(body: HTMLElement) {
  const config = loadConfig();
  body.innerHTML = `
    <div class="lt-field">
      <label>API URL</label>
      <input type="text" id="lt-cfg-url" value="${config.llm.apiUrl}">
    </div>
    <div class="lt-field">
      <label>API Key</label>
      <input type="password" id="lt-cfg-key" value="${config.llm.apiKey}">
    </div>
    <div class="lt-row">
      <div class="lt-field">
        <label>Model</label>
        <input type="text" id="lt-cfg-model" value="${config.llm.model}">
      </div>
      <div class="lt-field">
        <label>Summary Model (optional)</label>
        <input type="text" id="lt-cfg-smodel" value="${config.compaction.summaryModel}">
      </div>
    </div>
    <div class="lt-row">
      <div class="lt-field">
        <label>Context Threshold (0-1)</label>
        <input type="number" step="0.01" min="0" max="1" id="lt-cfg-threshold" value="${config.compaction.contextThreshold}">
      </div>
      <div class="lt-field">
        <label>Fresh Tail Count</label>
        <input type="number" min="1" id="lt-cfg-tail" value="${config.compaction.freshTailCount}">
      </div>
    </div>
    <div class="lt-row">
      <div class="lt-field">
        <label>Leaf Chunk Tokens</label>
        <input type="number" min="1000" id="lt-cfg-lchunk" value="${config.compaction.leafChunkTokens}">
      </div>
      <div class="lt-field">
        <label>Leaf Target Tokens</label>
        <input type="number" min="100" id="lt-cfg-ltarget" value="${config.compaction.leafTargetTokens}">
      </div>
    </div>
    <div class="lt-row">
      <div class="lt-field">
        <label>Temperature</label>
        <input type="number" step="0.1" min="0" max="2" id="lt-cfg-temp" value="${config.llm.temperature}">
      </div>
      <div class="lt-field">
        <label>Max Tokens</label>
        <input type="number" min="100" id="lt-cfg-maxtok" value="${config.llm.maxTokens}">
      </div>
    </div>
    <div class="lt-field">
      <label>
        <input type="checkbox" id="lt-cfg-enabled" ${config.enabled ? 'checked' : ''}>
        Enabled
      </label>
    </div>
    <div class="lt-field">
      <label>
        <input type="checkbox" id="lt-cfg-auto" ${config.autoInject ? 'checked' : ''}>
        Auto-inject summaries before generation
      </label>
    </div>
    <button class="lt-save-btn" id="lt-cfg-save">Save</button>
  `;

  document.getElementById('lt-cfg-save')!.addEventListener('click', () => {
    const newConfig: Partial<AppConfig> = {
      enabled: (document.getElementById('lt-cfg-enabled') as HTMLInputElement).checked,
      autoInject: (document.getElementById('lt-cfg-auto') as HTMLInputElement).checked,
      llm: {
        ...config.llm,
        apiUrl: (document.getElementById('lt-cfg-url') as HTMLInputElement).value,
        apiKey: (document.getElementById('lt-cfg-key') as HTMLInputElement).value,
        model: (document.getElementById('lt-cfg-model') as HTMLInputElement).value,
        temperature: parseFloat((document.getElementById('lt-cfg-temp') as HTMLInputElement).value),
        maxTokens: parseInt((document.getElementById('lt-cfg-maxtok') as HTMLInputElement).value),
        timeout: config.llm.timeout,
      },
      compaction: {
        ...config.compaction,
        summaryModel: (document.getElementById('lt-cfg-smodel') as HTMLInputElement).value,
        contextThreshold: parseFloat((document.getElementById('lt-cfg-threshold') as HTMLInputElement).value),
        freshTailCount: parseInt((document.getElementById('lt-cfg-tail') as HTMLInputElement).value),
        leafChunkTokens: parseInt((document.getElementById('lt-cfg-lchunk') as HTMLInputElement).value),
        leafTargetTokens: parseInt((document.getElementById('lt-cfg-ltarget') as HTMLInputElement).value),
      },
    };
    updateConfig(newConfig);
    window.toastr?.success?.('Config saved!');
  });
}

function renderSearch(body: HTMLElement) {
  body.innerHTML = `
    <div class="lt-search-box">
      <input type="text" id="lt-srch-q" placeholder="Search messages and summaries...">
      <select class="lt-scope-select" id="lt-srch-scope">
        <option value="both">Both</option>
        <option value="messages">Messages</option>
        <option value="summaries">Summaries</option>
      </select>
      <button class="lt-search-btn" id="lt-srch-go">Search</button>
    </div>
    <div class="lt-results" id="lt-srch-results">Enter a query to search.</div>
  `;

  document.getElementById('lt-srch-go')!.addEventListener('click', () => {
    const query = (document.getElementById('lt-srch-q') as HTMLInputElement).value.trim();
    if (!query) return;
    const scope = (document.getElementById('lt-srch-scope') as HTMLSelectElement).value as any;
    const charName = window.TavernHelper?.getCurrentCharacterName?.() ?? 'Unknown';
    const conv = getConversation('current', charName);
    if (!conv) {
      document.getElementById('lt-srch-results')!.textContent = 'No active conversation.';
      return;
    }
    const results = grep(conv.id, query, { scope });
    document.getElementById('lt-srch-results')!.textContent = formatGrepResults(results);
  });
}

function renderDescribe(body: HTMLElement) {
  body.innerHTML = `
    <div class="lt-field">
      <label>Summary ID</label>
      <input type="text" id="lt-desc-id" placeholder="sum_...">
    </div>
    <button class="lt-search-btn" id="lt-desc-go">Describe</button>
    <div class="lt-results" id="lt-desc-results" style="margin-top:12px;">Enter a summary ID to inspect.</div>
  `;

  document.getElementById('lt-desc-go')!.addEventListener('click', () => {
    const id = (document.getElementById('lt-desc-id') as HTMLInputElement).value.trim();
    if (!id) return;
    const result = describe(id);
    if (!result) {
      document.getElementById('lt-desc-results')!.textContent = 'Summary not found.';
      return;
    }
    document.getElementById('lt-desc-results')!.textContent = formatDescribeResult(result);
  });
}
