# Smart Document Processing System

A Next.js 15 document review app that ingests invoices and purchase orders from uploads or the bundled dataset, extracts structured fields, validates the result, persists review history in PostgreSQL, and exposes both a review UI and JSON API.

## Stack

- Next.js 15 App Router
- React 19 + TypeScript
- PostgreSQL via `pg`
- Vitest for unit and route/server-action tests
- `pdfjs-dist` and `tesseract.js` via helper scripts under `scripts/`
- Docker Compose for local Postgres + production-style app startup

## What the app does

- Accepts PDF, image, CSV, and TXT documents
- Imports the bundled `resources/` dataset or processes manual uploads
- Extracts document type, supplier, number, dates, currency, line items, subtotal, tax, and total
- Recognizes `company_details` screenshots where `Organization` maps to supplier/company and `Customer Number (MCL)` maps to the document number
- Splits some multi-document image uploads into sibling review records, including collage-style layouts with two documents on top and one below
- Validates missing fields, invalid dates, line-item math, totals, and duplicate document numbers
- Stores original extraction, reviewer corrections, validation findings, and review events
- Supports the workflow `uploaded -> needs_review -> validated|rejected`
- Shows a dashboard with document list, issue counts, and totals by currency

## Prerequisites

- Node.js 22+
- npm
- PostgreSQL 16+ or Docker

### Native Tesseract OCR

