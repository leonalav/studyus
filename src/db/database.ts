import initSqlJs, { Database, QueryExecResult } from "sql.js";

let dbInstance: Database | null = null;
let initPromise: Promise<Database> | null = null;

const STORAGE_KEY = "studyus_sqlite_db_v1";

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const SQL = await initSqlJs({
      locateFile: (file) => {
        if (typeof window !== "undefined") return new URL("sql-wasm.wasm", document.baseURI).toString();
        return `${process.cwd()}/node_modules/sql.js/dist/${file}`;
      },
    });
    let db: Database;
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const buf = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
          db = new SQL.Database(buf);
        } catch {
          db = new SQL.Database();
        }
      } else {
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }

    dbInstance = db;
    db.run("PRAGMA foreign_keys = ON;");
    runMigrations(db);
    return db;
  })();

  return initPromise;
}

export function saveDbSync(): void {
  if (!dbInstance) return;
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const data = dbInstance.export();
      let binary = "";
      for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
      }
      window.localStorage.setItem(STORAGE_KEY, btoa(binary));
    } catch (e) {
      console.warn("Could not persist SQLite DB to LocalStorage", e);
    }
  }
}

export function runQuery(sql: string, params: any[] = []): QueryExecResult[] {
  if (!dbInstance) throw new Error("Database not initialized");
  return dbInstance.exec(sql, params);
}

export function runExec(sql: string): void {
  if (!dbInstance) throw new Error("Database not initialized");
  dbInstance.run(sql);
  saveDbSync();
}

