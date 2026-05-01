import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import { createEmptyExtractedData, getActiveDocumentData } from "@/lib/documents/defaults";
import {
  type DocumentStatus,
  type ExtractedDocumentData,
  type PersistDocumentInput,
  type PersistedDocument,
  type ReviewUpdateInput,
  type ValidationIssue
} from "@/lib/documents/types";

const UPLOAD_DIRECTORY = path.join(process.cwd(), "data", "uploads");

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
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

    CREATE TABLE IF NOT EXISTS review_events (
      id BIGSERIAL PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id),
      action TEXT NOT NULL,
      payload_json JSONB NOT NULL,
      created_at TEXT NOT NULL
    );
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

export async function getDocumentById(id: string): Promise<PersistedDocument | null> {
  await ensureSchema();
  const result = await getPool().query<DocumentRow>(
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

export async function saveProcessedDocument(input: PersistDocumentInput): Promise<PersistedDocument | null> {
  await ensureSchema();
  const now = new Date().toISOString();
  const id = input.id ?? crypto.randomUUID();

  await getPool().query(
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

  return getDocumentById(id);
}

export async function saveReviewedDocument(input: ReviewUpdateInput): Promise<PersistedDocument | null> {
  await ensureSchema();
  const now = new Date().toISOString();

  await getPool().query(
    `UPDATE documents
    SET corrected_json = $1,
        validation_json = $2,
        status = $3,
        updated_at = $4
    WHERE id = $5`,
    [JSON.stringify(input.correctedData), JSON.stringify(input.validationIssues), input.status, now, input.id]
  );

  await getPool().query(
    `INSERT INTO review_events (document_id, action, payload_json, created_at)
    VALUES ($1, $2, $3, $4)`,
    [
      input.id,
      "review_saved",
      JSON.stringify({ correctedData: input.correctedData, validationIssues: input.validationIssues, status: input.status }),
      now
    ]
  );

  return getDocumentById(input.id);
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
  excludeId?: string
): Promise<PersistedDocument[]> {
  await ensureSchema();
  const result = await getPool().query<DocumentRow>(
    `SELECT
      id, source_name, source_type, mime_type, file_extension,
      source_path, status, raw_text, extracted_json, corrected_json,
      validation_json, processing_error, created_at, updated_at
    FROM documents
    WHERE extracted_json->>'documentNumber' = $1
      AND ($2::text IS NULL OR id != $2)`,
    [documentNumber, excludeId ?? null]
  );
  return result.rows.map(mapDocument);
}

export async function listReviewEvents(documentId: string) {
  await ensureSchema();
  const result = await getPool().query<{
    id: number;
    action: string;
    payload_json: object;
    created_at: string;
  }>(
    `SELECT id, action, payload_json, created_at
    FROM review_events
    WHERE document_id = $1
    ORDER BY created_at DESC`,
    [documentId]
  );
  return result.rows;
}

export async function getTotalsByCurrency(): Promise<Array<{ currency: string; total: number }>> {
  const documents = await listDocuments();
  const totals = new Map<string, number>();

  for (const document of documents) {
    const activeData = getActiveDocumentData(document);
    if (!activeData.currency || activeData.total === null) continue;
    totals.set(activeData.currency, (totals.get(activeData.currency) ?? 0) + activeData.total);
  }

  return [...totals.entries()].map(([currency, total]) => ({ currency, total }));
}

export async function clearAllDocuments(): Promise<void> {
  await ensureSchema();
  await getPool().query("DELETE FROM review_events");
  await getPool().query("DELETE FROM documents");
}
