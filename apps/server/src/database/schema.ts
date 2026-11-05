import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Directory name inside PROJECTS_DIR — never an absolute path.
    directory: text("directory").notNull(),
    language: text("language").notNull(),
    metadataJson: text("metadata_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("projects_directory_unique").on(table.directory)],
);

export const debugSessions = sqliteTable(
  "debug_sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("debug_sessions_project_idx").on(table.projectId, table.updatedAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => debugSessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    // Set on assistant messages that carry a diagnosis.
    diagnosisId: text("diagnosis_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("messages_session_idx").on(table.sessionId, table.createdAt)],
);

// Observed evidence, exactly as read from the project. The id is derived from
// path, range and content, so it is stable for identical excerpts.
export const evidence = sqliteTable(
  "evidence",
  {
    id: text("id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => debugSessions.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    relativePath: text("relative_path").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    excerpt: text("excerpt").notNull(),
    description: text("description").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.id] })],
);

// AI hypotheses. Never a verified result.
export const diagnoses = sqliteTable(
  "diagnoses",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => debugSessions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    likelyCause: text("likely_cause"),
    confidence: text("confidence"),
    uncertainty: text("uncertainty"),
    suggestedFix: text("suggested_fix"),
    limitationsJson: text("limitations_json").notNull(),
    clarifyingQuestionsJson: text("clarifying_questions_json").notNull(),
    evidenceIdsJson: text("evidence_ids_json").notNull(),
    // Evidence ids the model cited that were not in the provided context.
    rejectedEvidenceIdsJson: text("rejected_evidence_ids_json").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("diagnoses_session_idx").on(table.sessionId, table.createdAt)],
);

// A proposed code change. Stores full before/after content of the changed
// files only, so the diff can be shown and an applied patch reverted.
export const patchProposals = sqliteTable(
  "patch_proposals",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => debugSessions.id, { onDelete: "cascade" }),
    diagnosisId: text("diagnosis_id")
      .notNull()
      .references(() => diagnoses.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    explanation: text("explanation").notNull(),
    // JSON array of { path, summary, originalContent, proposedContent,
    // originalHash, proposedHash, diff, additions, deletions }.
    filesJson: text("files_json").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    createdAt: text("created_at").notNull(),
    approvedAt: text("approved_at"),
    appliedAt: text("applied_at"),
    rejectedAt: text("rejected_at"),
    revertedAt: text("reverted_at"),
    applicationResult: text("application_result"),
  },
  (table) => [index("patch_proposals_session_idx").on(table.sessionId, table.createdAt)],
);

// A real execution of an allowed project command. Output is capped.
export const verificationRuns = sqliteTable(
  "verification_runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => debugSessions.id, { onDelete: "cascade" }),
    // The patch that was applied when the run started, if any.
    patchId: text("patch_id").references(() => patchProposals.id, { onDelete: "set null" }),
    script: text("script").notNull(),
    commandLabel: text("command_label").notNull(),
    status: text("status").notNull(),
    exitCode: integer("exit_code"),
    signal: text("signal"),
    stdout: text("stdout").notNull(),
    stderr: text("stderr").notNull(),
    outputTruncated: integer("output_truncated", { mode: "boolean" }).notNull(),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [index("verification_runs_session_idx").on(table.sessionId, table.startedAt)],
);

// A developer-provided screenshot and the regions SAM 3.1 found in it. The
// image itself is stored on disk under SCREENSHOTS_DIR as `<id>.<ext>`.
export const screenshots = sqliteTable(
  "screenshots",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => debugSessions.id, { onDelete: "cascade" }),
    phrase: text("phrase").notNull(),
    fileName: text("file_name"),
    mimeType: text("mime_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    regionsJson: text("regions_json").notNull(),
    model: text("model").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("screenshots_session_idx").on(table.sessionId, table.createdAt)],
);

/** Images attached to a user message. The bytes live in the screenshots directory. */
export const messageImages = sqliteTable(
  "message_images",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => debugSessions.id, { onDelete: "cascade" }),
    fileName: text("file_name"),
    mimeType: text("mime_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("message_images_message_idx").on(table.messageId)],
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type DebugSessionRow = typeof debugSessions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type EvidenceRow = typeof evidence.$inferSelect;
export type DiagnosisRow = typeof diagnoses.$inferSelect;
export type PatchProposalRow = typeof patchProposals.$inferSelect;
export type VerificationRunRow = typeof verificationRuns.$inferSelect;
export type ScreenshotRow = typeof screenshots.$inferSelect;
export type MessageImageRow = typeof messageImages.$inferSelect;
