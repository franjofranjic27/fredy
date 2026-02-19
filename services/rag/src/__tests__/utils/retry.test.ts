import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../../utils/retry.js";

describe("withRetry", () => {
  it("returns the result immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on a retryable error and eventually succeeds", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error("500 Internal Server Error");
      return "recovered";
    });

    const result = await withRetry(fn, {
      maxAttempts: 5,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on a non-retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Validation failed"));

    await expect(
      withRetry(fn, { maxAttempts: 5, minDelayMs: 0, maxDelayMs: 0 })
    ).rejects.toThrow("Validation failed");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting all attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("503 Service Unavailable"));

    await expect(
      withRetry(fn, { maxAttempts: 3, minDelayMs: 0, maxDelayMs: 0 })
    ).rejects.toThrow("503 Service Unavailable");

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects a custom retryable predicate", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("CUSTOM_RETRYABLE"));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        minDelayMs: 0,
        maxDelayMs: 0,
        retryable: (err) => err instanceof Error && err.message === "CUSTOM_RETRYABLE",
      })
    ).rejects.toThrow("CUSTOM_RETRYABLE");

    // All 3 attempts were made because the error was retryable
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
