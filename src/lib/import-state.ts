export interface ImportState {
  running: boolean;
  total: number;
  processed: number;
  failed: number;
  done: boolean;
  error: string | null;
}

export const DEFAULT_IMPORT_STATE: ImportState = {
  running: false,
  total: 0,
  processed: 0,
  failed: 0,
  done: true,
  error: null
};

export function shouldAutoCompleteImportState(state: ImportState): boolean {
  if (!state.running || state.done) {
    return false;
  }

  if (state.total === 0) {
    return true;
  }

  return state.processed + state.failed >= state.total;
}
