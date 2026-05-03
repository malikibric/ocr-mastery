import Link from "next/link";
import { notFound } from "next/navigation";
import { logoutAction } from "@/app/auth-actions";
import { saveReviewAction } from "@/app/actions";
import { getActiveDocumentData } from "@/lib/documents/defaults";
import {
  formatAmount,
  formatDate,
  getSeverityTone,
  getStatusLabel,
  getStatusTone
} from "@/lib/documents/presentation";
import { createDocumentFileUrl } from "@/lib/documents/file-access";
import { getDocumentById, getSiblingDocuments, listReviewEvents } from "@/lib/database";
import { requireReviewerPageSession } from "@/lib/reviewer-session";
import { FilePreview } from "@/components/file-preview";
import { ReviewForm } from "@/components/review-form";

export const dynamic = "force-dynamic";

export default async function DocumentDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireReviewerPageSession(`/documents/${id}`);
  const document = await getDocumentById(id);

  if (!document) {
    notFound();
  }

  const activeData = getActiveDocumentData(document);
  const fileUrl = createDocumentFileUrl(document.id);
  const [reviewEvents, siblings] = await Promise.all([
    listReviewEvents(document.id),
    getSiblingDocuments(document.sourcePath, document.id)
  ]);

  return (
    <main className="page-shell">
      <section className="panel">
        <div className="top-bar">
          <div>
            <Link className="back-link" href="/">← Back to dashboard</Link>
            <h1 style={{ margin: "0 0 0.375rem", fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{document.sourceName}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {document.sourceType} · {document.mimeType} · {session.reviewerEmail}
            </p>
          </div>
          <div className="button-row" style={{ marginTop: 0 }}>
            <span className="pill" data-tone={getStatusTone(document.status)}>
              {getStatusLabel(document.status)}
            </span>
            <form action={logoutAction}>
              <button className="button-secondary" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Document preview</h2>
        <FilePreview
          fileUrl={fileUrl}
          mimeType={document.mimeType}
          name={document.sourceName}
        />
        {siblings.length > 0 && (
          <>
            <p className="muted" style={{ marginTop: "0.875rem", marginBottom: "0.5rem" }}>
              OCR detected {siblings.length + 1} documents in this upload.
            </p>
            <nav className="doc-tabs" aria-label="Document parts">
              {[document, ...siblings]
                .sort((left, right) => left.sourceName.localeCompare(right.sourceName))
                .map((item, index) => (
                  <Link
                    className={`doc-tab${item.id === document.id ? " doc-tab--active" : ""}`}
                    href={`/documents/${item.id}`}
                    key={item.id}
                  >
                    Document {index + 1}
                  </Link>
                ))}
            </nav>
          </>
        )}
      </section>

      <section className="details-grid">
        <article className="panel">
          <h2>Current extracted data</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <th>Document type</th>
                  <td>{activeData.documentType.replace(/_/g, " ")}</td>
                </tr>
                <tr>
                  <th>Supplier</th>
                  <td>{activeData.supplierName ?? "—"}</td>
                </tr>
                <tr>
                  <th>Document number</th>
                  <td>{activeData.documentNumber ?? "—"}</td>
                </tr>
                <tr>
                  <th>Issue date</th>
                  <td>{formatDate(activeData.issueDate)}</td>
                </tr>
                <tr>
                  <th>Due date</th>
                  <td>{formatDate(activeData.dueDate)}</td>
                </tr>
                <tr>
                  <th>Currency</th>
                  <td>{activeData.currency ?? "—"}</td>
                </tr>
                <tr>
                  <th>Subtotal</th>
                  <td>{formatAmount(activeData.subtotal, activeData.currency)}</td>
                </tr>
                <tr>
                  <th>Tax</th>
                  <td>{formatAmount(activeData.tax, activeData.currency)}</td>
                </tr>
                <tr>
                  <th>Total</th>
                  <td>{formatAmount(activeData.total, activeData.currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <h2>Validation findings</h2>
          {document.validationIssues.length > 0 ? (
            <ul className="issue-list">
              {document.validationIssues.map((issue) => (
                <li className="issue-item" key={`${issue.code}-${issue.message}`}>
                  <div className="top-bar">
                    <strong>{issue.message}</strong>
                    <span className="pill" data-tone={getSeverityTone(issue.severity)}>
                      {issue.severity}
                    </span>
                  </div>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Field: {issue.field}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No validation issues detected.</p>
          )}

          {document.processingError ? (
            <>
              <h3 style={{ marginTop: "1.25rem" }}>Processing error</h3>
              <p className="muted">{document.processingError}</p>
            </>
          ) : null}
        </article>
      </section>

      <section className="panel">
        <h2>Review and corrections</h2>
        <p className="muted">
          Update the extracted fields, then save, validate, or reject the
          document.
        </p>

        <ReviewForm activeData={activeData} documentId={document.id} />
      </section>

      <section className="details-grid">
        <article className="panel">
          <h2>Raw extracted text</h2>
          <pre className="code-block">
            {document.rawText || "No raw text was captured for this document."}
          </pre>
        </article>

        <article className="panel">
          <h2>Review history</h2>
          {reviewEvents.length > 0 ? (
            <ul className="history-list">
              {reviewEvents.map((event) => (
                <li className="history-item" key={event.id}>
                  <strong>{event.action}</strong>
                  <p className="muted" style={{ marginBottom: "0.25rem" }}>
                    {event.reviewer_name ?? event.reviewer_email ?? "Unknown reviewer"}
                  </p>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    {event.created_at}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No review actions recorded yet.</p>
          )}
        </article>
      </section>
    </main>
  );
}
