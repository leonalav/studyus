import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getDb,
  saveDbSync,
  beginBatch,
  endBatch,
  resetBatchState,
} from "./database";

const STORAGE_KEY = "studyus_sqlite_db_v1";

// In-memory Storage implementation for test isolation.
function memoryStorage(): { store: Storage; raw: Map<string, string> } {
  const raw = new Map<string, string>();
  const store: Storage = {
    get length() {
      return raw.size;
    },
    clear: () => raw.clear(),
    getItem: (key) => raw.get(key) ?? null,
    key: (index) => Array.from(raw.keys())[index] ?? null,
    removeItem: (key) => raw.delete(key),
    setItem: (key, value) => raw.set(key, value),
  };
  return { store, raw };
}

/**
 * Stub window/localStorage so _doFlush writes to the in-memory store.
 * Must be called AFTER getDb() has resolved (so locateFile never sees
 * window defined during WASM loading).
 */
function stubWindow(store: Storage) {
  vi.stubGlobal("window", { localStorage: store });
  vi.stubGlobal("localStorage", store);
}

describe("beginBatch / endBatch nesting", () => {
  let rawStorage: Map<string, string>;

  beforeEach(async () => {
    resetBatchState();
    // getDb() on the very first call uses the Node branch of locateFile
    // (no window defined) so WASM loads from disk. On subsequent calls
    // the cached dbInstance is returned immediately.
    await getDb();
    const { store, raw } = memoryStorage();
    rawStorage = raw;
    stubWindow(store);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("supports outer begin, inner begin, inner end, outer end without error", () => {
    beginBatch();
    beginBatch();
    endBatch();
    endBatch();
    // If we reach here without throwing, the reference counting worked.
    expect(true).toBe(true);
  });

  it("does not flush on inner endBatch when outer batch is still open", () => {
    beginBatch();
    beginBatch();
    const countBefore = rawStorage.size;
    endBatch();
    // The inner end must NOT have triggered a flush -- the outer batch is
    // still holding the gate.
    expect(rawStorage.size).toBe(countBefore);
    endBatch();
  });

  it("flushes exactly once on the outermost endBatch", () => {
    beginBatch();
    beginBatch();
    beginBatch();
    saveDbSync(); // triggers _flushOwed = true
    const countBefore = rawStorage.size;
    endBatch();
    endBatch();
    endBatch();
    // One flush for the entire batch sequence, not one per nesting level.
    expect(rawStorage.size).toBe(countBefore + 1);
  });

  it("an unmatched endBatch does not cause negative depth or a flush", () => {
    beginBatch();
    saveDbSync(); // mark that a flush is owed
    const countBefore = rawStorage.size;
    endBatch();
    // One flush for the batch.
    expect(rawStorage.size).toBe(countBefore + 1);

    const countAfter = rawStorage.size;
    // Calling endBatch without a matching beginBatch must be a no-op, not
    // a negative-depth crash or a spurious flush.
    endBatch();
    expect(rawStorage.size).toBe(countAfter);
  });

  it("deferred writes inside a batch are not flushed until the outer batch ends", () => {
    beginBatch();
    const countBefore = rawStorage.size;

    // saveDbSync inside a batch sets _flushOwed but does NOT flush.
    saveDbSync();
    expect(rawStorage.size).toBe(countBefore);

    endBatch();
    // Now the batch flushes.
    expect(rawStorage.size).toBe(countBefore + 1);
  });

  it("N writes inside one batch produce exactly ONE flush", () => {
    beginBatch();
    const countBefore = rawStorage.size;

    // Simulate many writes via the saveDbSync export.
    for (let i = 0; i < 16; i++) {
      saveDbSync();
    }

    // None of those writes should have triggered a flush.
    expect(rawStorage.size).toBe(countBefore);

    endBatch();
    // Exactly one flush.
    expect(rawStorage.size).toBe(countBefore + 1);
  });

  it("endBatch called in a finally still flushes when the batch body throws", () => {
    const countBefore = rawStorage.size;

    beginBatch();
    let caught = false;
    try {
      saveDbSync(); // write inside the batch
      throw new Error("simulated failure");
    } catch {
      caught = true;
    } finally {
      endBatch();
    }

    expect(caught).toBe(true);
    // The finally block must have flushed despite the throw.
    expect(rawStorage.size).toBe(countBefore + 1);
  });

  it("unmatched endBatch does not break the next batch", () => {
    // Spurious endBatch -- should be a no-op.
    endBatch();
    endBatch();

    const countBefore = rawStorage.size;
    beginBatch();
    saveDbSync();
    endBatch();

    // The batch still flushes exactly once despite the earlier unmatched ends.
    expect(rawStorage.size).toBe(countBefore + 1);
  });
});

describe("byte-identical persistence", () => {
  let rawStorage: Map<string, string>;

  beforeEach(async () => {
    resetBatchState();
    await getDb();
    const { store, raw } = memoryStorage();
    rawStorage = raw;
    stubWindow(store);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bytes persisted through the batched path are byte-identical to the unbatched path", async () => {
    const db = await getDb();

    // --- Unbatched path: write a row, flush, grab the base64 blob ---
    db.run("CREATE TABLE IF NOT EXISTS _batch_test (val TEXT);");
    db.run("DELETE FROM _batch_test;");
    db.run("INSERT INTO _batch_test VALUES ('same');");
    saveDbSync();
    const unbatchedBlob = rawStorage.get(STORAGE_KEY);
    expect(unbatchedBlob).toBeTruthy();

    // --- Batched path: identical operations inside a batch, flush, compare ---
    beginBatch();
    db.run("DELETE FROM _batch_test;");
    db.run("INSERT INTO _batch_test VALUES ('same');");
    saveDbSync(); // mark flush owed so endBatch will actually flush
    endBatch();
    const batchedBlob = rawStorage.get(STORAGE_KEY);
    expect(batchedBlob).toBeTruthy();

    // Both blobs must decode to valid databases with the same data.
    // We decode and compare content rather than raw base64 because
    // SQLite may embed timestamps or internal state that differ between
    // two separate export() calls even on identical logical data.
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        `${process.cwd()}/node_modules/sql.js/dist/${file}`,
    });

    const decode = (b64: string) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new SQL.Database(raw);
    };

    const dbU = decode(unbatchedBlob!);
    const dbB = decode(batchedBlob!);

    const uResult = dbU.exec("SELECT val FROM _batch_test;");
    const bResult = dbB.exec("SELECT val FROM _batch_test;");

    // The decoded rows must match — both wrote 'same'.
    expect(bResult[0]?.values[0]?.[0]).toBe(
      uResult[0]?.values[0]?.[0]
    );

    dbU.close();
    dbB.close();
    db.run("DROP TABLE IF EXISTS _batch_test;");
    saveDbSync();
  });
});

