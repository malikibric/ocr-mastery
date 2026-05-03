import { Pool, type PoolClient } from "pg";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_IMPORT_STATE, type ImportState } from "@/lib/import-state";
import { getRequiredEnv } from "@/lib/env";
import { createEmptyExtractedData, getActiveDocumentData } from "@/lib/documents/defaults";
import {
  type DocumentStatus,
  type ExtractedDocumentData,
  type PersistDocumentInput,
  type PersistedDocument,
  type PersistedDocumentSummary,
  type ReviewEvent,
  type ReviewUpdateInput,
  type ValidationIssue
} from "@/lib/documents/types";

const UPLOAD_DIRECTORY = path.join(process.cwd(), "data", "uploads");
const ACTIVE_DOCUMENT_NUMBER_SQL =
  "COALESCE(corrected_json->>'documentNumber', extracted_json->>'documentNumber')";
const ACTIVE_CURRENCY_SQL =
  "COALESCE(corrected_json->>'currency', extracted_json->>'currency')";
const ACTIVE_TOTAL_SQL =
  "COALESCE(corrected_json->>'total', extracted_json->>'total')";
const ACTIVE_JSON_SQL = "COALESCE(corrected_json, extracted_json)";
const DATASET_IMPORT_ID = "dataset-import";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getRequiredEnv("DATABASE_URL"),
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
    });
  }
  return pool;
}