function runMigrations(db: Database) {
  // Check migration ledger / PRAGMA user_version
  db.run(`
    CREATE TABLE IF NOT EXISTS migration_ledger (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      rule_recorded TEXT NOT NULL
    );
  `);

  const currentVersionRes = db.exec("PRAGMA user_version;");
  const currentVersion = currentVersionRes[0]?.values[0]?.[0] as number ?? 0;

  if (currentVersion < 1) {
    db.run("BEGIN TRANSACTION;");

    db.run(`
      CREATE TABLE IF NOT EXISTS assessment_forms (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        format TEXT NOT NULL,
        config_json TEXT NOT NULL,
        mode TEXT NOT NULL,
        curriculum_scope TEXT NOT NULL,
        generation_version TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        feedback_policy TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assessment_items (
        id TEXT PRIMARY KEY,
        form_id TEXT NOT NULL,
        stable_ordinal INTEGER NOT NULL,
        stem TEXT NOT NULL,
        item_type TEXT NOT NULL,
        maximum_marks REAL NOT NULL,
        bloom_target TEXT NOT NULL,
        learning_objective TEXT NOT NULL,
        curriculum_node TEXT NOT NULL,
        answer_spec_json TEXT NOT NULL,
        figure_spec_json TEXT,
        provenance TEXT NOT NULL,
        generation_version TEXT NOT NULL,
        FOREIGN KEY(form_id) REFERENCES assessment_forms(id) ON DELETE CASCADE,
        UNIQUE(form_id, stable_ordinal)
      );

      CREATE TABLE IF NOT EXISTS item_evidence (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        source TEXT NOT NULL,
        syllabus_node TEXT NOT NULL,
        page_or_chunk TEXT NOT NULL,
        excerpt_hash TEXT NOT NULL,
        evidence_role TEXT NOT NULL,
        FOREIGN KEY(item_id) REFERENCES assessment_items(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS assessment_attempts (
        id TEXT PRIMARY KEY,
        form_id TEXT NOT NULL,
        learner_id TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        assistance_policy TEXT NOT NULL,
        started_at TEXT NOT NULL,
        deadline_at TEXT,
        submitted_at TEXT,
        completed_at TEXT,
        current_ordinal INTEGER NOT NULL DEFAULT 0,
        aggregate_score REAL DEFAULT 0,
        grading_status TEXT NOT NULL,
        audit_created_at TEXT NOT NULL,
        audit_updated_at TEXT NOT NULL,
        FOREIGN KEY(form_id) REFERENCES assessment_forms(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS attempt_responses (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        draft_response TEXT,
        committed_response TEXT,
        response_flags TEXT,
        confidence REAL,
        latency_ms INTEGER,
        response_status TEXT NOT NULL,
        grading_status TEXT NOT NULL,
        assistance_metadata TEXT,
        FOREIGN KEY(attempt_id) REFERENCES assessment_attempts(id) ON DELETE CASCADE,
        FOREIGN KEY(item_id) REFERENCES assessment_items(id) ON DELETE CASCADE,
        UNIQUE(attempt_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS criterion_scores (
        id TEXT PRIMARY KEY,
        response_id TEXT NOT NULL,
        stable_criterion_id TEXT NOT NULL,
        maximum_mark REAL NOT NULL,
        awarded_mark REAL NOT NULL,
        rationale TEXT NOT NULL,
        grader_confidence REAL NOT NULL,
        uncertainty_state TEXT NOT NULL,
        FOREIGN KEY(response_id) REFERENCES attempt_responses(id) ON DELETE CASCADE,
        UNIQUE(response_id, stable_criterion_id)
      );

      CREATE TABLE IF NOT EXISTS score_overrides (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        response_id TEXT NOT NULL,
        criterion_id TEXT NOT NULL,
        original_award REAL NOT NULL,
        adjusted_award REAL NOT NULL,
        reason TEXT NOT NULL,
        operator TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        FOREIGN KEY(attempt_id) REFERENCES assessment_attempts(id) ON DELETE CASCADE,
        FOREIGN KEY(response_id) REFERENCES attempt_responses(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS assessment_events (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        response_id TEXT,
        event_type TEXT NOT NULL,
        metadata_json TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY(attempt_id) REFERENCES assessment_attempts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS remediation_links (
        id TEXT PRIMARY KEY,
        failed_criterion TEXT NOT NULL,
        source_curriculum_node TEXT NOT NULL,
        intervention TEXT NOT NULL,
        transfer_item_id TEXT,
        completion_state TEXT NOT NULL,
        deduplication_key TEXT UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS item_statistics (
        id TEXT PRIMARY KEY,
        item_id TEXT UNIQUE NOT NULL,
        unassisted_correctness REAL DEFAULT 0,
        assisted_correctness REAL DEFAULT 0,
        hint_usage_count INTEGER DEFAULT 0,
        response_timing_avg_ms REAL DEFAULT 0,
        confidence_avg REAL DEFAULT 0,
        transfer_performance REAL DEFAULT 0,
        uncertainty REAL DEFAULT 0,
        FOREIGN KEY(item_id) REFERENCES assessment_items(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS curriculum_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hash TEXT NOT NULL,
        page_count INTEGER NOT NULL,
        has_outline INTEGER NOT NULL,
        extraction_status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS curriculum_nodes (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        parent_node_id TEXT,
        ordinal INTEGER NOT NULL,
        depth INTEGER NOT NULL,
        title TEXT NOT NULL,
        section_number TEXT,
        start_page INTEGER NOT NULL,
        end_page INTEGER NOT NULL,
        node_kind TEXT NOT NULL,
        extraction_status TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        FOREIGN KEY(source_id) REFERENCES curriculum_sources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS curriculum_chunks (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        page INTEGER NOT NULL,
        chunk_ordinal INTEGER NOT NULL,
        text_content TEXT NOT NULL,
        excerpt_hash TEXT NOT NULL,
        chunk_kind TEXT NOT NULL,
        FOREIGN KEY(node_id) REFERENCES curriculum_nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS curriculum_assets (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        page INTEGER NOT NULL,
        asset_type TEXT NOT NULL,
        blob_path_or_data TEXT NOT NULL,
        FOREIGN KEY(node_id) REFERENCES curriculum_nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chalkboard_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        domain TEXT NOT NULL,
        bound_nodes TEXT NOT NULL,
        assistance_policy TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        attachments_json TEXT,
        model_id TEXT,
        prompt_version TEXT,
        tokens_used INTEGER,
        timestamp TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES chalkboard_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS board_objects (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        z_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES chalkboard_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS graph_specs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        dimensionality TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES chalkboard_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS learner_model_entries (
        id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL,
        entry_kind TEXT NOT NULL,
        curriculum_node TEXT,
        criterion_id TEXT,
        statement TEXT NOT NULL,
        evidence_refs TEXT NOT NULL,
        observation_count INTEGER NOT NULL DEFAULT 1,
        first_observed TEXT NOT NULL,
        last_observed TEXT NOT NULL,
        last_confirmed TEXT NOT NULL,
        state TEXT NOT NULL,
        learner_visible INTEGER NOT NULL DEFAULT 1,
        learner_disputed INTEGER NOT NULL DEFAULT 0,
        dispute_note TEXT
      );

      CREATE TABLE IF NOT EXISTS intervention_outcomes (
        id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL,
        shape TEXT NOT NULL,
        node_id TEXT,
        criterion_id TEXT,
        hint_level_reached INTEGER NOT NULL,
        transfer_check_passed INTEGER NOT NULL,
        time_to_unassisted_success_s INTEGER,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_bindings (
        role TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model_id TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        overrides_json TEXT,
        fallback_model TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_calls (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        model_id TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        token_counts_json TEXT,
        failure_class TEXT,
        timestamp TEXT NOT NULL
      );
    `);

    // Record migration in ledger
    const now = new Date().toISOString();
    db.run(
      "INSERT INTO migration_ledger (version, description, applied_at, rule_recorded) VALUES (?, ?, ?, ?);",
      [1, "Initial schema v1 for three-mode assessment and teaching framework", now, "Rule: Migrated legacy questions and attempts deterministically into assessment_forms, items, attempts, and responses."]
    );

    db.run("PRAGMA user_version = 1;");
    db.run("COMMIT;");
  }

  if (currentVersion < 2) {
    db.run("BEGIN TRANSACTION;");

    // Per-session progressive-hint level consumed by the tutor harness.
    db.run(`ALTER TABLE chalkboard_sessions ADD COLUMN hint_level INTEGER NOT NULL DEFAULT 0;`);

    const v2Now = new Date().toISOString();
    db.run(
      "INSERT INTO migration_ledger (version, description, applied_at, rule_recorded) VALUES (?, ?, ?, ?);",
      [2, "Per-session hint_level for the tutor harness", v2Now, "Rule: chalkboard_sessions.hint_level tracks the unlocked progressive-hint level gating the tutor's disclosures."]
    );

    db.run("PRAGMA user_version = 2;");
    db.run("COMMIT;");
  }

  if (currentVersion < 3) {
    db.run("BEGIN TRANSACTION;");

    // Filesystem location of the source PDF. The browser single-file build has
    // no writable filesystem and so leaves this NULL; under Tauri the ingestion
    // path stores the absolute path so pdfium can re-open it for lazy per-node
    // rasterization + vision transcription of curriculum math.
    db.run(`ALTER TABLE curriculum_sources ADD COLUMN file_path TEXT;`);

    const v3Now = new Date().toISOString();
    db.run(
      "INSERT INTO migration_ledger (version, description, applied_at, rule_recorded) VALUES (?, ?, ?, ?);",
      [3, "curriculum_sources.file_path for pdfium-backed raster+transcribe", v3Now, "Rule: sources record the on-disk PDF path so nodes can be lazily rasterized and vision-transcribed into curriculum_chunks."]
    );

    db.run("PRAGMA user_version = 3;");
    db.run("COMMIT;");
  }

  if (currentVersion < 4) {
    db.run("BEGIN TRANSACTION;");

    // Boards themselves remain in the resumable study-session document, while
    // this compact ledger makes thread creation auditable alongside model calls
    // and chat messages. `board_id` links back to the persisted BoardDoc.
    db.run(`
      CREATE TABLE IF NOT EXISTS session_threads (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        parent_board_id TEXT,
        title TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES chalkboard_sessions(id) ON DELETE CASCADE,
        UNIQUE(session_id, board_id)
      );
    `);

    const v4Now = new Date().toISOString();
    db.run(
      "INSERT INTO migration_ledger (version, description, applied_at, rule_recorded) VALUES (?, ?, ?, ?);",
      [4, "Audit log for learner- and agent-created study threads", v4Now, "Rule: every spawned thread records its parent board, reason, creator, and timestamp under the owning chalkboard session."]
    );

    db.run("PRAGMA user_version = 4;");
    db.run("COMMIT;");
  }

  if (currentVersion < 5) {
    db.run("BEGIN TRANSACTION;");

    // The Guide to Mastery stage the session is currently teaching in, plus the
    // evidence that justified the last advance. Persisting the stage is what
    // makes advancement enforceable ACROSS turns: without it the tutor would
    // re-infer its position on the ladder every turn and could silently jump
    // stages, which is precisely the click-through failure the loop forbids.
    db.run(`ALTER TABLE chalkboard_sessions ADD COLUMN mastery_stage TEXT NOT NULL DEFAULT 'encounter';`);
    db.run(`ALTER TABLE chalkboard_sessions ADD COLUMN mastery_stage_evidence TEXT;`);

    const v5Now = new Date().toISOString();
    db.run(
      "INSERT INTO migration_ledger (version, description, applied_at, rule_recorded) VALUES (?, ?, ?, ?);",
      [5, "Per-session Guide to Mastery stage and advancement evidence", v5Now, "Rule: chalkboard_sessions.mastery_stage records the learner's position on the six-stage ladder, and mastery_stage_evidence records the observed exit condition that justified the last advance. A stage may only advance on recorded evidence, never on a learner click."]
    );

    db.run("PRAGMA user_version = 5;");
    db.run("COMMIT;");
  }

  // No legacy assessment fixtures are seeded in production. A fresh profile
  // starts with no forms/attempts so AvailableTests shows its empty state
  // (see plan §3 / verification: "Fresh profile shows no … seeded recent
  // sessions"). The single-authored IB Physics HL form + 3 questions + 2
  // attempts that integration tests exercise is available as
  // `seedLegacyData` for tests to call in their own setup.
}

