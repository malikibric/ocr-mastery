export interface ImportState {
  running: boolean;
  total: number;
  processed: number;
  failed: number;
  done: boolean;
  error: string | null;
}

export const importState: ImportState = {
  running: false,
  total: 0,
  processed: 0,
  failed: 0,
  done: true,
  error: null
};