async function initSchema(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      source_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_extension TEXT NOT NULL,
      source_path TEXT NOT NULL,
      status TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      extracted_json JSONB NOT NULL,
      corrected_json JSONB,
      validation_json JSONB NOT NULL,
      processing_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS documents_status_idx ON documents(status);
    CREATE INDEX IF NOT EXISTS documents_number_idx
      ON documents((extracted_json->>'documentNumber'));
    CREATE INDEX IF NOT EXISTS documents_active_number_idx
      ON documents((COALESCE(corrected_json->>'documentNumber', extracted_json->>'documentNumber')));

    CREATE TABLE IF NOT EXISTS review_events (
      id BIGSERIAL PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id),
      action TEXT NOT NULL,
      payload_json JSONB NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      running BOOLEAN NOT NULL,
      total INTEGER NOT NULL,
      processed INTEGER NOT NULL,
      failed INTEGER NOT NULL,
      done BOOLEAN NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    ALTER TABLE review_events
      ADD COLUMN IF NOT EXISTS reviewer_email TEXT;

    ALTER TABLE review_events
      ADD COLUMN IF NOT EXISTS reviewer_name TEXT;
  `);
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = initSchema();
  }
  return schemaReady;
}

export function getUploadDirectory(): string {
  fs.mkdirSync(UPLOAD_DIRECTORY, { recursive: true });
  return UPLOAD_DIRECTORY;
}

type DocumentRow = {
  id: string;
  source_name: string;
  source_type: string;
  mime_type: string;
  file_extension: string;
  source_path: string;
  status: DocumentStatus;
  raw_text: string;
  extracted_json: ExtractedDocumentData;
  corrected_json: ExtractedDocumentData | null;
  validation_json: ValidationIssue[];
  processing_error: string | null;
  created_at: string;
  updated_at: string;
};

type DocumentSummaryRow = {
  id: string;
  source_name: string;
  source_type: string;
  mime_type: string;
  file_extension: string;
  status: DocumentStatus;
  validation_json: ValidationIssue[];
  processing_error: string | null;
  created_at: string;
  updated_at: string;
  active_json: ExtractedDocumentData | null;
};

type ImportStateRow = {
  id: string;
  running: boolean;
  total: number;
  processed: number;
  failed: number;
  done: boolean;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function mapDocument(row: DocumentRow): PersistedDocument {
  return {
    id: row.id,
    sourceName: row.source_name,
    sourceType: row.source_type as PersistedDocument["sourceType"],
    mimeType: row.mime_type,
    fileExtension: row.file_extension,
    sourcePath: row.source_path,
    status: row.status,
    rawText: row.raw_text,
    extractedData: row.extracted_json ?? createEmptyExtractedData(),
    correctedData: row.corrected_json,
    validationIssues: row.validation_json ?? [],
    processingError: row.processing_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDocumentSummary(row: DocumentSummaryRow): PersistedDocumentSummary {
  return {
    id: row.id,
    sourceName: row.source_name,
    sourceType: row.source_type as PersistedDocumentSummary["sourceType"],
    mimeType: row.mime_type,
    fileExtension: row.file_extension,
    status: row.status,
    processingError: row.processing_error,
    validationIssues: row.validation_json ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activeData: row.active_json ?? createEmptyExtractedData()
  };
}

function mapImportState(row?: ImportStateRow): ImportState {
  if (!row) {
    return { ...DEFAULT_IMPORT_STATE };
  }

  return {
    running: row.running,
    total: row.total,
    processed: row.processed,
    failed: row.failed,
    done: row.done,
    error: row.error
  };
}

async function writeImportState(
  state: ImportState,
  queryable: Queryable = getPool()
) {
  await ensureSchema();
  const now = new Date().toISOString();

  await queryable.query(
    `INSERT INTO import_jobs (
      id, running, total, processed, failed, done, error, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(id) DO UPDATE SET
      running = EXCLUDED.running,
      total = EXCLUDED.total,
      processed = EXCLUDED.processed,
      failed = EXCLUDED.failed,
      done = EXCLUDED.done,
      error = EXCLUDED.error,
      updated_at = EXCLUDED.updated_at`,
    [
      DATASET_IMPORT_ID,
      state.running,
      state.total,
      state.processed,
      state.failed,
      state.done,
      state.error,
      now,
      now
    ]
  );
}

export function toDocumentSummary(
  document: PersistedDocument
): PersistedDocumentSummary {
  return {
    id: document.id,
    sourceName: document.sourceName,
    sourceType: document.sourceType,
    mimeType: document.mimeType,
    fileExtension: document.fileExtension,
    status: document.status,
    processingError: document.processingError,
    validationIssues: document.validationIssues,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    activeData: getActiveDocumentData(document)
  };
}

export async function listDocuments(): Promise<PersistedDocument[]> {
  await ensureSchema();
  const result = await getPool().query<DocumentRow>(
    `SELECT
      id, source_name, source_type, mime_type, file_extension,
      source_path, status, raw_text, extracted_json, corrected_json,
      validation_json, processing_error, created_at, updated_at
    FROM documents
    ORDER BY updated_at DESC, created_at DESC`
  );
  return result.rows.map(mapDocument);
}

export async function listDocumentSummaries(): Promise<PersistedDocumentSummary[]> {
  await ensureSchema();
  const result = await getPool().query<DocumentSummaryRow>(
    `SELECT
      id, source_name, source_type, mime_type, file_extension,
      status, validation_json, processing_error, created_at, updated_at,
      ${ACTIVE_JSON_SQL} AS active_json
    FROM documents
    ORDER BY updated_at DESC, created_at DESC`
  );
  return result.rows.map(mapDocumentSummary);
}

export async function getDocumentById(
  id: string,
  queryable: Queryable = getPool()
): Promise<PersistedDocument | null> {
  await ensureSchema();
  const result = await queryable.query<DocumentRow>(
    `SELECT
       id, source_name, source_type, mime_type, file_extension,
       source_path, status, raw_text, extracted_json, corrected_json,
      validation_json, processing_error, created_at, updated_at
    FROM documents
    WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? mapDocument(result.rows[0]) : null;
}

export async function getSiblingDocuments(
  sourcePath: string,
  excludeId: string
): Promise<Pick<PersistedDocument, "id" | "sourceName">[]> {
  await ensureSchema();
  const result = await getPool().query<{ id: string; source_name: string }>(
    `SELECT id, source_name FROM documents
     WHERE source_path = $1 AND id != $2
     ORDER BY source_name ASC`,
    [sourcePath, excludeId]
  );
  return result.rows.map((r) => ({ id: r.id, sourceName: r.source_name }));
}

export async function saveProcessedDocument(
  input: PersistDocumentInput,
  queryable: Queryable = getPool()
): Promise<PersistedDocument | null> {
  await ensureSchema();
  const now = new Date().toISOString();
  const id = input.id ?? crypto.randomUUID();

  await queryable.query(
    `INSERT INTO documents (
      id, source_name, source_type, mime_type, file_extension,
      source_path, status, raw_text, extracted_json, corrected_json,
      validation_json, processing_error, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$13)
    ON CONFLICT(id) DO UPDATE SET
      source_name = EXCLUDED.source_name,
      source_type = EXCLUDED.source_type,
      mime_type = EXCLUDED.mime_type,
      file_extension = EXCLUDED.file_extension,
      source_path = EXCLUDED.source_path,
      status = EXCLUDED.status,
      raw_text = EXCLUDED.raw_text,
      extracted_json = EXCLUDED.extracted_json,
      corrected_json = NULL,
      validation_json = EXCLUDED.validation_json,
      processing_error = EXCLUDED.processing_error,
      updated_at = EXCLUDED.updated_at`,
    [
      id,
      input.sourceName,
      input.sourceType,
      input.mimeType,
      input.fileExtension,
      input.sourcePath,
      input.status,
      input.rawText,
      JSON.stringify(input.extractedData),
      JSON.stringify(input.validationIssues),
      input.processingError ?? null,
      now,
      now
    ]
  );

  return getDocumentById(id, queryable);
}

export async function saveReviewedDocument(
  input: ReviewUpdateInput,
  queryable: Queryable = getPool()
): Promise<PersistedDocument | null> {
  await ensureSchema();
  const now = new Date().toISOString();

  await queryable.query(
    `UPDATE documents
     SET corrected_json = $1,
         validation_json = $2,
        status = $3,
        updated_at = $4
    WHERE id = $5`,
    [JSON.stringify(input.correctedData), JSON.stringify(input.validationIssues), input.status, now, input.id]
  );

  await queryable.query(
    `INSERT INTO review_events (
      document_id, action, payload_json, reviewer_email, reviewer_name, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.id,
      "review_saved",
      JSON.stringify({
        correctedData: input.correctedData,
        validationIssues: input.validationIssues,
        status: input.status
      }),
      input.reviewerEmail,
      input.reviewerName,
      now
    ]
  );

  return getDocumentById(input.id, queryable);
}

export async function getDocumentCountsByStatus(): Promise<Record<DocumentStatus, number>> {
  await ensureSchema();
  const result = await getPool().query<{ status: DocumentStatus; count: string }>(
    `SELECT status, COUNT(*) as count FROM documents GROUP BY status`
  );

  const counts: Record<DocumentStatus, number> = {
    uploaded: 0,
    needs_review: 0,
    validated: 0,
    rejected: 0
  };

  for (const row of result.rows) {
    counts[row.status] = parseInt(row.count, 10);
  }

  return counts;
}

export async function findDocumentsByDocumentNumber(
  documentNumber: string,
  excludeId?: string,
  queryable: Queryable = getPool()
): Promise<PersistedDocument[]> {
  await ensureSchema();
  const result = await queryable.query<DocumentRow>(
    `SELECT
       id, source_name, source_type, mime_type, file_extension,
       source_path, status, raw_text, extracted_json, corrected_json,
      validation_json, processing_error, created_at, updated_at
    FROM documents
    WHERE ${ACTIVE_DOCUMENT_NUMBER_SQL} = $1
      AND ($2::text IS NULL OR id != $2)`,
    [documentNumber, excludeId ?? null]
  );
  return result.rows.map(mapDocument);
}

export async function withDocumentNumberTransaction<T>(
  documentNumber: string | null | undefined,
  callback: (queryable: Queryable) => Promise<T>
): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    if (documentNumber) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`document-number:${documentNumber}`]
      );
    }

    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listReviewEvents(documentId: string): Promise<ReviewEvent[]> {
  await ensureSchema();
  const result = await getPool().query<ReviewEvent>(
    `SELECT
       id,
       action,
       payload_json,
       reviewer_email,
       reviewer_name,
       created_at
     FROM review_events
     WHERE document_id = $1
     ORDER BY created_at DESC`,
    [documentId]
  );
  return result.rows;
}

export async function getTotalsByCurrency(): Promise<Array<{ currency: string; total: number }>> {
  await ensureSchema();
  const result = await getPool().query<{ currency: string; total: string }>(
    `SELECT
      ${ACTIVE_CURRENCY_SQL} AS currency,
      SUM((${ACTIVE_TOTAL_SQL})::numeric) AS total
    FROM documents
    WHERE ${ACTIVE_CURRENCY_SQL} IS NOT NULL
      AND ${ACTIVE_TOTAL_SQL} IS NOT NULL
    GROUP BY ${ACTIVE_CURRENCY_SQL}
    ORDER BY ${ACTIVE_CURRENCY_SQL}`
  );

  return result.rows.map((row) => ({
    currency: row.currency,
    total: Number.parseFloat(row.total)
  }));
}

export async function getImportState(): Promise<ImportState> {
  await ensureSchema();
  const result = await getPool().query<ImportStateRow>(
    `SELECT
      id, running, total, processed, failed, done, error, created_at, updated_at
    FROM import_jobs
    WHERE id = $1`,
    [DATASET_IMPORT_ID]
  );

  return mapImportState(result.rows[0]);
}

export async function startImportState(total: number): Promise<ImportState | null> {
  await ensureSchema();
  const now = new Date().toISOString();
  const result = await getPool().query<ImportStateRow>(
    `INSERT INTO import_jobs (
      id, running, total, processed, failed, done, error, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(id) DO UPDATE SET
      running = EXCLUDED.running,
      total = EXCLUDED.total,
      processed = EXCLUDED.processed,
      failed = EXCLUDED.failed,
      done = EXCLUDED.done,
      error = EXCLUDED.error,
      updated_at = EXCLUDED.updated_at
    WHERE NOT import_jobs.running
    RETURNING
      id, running, total, processed, failed, done, error, created_at, updated_at`,
    [DATASET_IMPORT_ID, true, total, 0, 0, false, null, now, now]
  );

  return result.rows[0] ? mapImportState(result.rows[0]) : null;
}

export async function updateImportStateProgress(
  processed: number,
  failed: number
): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `UPDATE import_jobs
     SET running = TRUE,
         processed = GREATEST(processed, $2),
         failed = GREATEST(failed, $3),
         done = FALSE,
         error = NULL,
         updated_at = $4
     WHERE id = $1`,
    [DATASET_IMPORT_ID, processed, failed, new Date().toISOString()]
  );
}

export async function completeImportState(): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `UPDATE import_jobs
     SET running = FALSE,
         done = TRUE,
         error = NULL,
         updated_at = $2
     WHERE id = $1`,
    [DATASET_IMPORT_ID, new Date().toISOString()]
  );
}

export async function failImportState(error: string): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `UPDATE import_jobs
     SET running = FALSE,
         done = TRUE,
         error = $2,
         updated_at = $3
     WHERE id = $1`,
    [DATASET_IMPORT_ID, error, new Date().toISOString()]
  );
}

export async function resetImportState(): Promise<void> {
  await writeImportState({ ...DEFAULT_IMPORT_STATE });
}

export async function clearDatasetDocuments(): Promise<number> {
  await ensureSchema();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const idsResult = await client.query<{ id: string }>(
      `SELECT id
       FROM documents
       WHERE source_type = 'dataset'`
    );

    if (idsResult.rows.length > 0) {
      const ids = idsResult.rows.map((row) => row.id);
      await client.query(
        `DELETE FROM review_events
         WHERE document_id = ANY($1::text[])`,
        [ids]
      );
      await client.query(
        `DELETE FROM documents
         WHERE id = ANY($1::text[])`,
        [ids]
      );
    }

    await client.query("COMMIT");
    return idsResult.rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteDatasetDocumentsBySourcePathExcept(
  sourcePath: string,
  keepIds: string[]
): Promise<number> {
  await ensureSchema();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const idsResult = await client.query<{ id: string }>(
      `SELECT id
       FROM documents
       WHERE source_type = 'dataset'
         AND source_path = $1
         AND NOT (id = ANY($2::text[]))`,
      [sourcePath, keepIds]
    );

    if (idsResult.rows.length > 0) {
      const ids = idsResult.rows.map((row) => row.id);
      await client.query(
        `DELETE FROM review_events
         WHERE document_id = ANY($1::text[])`,
        [ids]
      );
      await client.query(
        `DELETE FROM documents
         WHERE id = ANY($1::text[])`,
        [ids]
      );
    }

    await client.query("COMMIT");
    return idsResult.rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteDocumentById(id: string): Promise<PersistedDocument | null> {
  await ensureSchema();
  const client = await getPool().connect();
  let deletedDocument: PersistedDocument | null = null;
  let shouldDeleteSourceFile = false;

  try {
    await client.query("BEGIN");

    const documentResult = await client.query<DocumentRow>(
      `SELECT
         id, source_name, source_type, mime_type, file_extension,
         source_path, status, raw_text, extracted_json, corrected_json,
         validation_json, processing_error, created_at, updated_at
       FROM documents
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    const row = documentResult.rows[0];

    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }

    const document = mapDocument(row);
    const siblingCountResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM documents
       WHERE source_path = $1 AND id != $2`,
      [document.sourcePath, document.id]
    );

    await client.query(
      `DELETE FROM review_events
       WHERE document_id = $1`,
      [document.id]
    );
    await client.query(
      `DELETE FROM documents
       WHERE id = $1`,
      [document.id]
    );
    await client.query("COMMIT");

    const hasSiblingDocuments =
      Number.parseInt(siblingCountResult.rows[0]?.count ?? "0", 10) > 0;
    deletedDocument = document;
    shouldDeleteSourceFile =
      document.sourceType === "upload" && !hasSiblingDocuments;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (
    deletedDocument &&
    shouldDeleteSourceFile &&
    fs.existsSync(deletedDocument.sourcePath)
  ) {
    await fs.promises.unlink(deletedDocument.sourcePath);
  }

  return deletedDocument;
}

export async function clearAllDocuments(): Promise<void> {
  await ensureSchema();
  await getPool().query("DELETE FROM review_events");
  await getPool().query("DELETE FROM documents");
}
