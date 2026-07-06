// Retry helper for flaky async operations in the eval fixture.
async function withRetry(operation, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return operation();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function backoffDelay(attempt, baseMs = 100, maxMs = 5000) {
  // exponential backoff, capped
  return Math.min(baseMs * 2 ** attempt, maxMs);
}

module.exports = { withRetry, backoffDelay };
