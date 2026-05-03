# Project Audit — Smart Document Processing System

> Date: 2026-05-03
> Scope: full repo
> Method: static analysis + test coverage review

## Executive Summary

- The pipeline (extraction → parsing → validation → persistence) is well-modularized and the OCR layout splitter is genuinely thoughtful. PostgreSQL-backed import-state and signed file URLs are wins over earlier in-memory designs.
- **Top risks**: (1) zero authentication anywhere — every API and review action is fully public; (2) the dataset import endpoint runs a long-lived background job inside the request handler with no locking, no idempotency, and no guarantee of survival across serverless invocations; (3) the file-access HMAC defaults to a hard-coded secret when `FILE_ACCESS_SECRET` is unset — including in production code paths if env is forgotten.
- **Top opportunities**: (1) introduce auth + reviewer identity (also addresses audit gap noted in README); (2) replace ad-hoc background processing with a real queue or at minimum proper job/lock semantics; (3) tighten file/path handling, MIME validation, and uploaded-file lifecycle (orphan cleanup, size limits, anti-traversal).
- Test coverage exists for parsing/validation/route-shape but skips the database layer entirely, the layout-aware OCR pipeline orchestration, and there is no E2E test of the upload flow. Many critical paths are mocked away.
- The OCR pipeline is fragile: single-language ENG, single PSM per script, no confidence-based fallback, heavy reliance on hand-tuned heuristics with magic numbers and no telemetry.

## Findings by Severity

### P0 — Critical

1. **No authentication / authorization on any route or action** — all of `/api/documents/*`, `/api/documents/import`, all server actions (upload, delete, review save). Anyone with the URL can read every document, mutate review state, delete uploads, or trigger reimports. (`src/app/api/**`, `src/app/actions.ts`)
2. **Insecure default `FILE_ACCESS_SECRET`** (`src/lib/documents/file-access.ts:3-4`). Falls back to literal `"local-development-only-secret"` when env unset. If deployed without the env var (and there is no startup check), every signed URL is forgeable. README mentions setting it but nothing enforces it.
3. **`getDocumentById` in file route serves any local file by `sourcePath`** (`src/app/api/documents/[id]/file/route.ts:22-33`). `sourcePath` is whatever was stored at ingest. For dataset documents this is `process.cwd()/resources/...`; for uploads it is `data/uploads/...`. There is no containment check that `document.sourcePath` is inside an allowed directory, so if `sourcePath` were ever influenced by user input or a future migration, arbitrary file read is possible. Defense-in-depth missing.
4. **Background import survives the request but is not safe across instances/restarts** (`src/app/api/documents/import/route.ts:39-49`). `importDatasetDocuments` is started with `void` after returning the response. (a) On serverless platforms (the README suggests Vercel) the runtime will terminate after the response is sent and silently drop the job. (b) On a multi-instance host there is no DB-level lock — `current.running` check is TOCTOU. Two simultaneous POSTs both observe `running:false` and both start workers writing the same `dataset-...` ids and `import_jobs` row.
5. **`parseReviewedNumericField` throws raw `Error` from a server action** (`src/app/actions.ts:50-62`, used at lines 123-125). In Next.js 15 server actions, an uncaught throw is shown to the user as a generic error and there is no `try/catch` or `useFormState` wiring on the review page. A reviewer typing a non-numeric subtotal sees a 500 page; the reviewed correctedData (and any other valid edits) are lost.
6. **`saveProcessedDocument` UPSERT does NOT update `corrected_json`** (`src/lib/database.ts:309-321`). Re-importing a dataset document blows away `extracted_json` and re-runs validation, but leaves `corrected_json` untouched (intentional or accidental?). Combined with the `corrected_json` survival, the active data after a re-import may show fields that no longer correspond to the new extraction. This is silent data divergence.
7. **`clearAllDocuments` exists and is exported** (`src/lib/database.ts:614-618`) but appears unused in production code. If called via any future debug path, it wipes everything. More urgently, `clearDatasetDocuments` (`:508-542`) deletes documents but does NOT delete uploaded files from `data/uploads/` — but dataset files live in `resources/`, not uploads, so OK. However, `deleteDocumentById` (`:544-612`) deletes the source file based on `sourceType === "upload"`. The transaction commits BEFORE the file is removed (`:589` then `:608`), so a crash between commit and unlink leaves an orphaned file forever. No reconciliation job exists.

### P1 — Significant

