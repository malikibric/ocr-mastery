"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function ImportDatasetPanel() {
  const router = useRouter();
  const [isImporting, setIsImporting] = useState(false);
  const [processed, setProcessed] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => () => stopPolling(), []);

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/documents");
        if (!res.ok) return;
        const payload = (await res.json()) as { documents: unknown[] };
        setProcessed(payload.documents.length);
      } catch {
        // ignore poll errors
      }
    }, 1200);
  }

  async function handleImport() {
    setIsImporting(true);
    setMessage(null);
    setError(null);
    setProcessed(null);
    startPolling();

    try {
      const response = await fetch("/api/documents/import", { method: "POST" });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Import failed.");
      }

      const payload = (await response.json()) as { imported: number };
      setMessage(`Imported ${payload.imported} documents.`);
      router.refresh();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import failed.");
    } finally {
      stopPolling();
      setIsImporting(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: 0 }}>
      <h2>Import provided dataset</h2>
      <p className="muted">
        Processes supported files from <code>resources/</code> and updates
        existing dataset records in place.
      </p>
      <div className="button-row">
        <button
          className="button"
          disabled={isImporting}
          onClick={handleImport}
          type="button"
        >
          {isImporting ? "Importing…" : "Import sample documents"}
        </button>
      </div>
      {isImporting && processed !== null && (
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          {processed} document{processed !== 1 ? "s" : ""} processed so far…
        </p>
      )}
      {message && <p className="feedback-ok">{message}</p>}
      {error && <p className="feedback-err">{error}</p>}
    </div>
  );
}
