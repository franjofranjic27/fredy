import { lookup } from "node:dns/promises";
import { z } from "zod";
import type { Tool } from "./types.js";

const FETCH_TIMEOUT_MS = 10_000;
const BODY_TRUNCATE_BYTES = 2000;

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8 loopback
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) // 192.168.0.0/16
  );
}

function isPrivateIpv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  return (
    lower === "::1" || // loopback
    lower === "::" || // unspecified
    lower.startsWith("::ffff:") || // IPv4-mapped / IPv4-translated
    lower.startsWith("fc") || // unique-local fc00::/7
    lower.startsWith("fd") || // unique-local fd00::/7
    lower.startsWith("fe8") || // link-local fe80::/10 (fe80-febf)
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  );
}

/**
 * Resolves a hostname via the OS resolver and returns true if every resolved
 * address is a private/loopback/link-local address, or DNS fails.
 * Fails safe: unknown hostname → treat as private.
 */
async function resolvedToPrivate(hostname: string): Promise<boolean> {
  try {
    const results = await lookup(hostname, { all: true });
    return results.some(({ address }) =>
      address.includes(":") ? isPrivateIpv6(address) : isPrivateIpv4(address),
    );
  } catch {
    return true; // DNS failure → fail safe
  }
}

/**
 * Returns true if the URL should be blocked:
 * - unparseable URL
 * - non-http(s) scheme
 * - hostname resolves to a private/internal IP
 *
 * Known limitation: DNS rebinding attacks that occur *after* the lookup call
 * cannot be fully prevented without a custom fetch agent that pins the resolved
 * IP. HTTP redirects are blocked via redirect: "manual" in the fetch call.
 */
async function isPrivateUrl(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;

  const hostname = parsed.hostname;

  // IPv4 literal — WHATWG parser normalises hex/octal/decimal to dotted-decimal
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return isPrivateIpv4(hostname);
  }

  // IPv6 literal — URL parser strips the enclosing brackets
  if (hostname.includes(":")) {
    return isPrivateIpv6(hostname);
  }

  // Named hostname — resolve to catch DNS rebinding
  return resolvedToPrivate(hostname);
}

export const fetchUrlTool: Tool<{ url: string }, { status: number; body: string }> = {
  name: "fetch_url",
  description: "Fetches content from a URL and returns the response body",
  inputSchema: z.object({
    url: z.url().describe("The URL to fetch"),
  }),
  async execute({ url }) {
    if (await isPrivateUrl(url)) {
      throw new Error("URL targets a private/internal host");
    }
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error("URL redirects are not allowed");
    }
    const body = await response.text();
    return {
      status: response.status,
      body: body.slice(0, BODY_TRUNCATE_BYTES),
    };
  },
};