/** Test-only: author the single physics form, three items, two attempts, and
 *  one graded response that the assessment state-machine tests exercise.
 *  Idempotent on a fresh DB. Not called from the production init path. */
export function seedLegacyData(db: Database) {
  // Check if legacy data forms exist
  const countRes = db.exec("SELECT COUNT(*) FROM assessment_forms;");
  const count = countRes[0]?.values[0]?.[0] as number ?? 0;
  if (count > 0) return;

  const now = new Date().toISOString();

  // Create default assessment form
  db.run(`
    INSERT INTO assessment_forms (id, title, subject, format, config_json, mode, curriculum_scope, generation_version, validation_status, feedback_policy, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    "form-physics-default",
    "IB Physics HL Practice Form",
    "physics",
    "mixed",
    JSON.stringify({ timeLimitMinutes: 30 }),
    "FORMATIVE",
    "mechanics.gravitation",
    "1.0.0",
    "validated",
    "immediate_criterion",
    now,
    now
  ]);

  // Seed default questions from legacy bank
  const legacyQuestions = [
    {
      id: "q1",
      ordinal: 1,
      type: "numeric",
      stem: "A satellite orbits Earth at radius r with speed v. If its orbital radius quadruples to 4r, by what factor does its orbital speed change?",
      maxMarks: 2,
      bloom: "apply",
      objective: "Gravitational orbits and velocity scaling",
      node: "1.1",
      spec: { version: 1, type: "numeric", accepted: [{ value: "0.5", absolute_tolerance: "0.01", relative_tolerance: "0" }], unit: null }
    },
    {
      id: "q2",
      ordinal: 2,
      type: "proof",
      stem: "Derive Kepler's Third Law (T^2 \\propto r^3) starting from Newton's Law of Universal Gravitation and centripetal acceleration.",
      maxMarks: 5,
      bloom: "analyze",
      objective: "Kepler's laws derivation",
      node: "1.1",
      spec: {
        version: 1,
        type: "rubric",
        criteria: [
          { id: "c1", description: "States gravitational force formula F_g = G*M*m / r^2", max_mark: 1 },
          { id: "c2", description: "Equates F_g to centripetal force m*v^2/r or m*w^2*r", max_mark: 2 },
          { id: "c3", description: "Substitutes v = 2*pi*r / T and simplifies to T^2 = (4*pi^2 / G*M)*r^3", max_mark: 2 }
        ]
      }
    },
    {
      id: "q3",
      ordinal: 3,
      type: "numeric",
      stem: "Evaluate derivative d/dx [sin(3x^2)] at x = 1.",
      maxMarks: 2,
      bloom: "apply",
      objective: "Chain rule differentiation",
      node: "1.2",
      spec: { version: 1, type: "numeric", accepted: [{ value: "6.0", absolute_tolerance: "0.01", relative_tolerance: "0" }], unit: null }
    }
  ];

  for (const q of legacyQuestions) {
    db.run(`
      INSERT INTO assessment_items (id, form_id, stable_ordinal, stem, item_type, maximum_marks, bloom_target, learning_objective, curriculum_node, answer_spec_json, provenance, generation_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `, [
      q.id,
      "form-physics-default",
      q.ordinal,
      q.stem,
      q.type,
      q.maxMarks,
      q.bloom,
      q.objective,
      q.node,
      JSON.stringify(q.spec),
      "legacy_seed",
      "1.0.0"
    ]);

    db.run(`
      INSERT INTO item_statistics (id, item_id, unassisted_correctness, assisted_correctness, hint_usage_count, response_timing_avg_ms, confidence_avg, transfer_performance, uncertainty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `, [`stat-${q.id}`, q.id, 0.75, 0.90, 1, 45000, 0.8, 0.85, 0.1]);
  }

  // Create default completed attempt
  db.run(`
    INSERT INTO assessment_attempts (id, form_id, learner_id, status, mode, assistance_policy, started_at, deadline_at, submitted_at, completed_at, current_ordinal, aggregate_score, grading_status, audit_created_at, audit_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    "attempt-legacy-1",
    "form-physics-default",
    "default_learner",
    "completed",
    "FORMATIVE",
    "progressive_hints",
    now,
    null,
    now,
    now,
    3,
    7.0,
    "graded",
    now,
    now
  ]);

  // Create default active attempt for taking/drafting tests
  db.run(`
    INSERT INTO assessment_attempts (id, form_id, learner_id, status, mode, assistance_policy, started_at, deadline_at, submitted_at, completed_at, current_ordinal, aggregate_score, grading_status, audit_created_at, audit_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    "attempt-active-1",
    "form-physics-default",
    "default_learner",
    "active",
    "FORMATIVE",
    "progressive_hints",
    now,
    null,
    null,
    null,
    1,
    0,
    "unseen",
    now,
    now
  ]);

  // Seed legacy responses
  db.run(`
    INSERT INTO attempt_responses (id, attempt_id, item_id, draft_response, committed_response, response_flags, confidence, latency_ms, response_status, grading_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, ["resp-legacy-q1", "attempt-legacy-1", "q1", "0.5", "0.5", "[]", 0.9, 12000, "committed", "graded"]);

  db.run(`
    INSERT INTO criterion_scores (id, response_id, stable_criterion_id, maximum_mark, awarded_mark, rationale, grader_confidence, uncertainty_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `, ["crit-legacy-q1-1", "resp-legacy-q1", "numeric_match", 2, 2, "Exact numeric value match 0.5", 1.0, "certain"]);

  saveDbSync();
}