8. **`saveProcessedDocument` UPDATE clause omits `corrected_json` and `id` fields** (intentional?) but also omits **status reset**. If a document was previously `validated` and is re-imported via dataset re-run, status is overwritten with `getInitialStatus(hasErrors)` which is always `uploaded`/`needs_review`. Reviewer's earlier `validated` decision is silently lost. (`src/lib/documents/pipeline.ts:230-241`, `src/lib/database.ts:309-321`)
9. **Duplicate-document-number check is a TOCTOU race during concurrent import** (`src/lib/documents/validation.ts:166-180` + `src/lib/documents/pipeline.ts:285` `Promise.all` inside `importDatasetDocuments` with `CONCURRENCY=2`). Two concurrent inserts of the same document number both see no prior duplicate and both insert; neither flags the issue. No DB unique constraint.
10. **No DB unique constraint on `documents.id`-equivalent keys** beyond PK; the `dataset-<sanitized>` id strategy collides across files with names that differ only in non-alphanumerics (e.g. `Foo Bar.pdf` and `Foo-Bar.pdf` both become `dataset-foo-bar.pdf`). (`src/lib/documents/pipeline.ts:200-206`)
11. **Long-running OCR jobs hold DB connection during awaits unnecessarily** — but more critically, `getPool()` initializes a `Pool` with default settings (no `max` set, default 10). Under heavy import concurrency or many simultaneous browser polls (`ImportDatasetPanel` polls every 1s), connections can exhaust. (`src/lib/database.ts:30-38`)
12. **`importDatasetDocuments` ignores rejection inside batch** — `Promise.all` will reject whole batch if any one promise rejects. `processDocumentFile` is supposed to swallow errors, but `saveProcessedDocument` failures (DB down) inside the catch (`src/lib/documents/pipeline.ts:260-263`) are silently dropped, leaving a `null` in `results` and `processed`/`failed` counts inconsistent with reality.
13. **`writeImportState` ignores the in-flight state machine and always writes id `dataset-import`** — `updateImportStateProgress` does `await getImportState()` then `await writeImportState({...})`. With CONCURRENCY=2 and `void updateImportStateProgress(...)` from the import callback (`src/app/api/documents/import/route.ts:41`), there is a write-write race where stale `processed` overwrites a newer one. (`src/lib/database.ts:466-480`)
14. **No file-size limit enforcement on uploads** beyond the implicit Next.js 20 MB body limit (`next.config.ts:5-7`). Tesseract OCR on a 19 MB image will block the helper script for the full 60 s timeout. No validation of dimensions, page count (PDF), or actual MIME (only checks file extension, `src/lib/documents/file-types.ts:9`).
15. **MIME type derived only from filename extension** (`src/lib/documents/file-types.ts:13-31`). A user can upload a `.pdf` containing arbitrary bytes; it will be saved with `application/pdf` mime, served back with that header — XSS via mismatched content. No content sniffing.
16. **`storeUploadedFile` uses `Date.now()` for filename uniqueness** (`src/lib/documents/pipeline.ts:458`). Two concurrent uploads in the same millisecond collide and one overwrites the other.
17. **No `Content-Disposition: attachment` on the file route** (`src/app/api/documents/[id]/file/route.ts:35-40`). PDFs and images are rendered inline in iframes, but a malicious user uploading SVG-as-PNG or PDF-with-embedded-JS could exploit browser viewers (PDF JavaScript). Add `X-Content-Type-Options: nosniff`.
18. **`FilePreview` for `text/plain`/`text/csv` puts user-controlled file in an iframe** (`src/components/file-preview.tsx:50-58`). Same-origin iframe of arbitrary text — but a `.txt` upload is served as `text/plain`, which most browsers won't execute. However the file route lacks `X-Content-Type-Options: nosniff`, so a `.txt` containing `<script>` could be sniffed as HTML in some clients.
19. **PDF extraction trusts `pdfjs-dist` parsing of arbitrary user PDFs** (`scripts/extract-pdf-text.mjs`). pdfjs has had CVEs around malformed fonts; running it inside the Next runtime would be worse, but the helper script still inherits the same vulnerability.
20. **Helper script execution is shell-safe (`execFile`) but uses `process.cwd()` to locate scripts** (`src/lib/documents/extraction.ts:32`). If the working directory ever differs from project root (worker, test harness, packaged binary), extraction silently fails. `path.join(__dirname, ...)` would be safer.
21. **`scripts/extract-image-text.cjs` writes preprocessed temp file with `${process.pid}_${Date.now()}` only** (`scripts/extract-image-text.cjs:10`, `scripts/extract-image-layout.cjs:10`). On concurrent OCR calls in the same ms in the same process this collides. Same for `extractCroppedImageText`'s `Math.random` suffix is fine, but inconsistent across helpers.
22. **`extractRawText`'s 60-second `execFile` timeout** (`src/lib/documents/extraction.ts:36`) does not propagate through `extractCroppedImageText` (`src/lib/documents/extraction.ts:47-93`) for the multiple sequential OCR calls — a single uploaded image with 4 blocks can block for 4×60s.
23. **`createDocumentFileUrl` returns relative URL `/api/...`** (`src/lib/documents/file-access.ts:13-22`), passed into `<img>`/`<iframe>` — fine for SSR same-origin, but downstream consumers of the API (`/api/documents/:id`) get a relative path with no host context.
24. **`hasValidDocumentFileAccess` does not include the URL host or path in the HMAC** (`src/lib/documents/file-access.ts:7-11`). A token signed for `documentId=A` is only valid for that ID, but if URL params are reordered or extra params added, it still passes. Consider including a fixed canonical string and an algorithm-version byte.
25. **No CSRF protection on server actions** — Next.js server actions have built-in same-origin checks, but the `POST/DELETE` routes under `/api/documents/import` and `/api/documents/[id]/file` have no CSRF, no auth, and no rate-limit. Combined with #1 this is a one-click data-wipe vulnerability.
26. **No rate limiting anywhere** — including the OCR pipeline. A small loop of `/api/documents/import` POSTs would queue endless background work.
27. **`getInitialStatus` always returns `uploaded` when no errors** (`src/lib/documents/pipeline.ts:29-31`) but the README states ingestion sets `uploaded` only "when there are no error-severity validation issues; otherwise it starts at `needs_review`". This is mostly correct, but a document with only warnings is auto-`uploaded`, which means it bypasses review even though the system flagged warnings (e.g. unknown document type). Probably should default to `needs_review` if any issues exist.
28. **`validateExtractedData` `validate-then-upsert` window** — for new documents, `validateExtractedData` is called before insert (`src/lib/documents/pipeline.ts:224-230`). Duplicate detection therefore searches for documents that don't yet include the row being inserted, which is correct, but for re-imports of an existing document with the same id (`buildDatasetDocumentId`), `currentDocumentId` is passed correctly. For uploads via `processSingleBlock` in multi-block image splits, no `documentId` is passed and three sibling blocks may all have the same `documentNumber` parsed — three concurrent inserts → no duplicate detected at validation time, all three saved (race + missing exclude).
29. **Active data SQL casts `total` to numeric without sanitization** (`src/lib/database.ts:425`). If `corrected_json->>'total'` is stored as a non-numeric string (currently impossible because the action coerces, but no DB-level CHECK constraint), the `SUM((...)::numeric)` will throw and break the dashboard.
30. **`pg` Pool not gracefully shut down**. No SIGTERM handler closes the pool. Acceptable for serverless, fragile for long-running Node.
31. **`scripts/fix-next-server-chunks.mjs` is undocumented hack**. Copies chunks from `.next/server/chunks/` up to `.next/server/`. This indicates a real Next.js bundling problem with `pg`/`pdfjs-dist`/etc. Fragile band-aid; needs a comment explaining what breaks without it.
32. **`Image` from `next/image` rendered with `unoptimized`** for large preview files (`src/components/file-preview.tsx:11-23`). Not necessarily wrong, but defeats the point. Hard-coded 1600×1200 will distort previews of images with different aspect ratios.
33. **`splitDocumentBlocks` regex prepends substantial pre-header content** (`src/lib/documents/parsing.ts:586-589`) but only when ≥200 chars. The threshold is arbitrary; may swallow real content in short documents.
34. **`parseLineItemsFromText` regex is greedy and order-sensitive** (`src/lib/documents/parsing.ts:405-412`). The `[A-Za-z]` lookahead at the end means if the next word is a number (e.g. another quantity), the line item is silently dropped. Also relies on description starting with letters — items like "10 USB cables" will be skipped.
35. **CSV parser does not validate headers** (`src/lib/documents/parsing.ts:376-388`). A CSV with totally unrelated headers (`name,age,...`) becomes a list of empty `Item` line items with `null` numbers — silent garbage.
36. **`buildGenericData` derives `total = subtotal + tax` when total is null** (`src/lib/documents/parsing.ts:533-537`). This silently fabricates data the document never contained, defeating the entire validation premise. Reviewer can't tell the difference. Should at minimum mark the value as inferred.
37. **Date parsing's M/D/YYYY US heuristic (`parsing.ts:96-99`)** decides US vs European format only when middle > 12. So `04/05/2024` is always parsed as European (May 4) — never US (April 5). For mixed datasets this silently misclassifies dates without flagging ambiguity.
38. **`normalizeDate` accepts any `Date.parse`-able string in validation** (`src/lib/documents/validation.ts:16-22`), which includes things like `"2024-13-99"` (`Date.parse` returns NaN here, OK) but also `"01/02/2024"` (parses successfully but with US assumption — different from the parser's interpretation). Validation and parser disagree on locale.
39. **Duplicate review-event payload size**: `payload_json` stores entire `correctedData` and `validationIssues` blob on every save (`src/lib/database.ts:362-364`). On a heavily reviewed document this grows unbounded. No retention/pruning.
40. **`listDocuments` is exported but no longer used by route, only `listDocumentSummaries`** (`src/lib/database.ts:245-256`). Dead code? Or used by `actions.ts`/UI? Confirmed unused — remove.
41. **`getSiblingDocuments` orders by `source_name ASC`** (`src/lib/database.ts:285-297`) but the detail page re-sorts by `localeCompare` (`src/app/documents/[id]/page.tsx:69`). Inconsistent ordering between API and SSR.
42. **PDF preview uses `<iframe>` with same-origin** (`src/components/file-preview.tsx:26-32`). Fine for read but means the iframe inherits cookies. Combined with the missing auth, no consequence today, but matters once auth lands.
43. **Tesseract uses single PSM per script** (`scripts/extract-image-text.cjs:27` uses PSM 6, `scripts/extract-image-layout.cjs:58` uses PSM 11). Real production OCR pipelines try multiple PSMs and pick by confidence. No fallback.
44. **OCR confidence is parsed but never used by validation** — words below conf 20 are dropped (`src/lib/documents/image-layout.ts:931`), but there is no per-document confidence aggregate stored or surfaced to reviewers. Reviewer can't see why fields are wrong.
45. **`importDatasetDocuments` always reads `process.cwd()/resources`** (`src/lib/documents/pipeline.ts:269`). In a Docker production build the resources directory exists (Dockerfile copies it), but on Vercel it might not be writable / accessible. No env-var override.
46. **Hard-coded `CONCURRENCY = 2`** (`src/lib/documents/pipeline.ts:278`). No env override; doesn't react to host CPU count or queue length.
47. **No structured logging anywhere**. Errors swallowed with empty `catch` blocks (`src/lib/documents/pipeline.ts:260-263`, `:355-357`, `:396-398`, `:422`, `src/app/api/documents/import/route.ts:46-49`). Operations have zero visibility into failures.
48. **`FILE_ACCESS_TTL_MS = 15 * 60 * 1000`** (`src/lib/documents/file-access.ts:5`) — 15 minute signed URL. Fine, but the SSR-rendered page bakes the URL into the HTML, so the user has to refresh to extend; an idle reviewer past 15 min sees broken previews.
49. **`processUploadedFile` accepts only `File`** but UI sends multipart. The flow only handles a single file (`src/app/actions.ts:69-89`); multi-file dnd is not supported in `FileUploadInput` (`src/components/file-upload-input.tsx:17-23` only takes `files[0]`).
50. **No reviewer identity captured** — README acknowledges this (line 207) but worth noting: every `review_event.action` is a generic string with no actor, no IP, no user-agent. Auditing impossible.
51. **`deleteUploadDocumentAction` revalidates `/` but not the document detail page** (`src/app/actions.ts:91-105`). After delete, navigating back to a deleted ID still uses cached SSR (mitigated by `force-dynamic` but still inconsistent).
52. **Review save redirects to the same page after success** (`src/app/actions.ts:140`) but does not surface validation issues that would have prevented status change to `validated`. User sees a refresh with no indication of why their action didn't complete.
53. **`page.tsx` (`src/app/page.tsx:139-181`) renders all documents on the home page** with no pagination. At 1k+ documents this becomes slow and ugly.
54. **`getTotalsByCurrency` casts `corrected_json->>'total'` to numeric without filter for non-numeric values** (`src/lib/database.ts:420-437`) — same as #29. A `total` of `"NaN"` or `"abc"` (possible if any other code path bypasses validation) crashes the entire dashboard.
55. **`init`/`ensureSchema` runs `CREATE INDEX IF NOT EXISTS` on every cold start** (`src/lib/database.ts:40-85`). Cheap but: there is no migration story. Schema changes require manual ALTER. No `migrations/` directory.

### P2 — Nice to have

56. **`@/lib/documents/types.ts:106` `payload_json: object`** — typed as `object`, lossy.
57. **`PersistedDocumentSummary` and `PersistedDocument` overlap heavily** (`src/lib/documents/types.ts:51-80`). Could express summary as `Pick<PersistedDocument, ...>` to keep them in sync.
58. **`extractedData: row.extracted_json ?? createEmptyExtractedData()`** (`src/lib/database.ts:154`) silently masks missing data instead of throwing.
59. **`mapDocument` casts `row.source_type as PersistedDocument["sourceType"]`** (`src/lib/database.ts:148`) with no runtime check. A typo in DB will be silent.
60. **Inconsistent `getActiveDocumentData` return type** — defined to return `ExtractedDocumentData` but TS infers `ExtractedDocumentData | null` if `extractedData` could be null. Adding an explicit return type would catch surprises.
61. **`scoreSupplierCandidate` uses 12 magic-number thresholds** (`src/lib/documents/parsing.ts:193-265`). Untested edge cases. Move thresholds to named constants.
62. **`SUPPLIER_LABEL_RE`** (`src/lib/documents/parsing.ts:40-41`) is a long alternation that occasionally matches words that legitimately appear in supplier names (e.g. "Page Industries Ltd"). Single-letter docs like "Page" → false negative.
63. **`findCurrency` returns first match**, so `BAM` wins over `EUR` if both appear (`src/lib/documents/parsing.ts:151-175`). Order-dependent, no priority signal.
64. **`COMPANY_SUFFIX_PATTERN` covers Western forms only** (`src/lib/documents/parsing.ts:34`). No Pty Ltd (AU), B.V. (NL), S.A. (FR/ES), Sdn Bhd (MY), 株式会社, etc.
65. **`MONTH_NAMES`** is missing `"may"` short form because it's identical (`src/lib/documents/parsing.ts:43-49`); fine but inconsistent comment.
66. **`parseLineItemsFromCsv` lowercases nothing** — header `"Quantity"` vs `"qty"` requires `row.qty`/`row.quantity`/`row.QUANTITY` mismatches (`src/lib/documents/parsing.ts:382-388`).
67. **`splitColumns` splits on 2+ spaces** (`src/lib/documents/parsing.ts:304-310`); breaks for tab-delimited PDFs that pdfjs joins with single spaces.
68. **`parseTsv` splits text on `\t`, joins back with `\t`** (`scripts/extract-image-layout.cjs:25`) — works but unnecessary; word-level rows shouldn't contain tabs.
69. **`image-layout.ts`** is 1047 lines — should split into k-means, whitespace-split, layout-heuristic, and text-output modules.
70. **`runKMeans`** uses fixed 20 iterations (`src/lib/documents/image-layout.ts:313`); no convergence epsilon.
71. **`calculateSilhouette`** is O(n²) on every cluster count from `minimumClusters` to `maximumClusters` (`src/lib/documents/image-layout.ts:367-435`). For images with hundreds of words, ~milliseconds per call but total cost adds up.
72. **`findTwoTopOneBottomClusters`** has hard-coded ranges like `imageHeight * 0.18` to `0.45` (`src/lib/documents/image-layout.ts:655`). One layout heuristic; if it fails for `2 bottom + 1 top` or `3 columns`, no path covers it.
73. **`getMinimumClusterCount` returns 2 or 3 only** (`src/lib/documents/image-layout.ts:819-848`). Cannot detect 4-document collages.
74. **No way to disable the layout splitter** for images known to be single-doc (e.g. a flag).
75. **Tests for `image-layout.ts` use synthetic word grids, not real OCR output** (`src/__tests__/image-layout.test.ts`). Heuristic regressions on real screenshots will not be caught.
76. **`pipeline.ts` `processUploadedFile` `Promise.all` over `clusteredImageBlocks`** (`src/lib/documents/pipeline.ts:383-400`) — sequentially cropping + re-OCR'ing for every block. With Tesseract running ~3-5s per crop and N blocks, this is 3N×4s. No backpressure.
77. **`processSingleBlock` and `processDocumentFile` duplicate ~80% of the logic** (`src/lib/documents/pipeline.ts:208-264` vs `:305-359`). Refactor into a single `persistResult` function.
78. **`scoreParsedDocumentCandidate` and `selectPreferredImageBlockText`'s inner `scoreParsedData` overlap** (`src/lib/documents/pipeline.ts:44-99` vs `:150-185`). Two near-duplicate scoring functions; should be consolidated.
79. **`ImportDatasetPanel` polls every 1s indefinitely** (`src/components/import-dataset-panel.tsx:33-57`). For a 100-file dataset this is 100s of polls; backoff would be friendlier.
80. **No `AbortController` in fetch calls** — leaks if user navigates away.
81. **`startPolling` referenced inside `useEffect` deps** (`src/components/import-dataset-panel.tsx:90`) — fine, but `startPolling` itself depends on `stopPolling` and `fetchImportState` which are stable callbacks; net effect is OK but easy to break.
82. **`router.refresh()` after each completed import** but not during running (`src/components/import-dataset-panel.tsx:48`); user has to wait until done to see partial results.
83. **`FileUploadInput` doesn't validate extension client-side** (`src/components/file-upload-input.tsx`) — server rejects, but UX would benefit from inline error.
84. **`FileUploadInput` `accept` attribute missing** on `<input type="file">` — browsers can't filter (`src/components/file-upload-input.tsx:34-42`).
85. **`FileUploadInput` `onClick` triggers file picker on the wrapping div** but does not stop propagation when the inner input is clicked (`src/components/file-upload-input.tsx:28`). In some browsers this opens the picker twice.
86. **Page-level review form has no client-side validation** (`src/app/documents/[id]/page.tsx:169-285`). Invalid inputs round-trip to server, throw, return 500.
87. **No accessibility labels on the search/sort/pagination** (none exist; absent altogether).
88. **`button-row` buttons lack `disabled` state during submission** — review form re-submission is possible by double-clicking.
89. **Inline `style` attributes everywhere** in detail page (`src/app/documents/[id]/page.tsx:44-52`, etc.) — should move to CSS classes.
90. **`globals.css` is 22.7 KB** — no breakdown into component CSS modules.
91. **`<input>` for dates is a plain text input** with `placeholder="YYYY-MM-DD"` (`src/app/documents/[id]/page.tsx:202-217`); should use `type="date"`.
92. **No keyboard handler for `file-drop-zone`** (`src/components/file-upload-input.tsx:25-32`). Click only — no `onKeyDown` for Space/Enter, no `tabIndex`, no `role="button"`.
93. **`<table>` lacks `<caption>` and proper `scope` attributes** (`src/app/page.tsx:127-181`). Screen readers treat columns as unlabeled.
94. **No empty state for `validationIssues` count column** — shows raw `0`.
95. **`useEffect` in `ImportDatasetPanel` shows "Imported X documents" without a dismiss control** (`src/components/import-dataset-panel.tsx:191-192`).
96. **No timezone awareness** — `created_at`/`updated_at` stored as ISO strings (`src/lib/database.ts:199`); display passes raw ISO string to user (`src/app/documents/[id]/page.tsx:304`). UTC times shown to users in their local context — confusing.
97. **`formatDate` is a no-op** (`src/lib/documents/presentation.ts:41-43`). Should use Intl or at least friendly format.
98. **`formatAmount` always shows 2 decimals** (`src/lib/documents/presentation.ts:33-39`). JPY, KRW have 0 decimals; KWD, BHD have 3. Cosmetic.
99. **No environment-variable validation at startup** (`process.env.DATABASE_URL` used directly at `src/lib/database.ts:33`). Missing var → cryptic pg error at first query.
100. **`next.config.ts:5-7` body size 20 MB** allows multi-MB image uploads. Reasonable but no per-route limit.
101. **OCR scripts run as fresh Node processes per file** — each process starts up sharp/tesseract ~200ms warm. For 30+ dataset files this is ~6s of overhead. A persistent worker would help.
102. **`ensureSchema` race**: `schemaReady` is set inside `ensureSchema()` but the assignment-then-await is not atomic across simultaneous first calls (`src/lib/database.ts:87-92`). Two concurrent first callers both see `schemaReady === null`, both call `initSchema`. CREATE TABLE IF NOT EXISTS makes it safe, but the wasted work indicates a missing memoization pattern.
103. **`initSchema` runs DDL inside the same connection as everything else** — DDL is implicitly committed in Postgres, fine, but sequenced after first query of pool.
104. **`splitDocumentBlocks` returns the raw text wrapped in single-element array if <2 headers** (`src/lib/documents/parsing.ts:572-592`) — needed, but the comment says "TAX/PROFORMA + INVOICE/PURCHASE_ORDER" only; receipts, statements, credit notes are not segmented.
105. **`shouldUseImageOcrBlocks`** uses block.length >= 120 chars heuristic (`src/lib/documents/pipeline.ts:110`) — magic number, untested at boundary.
106. **`extractCroppedImageText` cleanup uses `await fs.unlink(...).catch(() => {})`** (`src/lib/documents/extraction.ts:91`); silently swallows storage cleanup errors.
107. **CI uses Node 20 but `package.json` does not specify `engines`**; README says Node 22+. Inconsistency: CI may pass on Node 20 even when something requires 22.
108. **CI runs `npm ci` + `npm run lint` + `npm run test` but does not run integration tests against a real upload** — and the OCR integration test uses `execFileSync` so it does run, but only one tiny synthesized image. No regression coverage for real screenshot dataset.
109. **`docker-compose.yml` mounts `uploads_data` volume** but the `db` container has no resource limits.
110. **Postgres password `postgres` in docker-compose committed to repo** (`docker-compose.yml:7,23`) — local-only, but the same defaults often slip into production.
111. **No `.dockerignore`** — `npm ci` inside Docker builds may include `.next`, `node_modules`, `data/uploads/`, or local `.env.local`.
112. **`Dockerfile` `COPY . .` copies `.env.local` into image** if present (`Dockerfile:5`). Even though the Docker image then overrides `DATABASE_URL`, secrets like `FILE_ACCESS_SECRET` could leak.
113. **`Dockerfile` does not install `tesseract`** (only Node). The runtime image will fail OCR. README says `tesseract` is a prereq for the host, but for the Docker app container it's missing.
114. **Schema does not capture `parent_document_id` for image siblings** — siblings are joined via `source_path` heuristic (`src/lib/database.ts:285-297`). Brittle if `source_path` ever changes.

### P3 — Cosmetic

115. **`src/__tests__/parsing.test.ts:181-184`** — test name "extracts company name by Ltd. suffix" but actual assertion is `"Company Name, Ltd."` — comma included by greedy capture. Rename or normalize.
116. **`COMPANY_SUFFIX_PATTERN`** uses raw string `String.raw` for some patterns and template literal in others (`src/lib/documents/parsing.ts:34-39`). Mix the styles consistently.
117. **`VALIDATION_SEVERITIES` contains `["error", "warning"]`** but no `"info"` — fine, but inconsistent with typical levels.
118. **`buildProcessingErrorIssue`** — single-element array always; could be inlined.
119. **`addIssue` helper** does the same as `issues.push(...)` (`src/lib/documents/validation.ts:8-14`).
120. **CSS class names mix kebab (`page-shell`) and double-dash BEM (`file-preview--image`)** (`src/components/file-preview.tsx`). Inconsistent.
121. **`em-dash`** used as fallback (`—`) inconsistently — sometimes ASCII `-`, sometimes Unicode em-dash.
122. **`tsconfig.tsbuildinfo`** committed/tracked in `git status` — should be in `.gitignore`.
123. **`.DS_Store`** present at repo root — should be in `.gitignore`.
124. **`osd.traineddata`** committed — but README says only English is shipped (`eng.traineddata`). Dead data file?
125. **`CLAUDE.md` ignored** but README isn't aware; mention or exclude.
126. **README "Improvements still worth doing" includes #1 "Add authentication"** — confirms the P0 finding is known but unaddressed.

## Findings by Dimension

### Correctness

- See P0 #5 (review action throws raw error), P0 #6 (UPSERT loses corrected_json sync), P1 #8 (status reset), P1 #9 (duplicate detection race), P1 #28 (multi-block validation race), P1 #36 (silent total fabrication), P1 #37 (locale ambiguous date parsing), P2 #38 (validation/parser locale disagreement), P2 #66 (CSV header case sensitivity), P2 #67 (column splitter brittleness), P2 #98 (currency decimals).

### Security

- See P0 #1 (no auth), P0 #2 (default secret), P0 #3 (path traversal defense missing), P1 #15 (MIME spoof), P1 #17 (no nosniff/disposition), P1 #18 (text-iframe), P1 #19 (PDF.js parsing untrusted), P1 #25 (no CSRF), P1 #26 (no rate limit), P2 #110 (default db password), P2 #112 (Docker may leak `.env.local`).

### Performance

- See P1 #11 (pool not sized), P1 #14 (no upload size cap), P1 #46 (CONCURRENCY=2), P1 #53 (no pagination), P2 #71 (silhouette O(n²)), P2 #76 (sequential per-block OCR), P2 #79 (no polling backoff), P2 #101 (no helper warm pool).

### Reliability

- See P0 #4 (background work survival/race), P0 #7 (orphan files on crash), P1 #12 (Promise.all error semantics), P1 #13 (write-write race on import state), P1 #16 (filename collision), P1 #22 (cumulative OCR timeout), P1 #47 (silent error swallowing), P1 #48 (URL TTL race), P2 #102 (`ensureSchema` race), P2 #114 (sibling join brittleness).

### Architecture

- See P0 #3 (file route directly trusts `sourcePath`), P1 #20 (cwd-based script paths), P2 #69 (`image-layout.ts` size), P2 #77 (pipeline duplication), P2 #78 (scoring duplication), P2 #114 (sibling model is implicit).
- Business logic leaks into components: `splitDocumentBlocks` is invoked twice, scoring weights live in pipeline rather than parsing, presentation utilities mixed with formatting.
- Server actions (`src/app/actions.ts`) reach into the database layer directly without a service abstraction.

### Testing

- See P2 #75 (synthetic OCR tests), P2 #108 (no full integration).
- **Untested modules**: `src/lib/database.ts` (no tests at all — all DB tests are mocked), `src/lib/documents/file-access.ts` (no tests; HMAC critical), `src/lib/documents/extraction.ts` (no unit tests), `src/lib/documents/defaults.ts` (no tests), `src/lib/documents/presentation.ts` (no tests), `src/lib/documents/pipeline.ts:processUploadedFile`/`importDatasetDocuments`/`storeUploadedFile`/`processDocumentFile` (only the small scoring functions are tested), `src/components/*` (no tests), `src/app/api/docs/route.ts` (no tests), `src/app/page.tsx`, `src/app/documents/[id]/page.tsx`, `src/app/layout.tsx` (no tests).
- Heavy use of `vi.hoisted` mocks means most "route tests" don't actually exercise the route — they exercise the mock surface.
- No DB-integration test (the CI starts Postgres but only the unit suite runs).
- No browser/E2E coverage (Playwright/Cypress absent).
- No mutation testing or property tests on parsing.

### DX / Maintainability

- See P1 #31 (undocumented build hack), P2 #56-#59 (type lies), P2 #61 (magic numbers in scoring), P2 #69 (large files), P2 #77-#78 (duplication), P2 #122-#125 (gitignore noise).
- Mix of `.cjs`, `.mjs`, `.ts` in `scripts/` makes editing inconsistent.
- Many commented patterns rely on specific dataset files (`Screenshot 2026-04-28 at 18.26.01.png` in CLAUDE.md).
- README and CLAUDE.md are partially out of sync (README "Improvements still worth doing" vs CLAUDE.md "Current handoff notes").

### UX / Frontend

- See P2 #82-#98 — pagination, accessibility, keyboard nav, empty states, mobile, optimistic updates, date inputs, timezone display, currency decimals.
- No loading skeletons on first paint.
- No mobile considerations (large hero, fixed-width tables likely overflow).
- No dark mode toggle (some inline color vars suggest tokens exist; not exercised).
- Reviewer cannot see/clear individual line items easily — only a textarea with pipe format.

### OCR Pipeline

- See P1 #43 (single PSM), P1 #44 (confidence not surfaced), P2 #69-#75 (heuristic fragility), P2 #76 (sequential cost).
- Only English language. No Spanish/French/German for the multilingual invoice patterns the parser claims to handle.
- No fallback OCR engine when Tesseract returns garbage.
- `--psm 6` (uniform text block) for plain text and `--psm 11` (sparse text) for layout — no `psm 3` (auto) baseline; receipts/long-page invoices may parse poorly.
- No image deskew/rotate beyond what Tesseract internally does (no `--osd`/auto-orient).
- No DPI normalization — small/low-res images are downsampled by `grayscale().normalize()` only.
- No retry with different preprocessing on low confidence.

### Operational

- See P1 #45 (`process.cwd()`), P1 #47 (no logging), P1 #50 (no actor capture), P2 #99 (no env validation), P2 #103-#113 (deploy/docker), P2 #99 (no migrations).
- No metrics endpoint.
- No health check route (`docker-compose.yml` only checks DB).
- No backup strategy documented (Postgres volume only).
- No alert on failed imports.
- Secrets handling: `.env.local` is gitignored (good), but no `.env.example`.

## Coverage Gaps (Test Modules with No / Trivial Tests)

- `src/lib/database.ts` — ZERO direct tests. Every consumer mocks it.
- `src/lib/documents/file-access.ts` — ZERO tests. HMAC-signed URLs are security-critical.
- `src/lib/documents/extraction.ts` — ZERO tests. Spawns child processes; no harness.
- `src/lib/documents/defaults.ts` — ZERO tests.
- `src/lib/documents/presentation.ts` — ZERO tests.
- `src/lib/documents/pipeline.ts` — only `shouldUseImageOcrBlocks` and `selectPreferredImageBlockText` (small fragments). `processUploadedFile`, `importDatasetDocuments`, `storeUploadedFile`, `processDocumentFile`, `processSingleBlock` are untested. No multi-block / sibling / re-import scenarios.
- `src/lib/documents/image-layout.ts` — only synthetic-grid splitter tests; many inner functions (silhouette, k-means, mergeNearbyClusters) untested directly.
- `src/lib/import-state.ts` — no tests.
- `src/components/*` — no component tests at all (no React Testing Library).
- `src/app/api/docs/route.ts` — no tests; OpenAPI shape can drift silently.
- `src/app/page.tsx`, `src/app/documents/[id]/page.tsx`, `src/app/layout.tsx` — no SSR tests, no E2E.
- `scripts/extract-pdf-text.mjs`, `scripts/fix-next-server-chunks.mjs` — no tests.

## Recommended Next Steps

1. **Add authentication & authorization.** Even basic NextAuth (Credentials or magic-link) gating every server action and `/api/*` route. Capture reviewer identity in `review_events`.
2. **Fail closed on missing `FILE_ACCESS_SECRET`.** Throw at startup if unset in non-dev. Likewise add a startup `assert process.env.DATABASE_URL`.
3. **Replace fire-and-forget import with a real job model.** Either (a) a tiny Postgres-backed work queue with `SELECT ... FOR UPDATE SKIP LOCKED`, or (b) an external worker / cron. At minimum: take an advisory lock (`pg_try_advisory_lock`) inside the POST handler and atomically transition `import_jobs.running` from false→true.
4. **Tighten file storage and serving.** Verify `document.sourcePath` is inside an allowed root before reading; add `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`; cap upload bytes; detect MIME via magic bytes (`file-type` package).
5. **Stop fabricating data in `buildGenericData`.** Don't auto-derive `total = subtotal + tax`; flag with a warning instead. Mark inferred vs extracted explicitly so reviewers can trust the data.
6. **Add a DB unique constraint on (active document number, source type)** or surface duplicates via DB constraint rather than racy lookup. Wrap `saveProcessedDocument` + `validateExtractedData` in a transaction.
7. **Consolidate `processSingleBlock` / `processDocumentFile`** into a single result-persistence function and split `image-layout.ts` into smaller files.
8. **Add database-integration tests** that run against the CI Postgres service (already provisioned). Cover save, re-upsert, sibling query, duplicate detection race.
9. **Surface OCR confidence** and store an aggregate score per document. Pipe it to a `low-confidence` warning issue so reviewers know which fields to scrutinize.
10. **Add observability**: structured `pino`/`console.log({...})` logs with request ids, basic Prometheus metrics endpoint (or at minimum a `/api/health` route that pings Postgres and returns `tesseract --version`), and a real migration tool (e.g. `node-pg-migrate`).
