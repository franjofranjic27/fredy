import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const FETCH_URL_TOOL_NAME = "fetch_url";

export const fetchUrlInputSchema = z.object({
  url: z.string().regex(/^https?:\/\//i, "URL must start with http:// or https://"),
  maxChars: z.number().int().positive().optional(),
});

export type FetchUrlInput = z.infer<typeof fetchUrlInputSchema>;

const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MiB hard cap
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 10_000;

export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export interface FetchUrlToolOptions {
  readonly fetchImpl?: typeof fetch;
  readonly lookup?: LookupFn;
  readonly maxBytes?: number;
  /** Overall deadline (connect + body read) enforced via AbortSignal. */
  readonly timeoutMs?: number;
}

/**
 * Returns true for loopback, private, link-local (incl. cloud metadata),
 * unique-local and unspecified addresses — anything fetch_url must not reach.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  // Not an IP literal — treat as unsafe; callers must resolve first.
  return true;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [a, b] = octets;
  if (a === 0 || a === 127 || a === 10) return true; // unspecified, loopback, private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::1" || normalized === "::") return true;
  // IPv4-mapped (::ffff:a.b.c.d)
  const v4Match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (v4Match) return isPrivateIpv4(v4Match[1]);
  const firstGroup = normalized.split(":")[0];
  const value = firstGroup === "" ? 0 : Number.parseInt(firstGroup, 16);
  if ((value & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((value & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/**
 * Enforce http(s) on every hop. fetch would already reject unknown schemes, but
 * we validate explicitly so a redirect to e.g. file:/ftp:/gopher: can never
 * slip through before the SSRF DNS check runs.
 */
function assertHttpScheme(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing to follow non-http(s) URL: ${url.protocol}//${url.host}`);
  }
}

async function assertPublicTarget(url: URL, lookup: LookupFn): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`Refusing to fetch private or internal address: ${hostname}`);
    }
    return;
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname);
  } catch (err) {
    throw new Error(
      `Failed to resolve ${hostname}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (addresses.length === 0) {
    throw new Error(`Failed to resolve ${hostname}: no addresses`);
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(
        `Refusing to fetch private or internal address: ${hostname} resolves to ${address}`,
      );
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytes;
      const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      bytes += slice.byteLength;
      text += decoder.decode(slice, { stream: true });
      if (bytes >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}

async function fetchWithSsrfGuard(
  initialUrl: string,
  fetchImpl: typeof fetch,
  lookup: LookupFn,
  signal: AbortSignal,
): Promise<Response> {
  let currentUrl = new URL(initialUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    assertHttpScheme(currentUrl);
    // Note: this resolves DNS then fetches by hostname, so a DNS-rebinding race
    // (resolve public, connect to a re-pointed private IP) is possible. Accepted
    // for now: fetch_url is not wired to the model, only invoked directly.
    await assertPublicTarget(currentUrl, lookup);
    let response: Response;
    try {
      response = await fetchImpl(currentUrl.toString(), { redirect: "manual", signal });
    } catch (err) {
      if (isAbortError(err)) throw new Error(`Timed out fetching ${initialUrl}`);
      throw new Error(
        `Failed to fetch ${currentUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`HTTP ${response.status} from ${currentUrl} without a Location header`);
      }
      currentUrl = new URL(location, currentUrl);
      continue;
    }
    return response;
  }
  throw new Error(`Too many redirects fetching ${initialUrl} (max ${MAX_REDIRECTS})`);
}

/**
 * Fetches a public URL with SSRF protection: DNS resolution against private /
 * loopback / link-local / metadata ranges (re-validated on every redirect hop)
 * and a hard byte cap on the response body.
 */
export function createFetchUrlTool(options: FetchUrlToolOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookup: LookupFn =
    options.lookup ?? (async (hostname) => dnsLookup(hostname, { all: true }));
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return tool(
    async (input: FetchUrlInput): Promise<string> => {
      const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
      const signal = AbortSignal.timeout(timeoutMs);
      const response = await fetchWithSsrfGuard(input.url, fetchImpl, lookup, signal);
      let text: string;
      try {
        text = await readBodyCapped(response, maxBytes);
      } catch (err) {
        if (isAbortError(err)) throw new Error(`Timed out fetching ${input.url}`);
        throw err;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${input.url}`);
      }
      return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
    },
    {
      name: FETCH_URL_TOOL_NAME,
      description:
        "Fetch the textual contents of a public URL (HTML or plain text). Useful when the user pastes a link and asks for a summary or asks you to consult an external source. Long responses are truncated to ~4000 characters.",
      schema: fetchUrlInputSchema,
    },
  );
}