Image OCR uses the native Tesseract engine (https://github.com/tesseract-ocr/tesseract), not a WASM build.

- macOS: `brew install tesseract`
- Debian/Ubuntu: `sudo apt-get install tesseract-ocr`
- Verify: `tesseract --version` (must be 5.x).

Only the English model is shipped (`eng.traineddata` at the repo root); it is loaded via `--tessdata-dir`. No `TESSDATA_PREFIX` env var is required.

## Environment

Create `.env.local` with at least:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mastery_task
FILE_ACCESS_SECRET=replace-me-for-non-local-use
REVIEWER_EMAIL=reviewer@example.com
REVIEWER_PASSWORD=replace-me
```

- `DATABASE_URL` is required by the app.
- `DATABASE_URL` and `FILE_ACCESS_SECRET` now fail fast with a clear startup error when they are missing outside local development.
- `FILE_ACCESS_SECRET` signs preview/download URLs for original uploaded files. For local development it may still be omitted; production and other non-local environments must set it explicitly.
- Reviewer authentication uses Auth.js credentials. `REVIEWER_EMAIL` and `REVIEWER_PASSWORD` should be set for deployed environments; local dev/test falls back to `reviewer@example.com` / `local-reviewer-password`.
- Uploads are capped at 10 MB per file, and binary uploads are verified against their file signatures instead of trusting the filename alone.

## Install

```bash
npm install
```

## Run locally

1. Start PostgreSQL, either with Docker Compose:

   ```bash
   docker compose up db -d
   ```

   or with your own local Postgres instance.

2. Start the app:

   ```bash
   npm run dev
   ```

3. Open `http://localhost:3000`.

## Production build

```bash
npm run build
npm run start
```

`npm run build` runs `next build` and then `scripts/fix-next-server-chunks.mjs`.

## Tests and linting

```bash
npm run test
npm run test -- src/__tests__/validation.test.ts
npm run test -- -t "flags duplicate document number"
npm run lint
```

## Docker Compose

Run the full stack with:

```bash
docker compose up --build
```

The compose setup starts:

- `db` on `localhost:5432`
- `app` on `http://localhost:3000`

The app container now sets local-only reviewer credentials and a file-access secret so the production-mode compose stack can boot without extra manual env wiring.

## Architecture overview

### App surface

- `src/app/page.tsx` renders the dashboard and upload/import entry points
- `src/app/documents/[id]/page.tsx` renders the review screen
- `src/app/actions.ts` holds server actions for upload, import, and review save/validate/reject flows
- `src/app/api/**` exposes JSON endpoints and the OpenAPI document

### Document pipeline

`src/lib/documents/pipeline.ts` orchestrates the flow:

1. Detect file type
2. Extract raw text in `extraction.ts`
3. Parse structured fields in `parsing.ts`
4. Validate with `validation.ts`
5. Persist through `src/lib/database.ts`

CSV and TXT parsing stay in-process. PDF and image extraction intentionally run through helper scripts:

- `scripts/extract-pdf-text.mjs`
- `scripts/extract-image-text.cjs`
- `scripts/extract-image-layout.cjs`

That boundary exists because the PDF/OCR worker libraries were unreliable inside the Next.js server bundle.

For image uploads, `pipeline.ts` now tries layout-aware OCR splitting before falling back to plain OCR text splitting. That is what enables one uploaded screenshot to open as multiple review tabs when OCR can separate the documents spatially.

### Persistence model

`src/lib/database.ts` initializes and queries PostgreSQL tables for:

- `documents`
- `review_events`
- `import_jobs`

The app stores:

- raw extracted text
- original machine extraction
- reviewer-corrected data
- validation issues
- processing errors
- review history
- dataset import progress

### Active document data

User-facing views should treat corrected reviewer data as the source of truth. `getActiveDocumentData(document)` returns:

```ts
document.correctedData ?? document.extractedData
```

## API

- `GET /api/documents` — document summaries with active data
- `GET /api/documents/:id` — a single document summary, review events, and a signed file URL
- `GET /api/documents/:id/file?expires=...&token=...` — serves the original file when the signed query params are valid
- `GET /api/documents/import` — current dataset-import job state
- `POST /api/documents/import` — starts dataset import from `resources/`
- `GET /api/docs` — OpenAPI document for the current API
- `GET /api/health` — unauthenticated dependency health check for PostgreSQL and the local `tesseract` binary

All `/api/documents*` routes, the dashboard, the document-review page, and the server actions are reviewer-authenticated.

## Review workflow notes

- Ingestion sets status to `uploaded` only when there are no error-severity validation issues; otherwise it starts at `needs_review`.
- “Save corrections” keeps the document in `needs_review`.
- “Mark validated” only reaches `validated` when no validation errors remain.
- “Reject document” sets `rejected`.
- Clearing a numeric field in the review form now persists `null` instead of silently restoring the old value.
- The review screen renders the original file preview plus sibling document tabs below it when one upload is split into multiple logical documents.

## Current OCR/review status

- Public document APIs are reduced to summaries, and original file access uses signed URLs.
- Dataset import progress is persisted in PostgreSQL instead of process memory.
- OCR parsing includes a dedicated `company_details` flow for admin-style screenshots.
- Multi-document image OCR supports a layout-specific `2 top + 1 bottom` split path. The screenshot `Screenshot 2026-04-28 at 18.26.01.png` now produces 3 review documents instead of 2.
- OCR is still the main weak area for very noisy screenshots: splitting is better, but extracted field quality can still need manual reviewer correction.

## Notes on the sample dataset

The bundled `resources/` files are intentionally messy. It is normal for many imports to land in `needs_review`, especially when supplier data, currency, totals, or OCR quality are incomplete.

## AI usage

AI assistance was used during implementation, but the extraction rules, validation logic, application structure, and debugging decisions were reviewed and adjusted manually.

## Deployment status

The app builds cleanly in this workspace, but **no public deployment link is configured in the repository**. The remaining deployment step is to provision PostgreSQL, set `DATABASE_URL`/`FILE_ACCESS_SECRET`, and deploy the app to a Node-compatible host such as Vercel, Render, Railway, or Fly.io.

For container builds, `.dockerignore` now keeps local `.env.local`, `.next`, `node_modules`, and uploaded files out of the image context, and the runtime image installs `tesseract-ocr` explicitly.

## Improvements still worth doing

1. Add end-to-end browser coverage for upload, import, and review flows.
2. Improve field extraction quality for weak/noisy OCR blocks after multi-document image splitting.
3. Expose richer operational metrics beyond the lightweight `/api/health` dependency check.
4. Revisit the `file-type` bundling warning if the upload-type detection path moves deeper into the Next.js server bundle.
