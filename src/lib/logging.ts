interface LogMetadata {
  [key: string]: unknown;
}

export function logStructuredError(
  event: string,
  error: unknown,
  metadata: LogMetadata = {}
) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(
    JSON.stringify({
      level: "error",
      event,
      message,
      stack,
      ...metadata,
      timestamp: new Date().toISOString()
    })
  );
}
