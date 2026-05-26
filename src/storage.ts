import type { Conversation, StoredMessage, SummaryNode, SearchResult } from './types';
import { estimateTokens } from './tokenizer';

let SQL: any = null;
let db: any = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveDebounce = 1000;

const DB_NAME = 'lossless_tavern';
const STORE_NAME = 'database';

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (db) saveToIndexedDB();
  }, saveDebounce);
}

async function loadSqlJs(): Promise<any> {
  if (window.initSqlJs) return window.initSqlJs;

  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/sql-wasm.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load sql.js'));
    document.head.appendChild(s);
  });

  return window.initSqlJs;
}

async function saveToIndexedDB(): Promise<void> {
  if (!db) return;
  const data = db.export();
  const blob = new Blob([data.buffer], { type: 'application/x-sqlite3' });

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => {
      const idb = req.result;
      const tx = idb.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, 'db');
      tx.oncomplete = () => { idb.close(); resolve(); };
      tx.onerror = () => { idb.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

async function loadFromIndexedDB(SQL: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => {
      const idb = req.result;
      const tx = idb.transaction(STORE_NAME, 'readonly');
      const getReq = tx.objectStore(STORE_NAME).get('db');
      getReq.onsuccess = () => {
        if (getReq.result) {
          getReq.result.arrayBuffer().then((buf: ArrayBuffer) => {
            idb.close();
            resolve(new SQL.Database(new Uint8Array(buf)));
          });
        } else {
          idb.close();
          resolve(new SQL.Database());
        }
      };
      getReq.onerror = () => { idb.close(); reject(getReq.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

function initSchema(database: any) {
  database.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      chat_name TEXT NOT NULL,
      char_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      message_index INTEGER NOT NULL,
      role TEXT NOT NULL,
      name TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      token_count INTEGER DEFAULT 0,
      is_summarized INTEGER DEFAULT 0,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      UNIQUE(conversation_id, message_index)
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      depth INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      earliest_at TEXT NOT NULL,
      latest_at TEXT NOT NULL,
      token_count INTEGER DEFAULT 0,
      source_message_start INTEGER,
      source_message_end INTEGER,
      parent_summary_ids TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, message_index);
    CREATE INDEX IF NOT EXISTS idx_messages_summarized ON messages(conversation_id, is_summarized);
    CREATE INDEX IF NOT EXISTS idx_summaries_conv ON summaries(conversation_id, depth);
  `);

  try {
    database.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content, content='messages', content_rowid='id'
      );
    `);
    database.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
        content, content='summaries', content_rowid='id'
      );
    `);
  } catch {
    // FTS5 not available, skip
  }
}

export async function initStorage(debounce: number = 1000): Promise<void> {
  saveDebounce = debounce;
  const initSqlJs = await loadSqlJs();
  SQL = await initSqlJs({
    locateFile: (file: string) =>
      `https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/${file}`,
  });
  db = await loadFromIndexedDB(SQL);
  initSchema(db);
}

export function isStorageReady(): boolean {
  return db !== null;
}

// --- Conversation ---

export function getOrCreateConversation(
  chatName: string,
  charName: string
): Conversation {
  const now = new Date().toISOString();
  const existing = db.exec(
    'SELECT * FROM conversations WHERE chat_name = ? AND char_name = ?',
    [chatName, charName]
  );

  if (existing.length > 0 && existing[0].values.length > 0) {
    const row = existing[0].values[0];
    return {
      id: row[0],
      chatName: row[1],
      charName: row[2],
      createdAt: row[3],
      updatedAt: row[4],
    };
  }

  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.run(
    'INSERT INTO conversations (id, chat_name, char_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, chatName, charName, now, now]
  );
  scheduleSave();
  return { id, chatName, charName, createdAt: now, updatedAt: now };
}

export function getConversation(chatName: string, charName: string): Conversation | null {
  const result = db.exec(
    'SELECT * FROM conversations WHERE chat_name = ? AND char_name = ?',
    [chatName, charName]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  const row = result[0].values[0];
  return {
    id: row[0],
    chatName: row[1],
    charName: row[2],
    createdAt: row[3],
    updatedAt: row[4],
  };
}

// --- Messages ---

export function storeMessage(
  conversationId: string,
  messageIndex: number,
  role: string,
  name: string,
  content: string
): void {
  const tokenCount = estimateTokens(content);
  const now = new Date().toISOString();
  db.run(
    `INSERT OR REPLACE INTO messages
     (conversation_id, message_index, role, name, content, created_at, token_count, is_summarized)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [conversationId, messageIndex, role, name, content, now, tokenCount]
  );
  try {
    db.run(
      `INSERT OR REPLACE INTO messages_fts (rowid, content)
       SELECT id, content FROM messages WHERE conversation_id = ? AND message_index = ?`,
      [conversationId, messageIndex]
    );
  } catch { }
  scheduleSave();
}

export function getMessages(
  conversationId: string,
  options?: { includeSummarized?: boolean; start?: number; end?: number }
): StoredMessage[] {
  let sql = 'SELECT * FROM messages WHERE conversation_id = ?';
  const params: any[] = [conversationId];

  if (!options?.includeSummarized) {
    sql += ' AND is_summarized = 0';
  }
  if (options?.start !== undefined) {
    sql += ' AND message_index >= ?';
    params.push(options.start);
  }
  if (options?.end !== undefined) {
    sql += ' AND message_index <= ?';
    params.push(options.end);
  }
  sql += ' ORDER BY message_index ASC';

  const result = db.exec(sql, params);
  if (result.length === 0) return [];

  return result[0].values.map((row: any[]) => ({
    id: row[0],
    conversationId: row[1],
    messageIndex: row[2],
    role: row[3],
    name: row[4],
    content: row[5],
    createdAt: row[6],
    tokenCount: row[7],
    isSummarized: row[8],
  }));
}

export function markMessagesSummarized(
  conversationId: string,
  startIndex: number,
  endIndex: number
): void {
  db.run(
    'UPDATE messages SET is_summarized = 1 WHERE conversation_id = ? AND message_index >= ? AND message_index <= ?',
    [conversationId, startIndex, endIndex]
  );
  scheduleSave();
}

export function getMessageCount(conversationId: string): number {
  const result = db.exec(
    'SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND is_summarized = 0',
    [conversationId]
  );
  return result[0]?.values[0]?.[0] ?? 0;
}

export function getMessageTokenTotal(conversationId: string): number {
  const result = db.exec(
    'SELECT COALESCE(SUM(token_count), 0) FROM messages WHERE conversation_id = ? AND is_summarized = 0',
    [conversationId]
  );
  return result[0]?.values[0]?.[0] ?? 0;
}

// --- Summaries ---

export function storeSummary(summary: SummaryNode): void {
  db.run(
    `INSERT OR REPLACE INTO summaries
     (id, conversation_id, depth, content, earliest_at, latest_at, token_count,
      source_message_start, source_message_end, parent_summary_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      summary.id,
      summary.conversationId,
      summary.depth,
      summary.content,
      summary.earliestAt,
      summary.latestAt,
      summary.tokenCount,
      summary.sourceMessageStart,
      summary.sourceMessageEnd,
      JSON.stringify(summary.parentSummaryIds),
      summary.createdAt,
    ]
  );
  try {
    db.run(
      'INSERT OR REPLACE INTO summaries_fts (rowid, content) SELECT id, content FROM summaries WHERE id = ?',
      [summary.id]
    );
  } catch { }
  scheduleSave();
}

function rowToSummary(row: any[]): SummaryNode {
  return {
    id: row[0],
    conversationId: row[1],
    depth: row[2],
    content: row[3],
    earliestAt: row[4],
    latestAt: row[5],
    tokenCount: row[6],
    sourceMessageStart: row[7],
    sourceMessageEnd: row[8],
    parentSummaryIds: JSON.parse(row[9] || '[]'),
    createdAt: row[10],
  };
}

export function getSummaries(
  conversationId: string,
  depth?: number
): SummaryNode[] {
  let sql = 'SELECT * FROM summaries WHERE conversation_id = ?';
  const params: any[] = [conversationId];
  if (depth !== undefined) {
    sql += ' AND depth = ?';
    params.push(depth);
  }
  sql += ' ORDER BY earliest_at ASC';

  const result = db.exec(sql, params);
  if (result.length === 0) return [];
  return result[0].values.map(rowToSummary);
}

export function getSummaryById(id: string): SummaryNode | null {
  const result = db.exec('SELECT * FROM summaries WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  return rowToSummary(result[0].values[0]);
}

export function getSummariesByDepth(conversationId: string, depth: number): SummaryNode[] {
  return getSummaries(conversationId, depth);
}

export function getSummaryCount(conversationId: string): number {
  const result = db.exec(
    'SELECT COUNT(*) FROM summaries WHERE conversation_id = ?',
    [conversationId]
  );
  return result[0]?.values[0]?.[0] ?? 0;
}

export function getSummaryTokenTotal(conversationId: string): number {
  const result = db.exec(
    'SELECT COALESCE(SUM(token_count), 0) FROM summaries WHERE conversation_id = ?',
    [conversationId]
  );
  return result[0]?.values[0]?.[0] ?? 0;
}

// --- Search ---

export function searchMessages(
  conversationId: string,
  query: string,
  limit: number = 20
): SearchResult[] {
  try {
    const result = db.exec(
      `SELECT m.id, m.content, m.role, m.name,
              messages_fts.rank
       FROM messages_fts
       JOIN messages m ON messages_fts.rowid = m.id
       WHERE messages_fts MATCH ? AND m.conversation_id = ?
       ORDER BY messages_fts.rank
       LIMIT ?`,
      [query, conversationId, limit]
    );
    if (result.length === 0) return [];
    return result[0].values.map((row: any[]) => ({
      type: 'message' as const,
      id: String(row[0]),
      content: row[1],
      snippet: row[1].slice(0, 200),
      rank: row[4],
    }));
  } catch {
    return [];
  }
}

export function searchSummaries(
  conversationId: string,
  query: string,
  limit: number = 20
): SearchResult[] {
  try {
    const result = db.exec(
      `SELECT s.id, s.content,
              summaries_fts.rank
       FROM summaries_fts
       JOIN summaries s ON summaries_fts.rowid = s.id
       WHERE summaries_fts MATCH ? AND s.conversation_id = ?
       ORDER BY summaries_fts.rank
       LIMIT ?`,
      [query, conversationId, limit]
    );
    if (result.length === 0) return [];
    return result[0].values.map((row: any[]) => ({
      type: 'summary' as const,
      id: row[0],
      content: row[1],
      snippet: row[1].slice(0, 200),
      rank: row[2],
    }));
  } catch {
    return [];
  }
}

// --- Export ---

export function exportDatabase(): Uint8Array | null {
  return db ? db.export() : null;
}

export function getDatabaseSize(): number {
  if (!db) return 0;
  return db.export().length;
}
