"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImportDatasetPanel() {
  const router = useRouter();
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    setIsImporting(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/documents/import", {
        method: "POST"
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        throw new Error(payload?.error ?? "Import failed.");
      }

      const payload = (await response.json()) as { imported: number };
      setMessage(`Imported ${payload.imported} documents.`);
      router.refresh();
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Import failed."
      );
    } finally {
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
          {isImporting ? "Importing..." : "Import sample documents"}
        </button>
      </div>
      {message ? (
        <p className="feedback-ok">{message}</p>
      ) : null}
      {error ? (
        <p className="feedback-err">{error}</p>
      ) : null}
    </div>
  );
}
