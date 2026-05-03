"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_IMPORT_STATE, type ImportState } from "@/lib/import-state";

export function ImportDatasetPanel() {
  const router = useRouter();
  const [state, setState] = useState<ImportState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"import" | "reset" | null>(
    null
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchImportState = useCallback(async () => {
    const res = await fetch("/api/documents/import");

    if (!res.ok) {
      throw new Error("Could not load import status.");
    }

    return (await res.json()) as ImportState;
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const status = await fetchImportState();
        setState(status);

        if (status.done) {
          stopPolling();
          if (status.error) {
            setError(status.error);
          } else {
            setMessage(
              `Processed ${status.processed} file${status.processed !== 1 ? "s" : ""}` +
                (status.failed > 0 ? `, ${status.failed} failed.` : ".")
            );
          }
          router.refresh();
        }
      } catch (err) {
        stopPolling();
        setError(
          err instanceof Error ? err.message : "Could not load import status."
        );
      }
    }, 1000);
  }, [fetchImportState, router, stopPolling]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const status = await fetchImportState();

        if (!active) {
          return;
        }

        setState(status);

        if (status.running) {
          startPolling();
        }
      } catch (err) {
        if (!active) {
          return;
        }

        setError(
          err instanceof Error ? err.message : "Could not load import status."
        );
      }
    })();

    return () => {
      active = false;
      stopPolling();
    };
  }, [fetchImportState, startPolling, stopPolling]);

  async function handleImport() {
    if (pendingAction) {
      return;
    }

    setMessage(null);
    setError(null);
    setPendingAction("import");

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
    } finally {
      setPendingAction(null);
    }
  }

  async function handleReset() {
    if (pendingAction) {
      return;
    }

    setMessage(null);
    setError(null);
    setPendingAction("reset");

    try {
      const res = await fetch("/api/documents/import", { method: "DELETE" });
      const payload = (await res.json()) as {
        reset?: boolean;
        deleted?: number;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(payload.error ?? "Reset failed.");
      }

      stopPolling();
      setState(DEFAULT_IMPORT_STATE);
      setMessage(
        payload.deleted && payload.deleted > 0
          ? `Removed ${payload.deleted} imported document${payload.deleted !== 1 ? "s" : ""}.`
          : "Import state reset."
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setPendingAction(null);
    }
  }

  const isRunning = state?.running ?? false;
  const isStartingImport = pendingAction === "import";
  const isResettingImport = pendingAction === "reset";
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
          disabled={isRunning || pendingAction !== null}
          onClick={handleImport}
          type="button"
        >
          {isRunning || isStartingImport ? "Importing…" : "Import sample documents"}
        </button>
        <button
          className="button-secondary button-danger"
          disabled={isStartingImport || isResettingImport}
          onClick={handleReset}
          type="button"
        >
          {isResettingImport ? "Resetting…" : "Reset import"}
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
