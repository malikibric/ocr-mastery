# Copilot Instructions

## Build, test, and lint commands

- `npm run dev` starts the Next.js 15 app locally.
- `npm run build` creates a production build and then runs `scripts/fix-next-server-chunks.mjs`.
- `npm run start` serves the production build.
- `npm run lint` runs `next lint`.
- `npm run test` runs the Vitest suite in `src/__tests__/`.
- `npm run test -- src/__tests__/validation.test.ts` runs a single test file.
- `npm run test -- -t "flags duplicate document number"` runs a single named test.

## High-level architecture

- This is a Next.js App Router application. The main dashboard lives in `src/app/page.tsx`, the document review screen lives in `src/app/documents/[id]/page.tsx`, server actions live in `src/app/actions.ts`, and JSON endpoints under `src/app/api/**` expose the same document state plus dataset-import progress.
- Document processing flows through `src/lib/documents/pipeline.ts`: detect file type, extract raw text in `extraction.ts`, parse structured fields in `parsing.ts`, validate in `validation.ts`, then persist through `src/lib/database.ts`.
- CSV and TXT files are parsed in-process, but PDF and image extraction are intentionally delegated to `scripts/extract-pdf-text.mjs` and `scripts/extract-image-text.cjs` via `execFile`. Keep that boundary unless the worker-library bundling issue is solved.
- Persistence is PostgreSQL via `pg`, not SQLite. `src/lib/database.ts` initializes `documents` and `review_events` tables with JSONB columns for extracted data, corrected data, and validation issues. Local infrastructure is defined in `docker-compose.yml`, and app code expects `DATABASE_URL`.
- Uploads and dataset imports share the same persistence model. Uploaded files are stored under `data/uploads/`; dataset imports read from `resources/`. Image OCR uploads may be split into multiple logical documents by layout-aware OCR in `image-layout.ts` and then text fallback splitting, which is why one upload can create sibling records for the same source file.
- The app keeps both machine output and reviewer edits. `extractedData` is the original parse, `correctedData` is the reviewer version, and anything that displays “current” document data should use `getActiveDocumentData(document)`.

## Key conventions

- Treat `src/lib/documents/types.ts` as the canonical domain contract. If a field, status, or validation shape changes, update the types first and then follow the impact through parsing, validation, persistence, UI, and API routes.
- Do not read `document.extractedData` directly for user-facing views or API payloads that represent the current document state. Use `getActiveDocumentData(document)` so corrected review data overrides extracted data consistently.
- Re-run `validateExtractedData` whenever extracted or corrected document data changes. Validation is async because duplicate document numbers are checked against persisted records.
- Dataset imports are intentionally idempotent. `pipeline.ts` generates stable IDs as `dataset-<sanitized filename>`, and `saveProcessedDocument` upserts on document ID so re-importing `resources/` updates existing rows instead of duplicating them.
- Review edits should preserve the original extraction. Save reviewer changes into `correctedData`, persist the refreshed `validationIssues`, and append to `review_events` rather than mutating the original extracted payload.
- Review status transitions are opinionated: ingestion uses `uploaded` when there are no error-severity issues and `needs_review` otherwise; manual “Mark validated” only reaches `validated` when there are no errors; a plain save with no errors returns the document to `uploaded`; reject sets `rejected`.
- The line-item editor uses a pipe-delimited text format (`description | qty | unit price | total`) through `parseLineItemsEditorText` and `serializeLineItemsEditorText`. Reuse those helpers instead of inventing a new review payload format.
- `company_details` is a real document type, not just a UI label. Parsing/validation intentionally treat it differently from invoices and purchase orders.
- The review page shows sibling tabs below the file preview when one uploaded image is split into multiple documents. For the known collage screenshot `Screenshot 2026-04-28 at 18.26.01.png`, expected behavior is 3 tabs.
- The sample dataset is intentionally messy. Many imports landing in `needs_review` is expected behavior, especially when supplier, currency, or totals are incomplete.
