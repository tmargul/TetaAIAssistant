const DEFAULT_RETRIES = 4;
const RETRY_DELAY_MS = 1500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** fetch z ponowieniem — dev: API (nest --watch) czasem restartuje się kilka sekund. */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  retries = DEFAULT_RETRIES,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        await wait(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}
