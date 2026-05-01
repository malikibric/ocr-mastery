"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportState } from "@/lib/import-state";

export function ImportDatasetPanel() {
  const router = useRouter();
  const [state, setState] = useState<ImportState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => {
    fetch("/api/documents", { method: "DELETE" }).catch(() => {});
    return () => stopPolling();
  }, []);

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/documents/import");
        if (!res.ok) return;
        const status = (await res.json()) as ImportState;
        setState(status);

        if (status.done) {
          stopPolling();
          if (status.error) {
            setError(status.error);
          } else {
            setMessage(
              `Imported ${status.processed} document${status.processed !== 1 ? "s" : ""}` +
              (status.failed > 0 ? `, ${status.failed} failed.` : ".")
            );
          }
          router.refresh();
        }
      } catch {
        // ignore poll errors
      }
    }, 1000);
  }

  async function handleImport() {
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/documents/import", { method: "POST" });
      const payload = (await res.json()) as { started?: boolean; total?: number; error?: string };

      if (!res.ok) {
        throw new Error(payload.error ?? "Import failed.");
      }

      setState({ running: true, total: payload.total ?? 0, processed: 0, failed: 0, done: false, error: null });
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    }
  }

  const isRunning = state?.running ?? false;
  const pct = state && state.total > 0
    ? Math.round(((state.processed + state.failed) / state.total) * 100)
    : 0;

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
          disabled={isRunning}
          onClick={handleImport}
          type="button"
        >
          {isRunning ? "Importing…" : "Import sample documents"}
        </button>
      </div>

      {isRunning && state && (
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{
            height: "6px", borderRadius: "3px",
            background: "var(--border)", overflow: "hidden"
          }}>
            <div style={{
              height: "100%", borderRadius: "3px",
              background: "var(--accent)",
              width: `${pct}%`,
              transition: "width 0.4s ease"
            }} />
          </div>
          <p className="muted" style={{ marginTop: "0.4rem", fontSize: "0.85rem" }}>
            {state.processed + state.failed} / {state.total} files
            {state.failed > 0 ? ` (${state.failed} failed)` : ""}
          </p>
        </div>
      )}

      {message && <p className="feedback-ok">{message}</p>}
      {error && <p className="feedback-err">{error}</p>}
    </div>
  );
}
