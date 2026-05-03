import Link from "next/link";
import { deleteUploadDocumentAction, uploadDocumentAction } from "@/app/actions";
import { HomeNavbar } from "@/components/home-navbar";
import { ImportDatasetPanel } from "@/components/import-dataset-panel";
import { FileUploadInput } from "@/components/file-upload-input";
import {
  formatAmount,
  getStatusLabel,
  getStatusTone
} from "@/lib/documents/presentation";
import {
  getDocumentCountsByStatus,
  getTotalsByCurrency,
  listDocumentSummaries
} from "@/lib/database";
import { requireReviewerPageSession } from "@/lib/reviewer-session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requireReviewerPageSession("/");
  const [documents, counts, totalsByCurrency] = await Promise.all([
    listDocumentSummaries(),
    getDocumentCountsByStatus(),
    getTotalsByCurrency()
  ]);

  return (
    <main className="page-shell">
      <HomeNavbar reviewerEmail={session.reviewerEmail} />

      <section className="hero">
        <div>
          <h1>Smart Document Processing System</h1>
          <p>
            Ingest business documents from the provided dataset or user
            uploads, extract structured fields, surface validation issues, and
            review corrections before final approval.
          </p>
        </div>
        <div className="actions-grid">
          <ImportDatasetPanel />

          <form action={uploadDocumentAction} className="panel" style={{ marginTop: 0 }}>
            <h2>Upload a document</h2>
            <p className="muted">
              Supported formats: PDF, image, CSV, and TXT.
            </p>
            <FileUploadInput />
            <div className="button-row" style={{ marginTop: "1rem" }}>
              <button className="button" type="submit">
                Upload and process
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel" id="workflow-overview">
        <div className="top-bar">
          <div>
            <h2>Workflow overview</h2>
            <p className="muted">
              Statuses track uploaded, review-required, validated, and rejected
              documents.
            </p>
          </div>
        </div>
        <div className="stats-grid">
          {[
            ["Uploaded", counts.uploaded],
            ["Needs Review", counts.needs_review],
            ["Validated", counts.validated],
            ["Rejected", counts.rejected]
          ].map(([label, value]) => (
            <article className="metric-card" key={label}>
              <span className="metric-label">{label}</span>
              <span className="metric-value">{value}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="panel" id="totals-by-currency">
        <div className="top-bar">
          <div>
            <h2>Totals by currency</h2>
            <p className="muted">
              Aggregated from the latest active data for each processed document.
            </p>
          </div>
        </div>
        <div className="stats-grid">
          {totalsByCurrency.length > 0 ? (
            totalsByCurrency.map((entry) => (
              <article className="metric-card" key={entry.currency}>
                <span className="metric-label">{entry.currency}</span>
                <span className="metric-value">
                  {formatAmount(entry.total, entry.currency)}
                </span>
              </article>
            ))
          ) : (
            <article className="metric-card">
              <span className="metric-label">No totals yet</span>
              <span className="muted">
                Import the dataset or upload a document to start processing.
              </span>
            </article>
          )}
        </div>
      </section>

      <section className="panel" id="processed-documents">
        <div className="top-bar">
          <div>
            <h2>Processed documents</h2>
            <p className="muted">
              Open any document to inspect extracted data, validation findings,
              and manual review history.
            </p>
          </div>
        </div>

        {documents.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Supplier</th>
                  <th>Total</th>
                  <th>Issues</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => {
                  const data = document.activeData;

                  return (
                    <tr key={document.id}>
                      <td>
                        <Link href={`/documents/${document.id}`}>
                          {document.sourceName}
                        </Link>
                        <div className="doc-number">{data.documentNumber ?? "No number"}</div>
                      </td>
                      <td>{data.documentType.replace(/_/g, " ")}</td>
                      <td>
                        <span
                          className="pill"
                          data-tone={getStatusTone(document.status)}
                        >
                          {getStatusLabel(document.status)}
                        </span>
                      </td>
                      <td>{data.supplierName ?? "—"}</td>
                      <td>{formatAmount(data.total, data.currency)}</td>
                      <td>{document.validationIssues.length}</td>
                      <td>
                        {document.sourceType === "upload" ? (
                          <form action={deleteUploadDocumentAction}>
                            <input name="documentId" type="hidden" value={document.id} />
                            <button
                              aria-label={`Delete upload ${document.sourceName}`}
                              className="button-secondary button-danger"
                              type="submit"
                            >
                              Delete
                            </button>
                          </form>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            No documents have been processed yet. Import the dataset or upload a file above.
          </div>
        )}
      </section>
    </main>
  );
}