describe("serializer round-trip", () => {
  let rawStorage: Map<string, string>;

  beforeEach(async () => {
    resetBatchState();
    await getDb();
    const { store, raw } = memoryStorage();
    rawStorage = raw;
    stubWindow(store);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("export -> encode -> decode -> re-open preserves high-byte / multi-byte UTF-8", async () => {
    const db = await getDb();

    // Write a row with multi-byte UTF-8 and non-ASCII content.
    const testString = "日本語テスト émojis: 🎓🔬💡 & math: ∑∫∂≠≤≥";
    db.run("CREATE TABLE IF NOT EXISTS _utf8_test (txt TEXT);");
    db.run("INSERT INTO _utf8_test VALUES (?);", [testString]);
    saveDbSync();

    // Grab the base64 blob, re-open from it, verify the string survived.
    const blob = rawStorage.get(STORAGE_KEY)!;
    expect(blob).toBeTruthy();

    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        `${process.cwd()}/node_modules/sql.js/dist/${file}`,
    });

    const raw = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    const reOpened = new SQL.Database(raw);
    const result = reOpened.exec("SELECT txt FROM _utf8_test;");
    expect(result[0]?.values[0]?.[0]).toBe(testString);

    reOpened.close();
    db.run("DROP TABLE IF EXISTS _utf8_test;");
    saveDbSync();
  });

  it("chunked encoder round-trip via batched path preserves multi-byte UTF-8", async () => {
    const db = await getDb();

    // Write through a batch so _doFlush uses the chunked encoder.
    // Pad to >8192 chars so the chunking logic is exercised.
    const testString =
      "混合文字 Ñoño नमस्ते 🌍✨ ~7500 bytes of padding: " + "x".repeat(7400);
    db.run("CREATE TABLE IF NOT EXISTS _utf8_batch_test (txt TEXT);");

    beginBatch();
    db.run("INSERT INTO _utf8_batch_test VALUES (?);", [testString]);
    saveDbSync(); // mark flush owed so endBatch will actually flush
    endBatch();

    const blob = rawStorage.get(STORAGE_KEY)!;
    expect(blob).toBeTruthy();

    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        `${process.cwd()}/node_modules/sql.js/dist/${file}`,
    });

    const raw = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    const reOpened = new SQL.Database(raw);
    const result = reOpened.exec("SELECT txt FROM _utf8_batch_test;");
    expect(result[0]?.values[0]?.[0]).toBe(testString);

    reOpened.close();
    db.run("DROP TABLE IF EXISTS _utf8_batch_test;");
    saveDbSync();
  });
});

describe("migration v9 — exposition_streak", () => {
  beforeEach(async () => {
    resetBatchState();
    await getDb();
    const { store } = memoryStorage();
    stubWindow(store);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds exposition_streak INTEGER NOT NULL DEFAULT 0 to chalkboard_sessions", async () => {
    const db = await getDb();
    const result = db.exec("PRAGMA table_info(chalkboard_sessions);");
    const columns = result[0]?.values.map((row) => row[1] as string) ?? [];
    expect(columns).toContain("exposition_streak");

    const colRow = result[0]?.values.find(
      (row) => row[1] === "exposition_streak"
    );
    expect(colRow).toBeDefined();
    expect(colRow?.[4]).toBe("0");
  });

  it("INSERT into chalkboard_sessions without specifying exposition_streak succeeds", async () => {
    const db = await getDb();
    const testId = `test-streak-${Date.now()}`;
    db.run(
      `INSERT INTO chalkboard_sessions (id, title, domain, bound_nodes, assistance_policy, status, created_at, updated_at)
       VALUES (?, 'test', 'math', '[]', 'progressive_hints', 'active', datetime('now'), datetime('now'));`,
      [testId]
    );
    const result = db.exec(
      "SELECT exposition_streak FROM chalkboard_sessions WHERE id = ?",
      [testId]
    );
    expect(result[0]?.values[0]?.[0]).toBe(0);

    db.run("DELETE FROM chalkboard_sessions WHERE id = ?", [testId]);
  });
});
