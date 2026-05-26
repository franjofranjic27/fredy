// The Confluence REST client appends `/rest/api/...` directly to the configured
// base URL (see client.ts). A wrong shape (e.g. missing `/wiki` on Atlassian Cloud
// or a URL copied from the browser) silently produces 404s like
// `"Site temporarily unavailable"` only at request time. We validate the URL at
// boot so the daemon dies fast with a precise message instead of crash-looping.

export interface ConfluenceUrlValidation {
  ok: boolean;
  errors: string[];
}

const FORBIDDEN_PATH_FRAGMENTS = [
  "/rest/api",
  "/rest/",
  "/wiki/spaces/",
  "/wiki/display/",
  "/spaces/",
  "/display/",
  "/pages/viewpage",
];

export function validateConfluenceBaseUrl(rawUrl: string): ConfluenceUrlValidation {
  const errors: string[] = [];

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      errors: [
        `CONFLUENCE_BASE_URL is not a valid URL: "${rawUrl}". ` +
          `Expected something like "https://your-org.atlassian.net/wiki".`,
      ],
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    errors.push(`CONFLUENCE_BASE_URL must use http(s), got "${parsed.protocol}".`);
  }

  const path = parsed.pathname.replace(/\/+$/, "");

  for (const fragment of FORBIDDEN_PATH_FRAGMENTS) {
    if (path.includes(fragment)) {
      errors.push(
        `CONFLUENCE_BASE_URL must point at the Confluence root, not a specific ` +
          `space, page, or API endpoint (found "${fragment}" in the path). ` +
          `Strip everything after "/wiki" (Cloud) or the deployment root (Server/DC). ` +
          `Example: "https://your-org.atlassian.net/wiki".`,
      );
      break;
    }
  }

  const isAtlassianCloud =
    parsed.hostname === "atlassian.net" || parsed.hostname.endsWith(".atlassian.net");

  if (isAtlassianCloud && path !== "/wiki") {
    errors.push(
      `CONFLUENCE_BASE_URL for Atlassian Cloud (*.atlassian.net) must end in "/wiki". ` +
        `Got path "${parsed.pathname}". Use "https://${parsed.hostname}/wiki".`,
    );
  }

  if (parsed.hostname.endsWith(".atlassian.com")) {
    errors.push(
      `CONFLUENCE_BASE_URL hostname looks wrong: "${parsed.hostname}". ` +
        `Atlassian Cloud sites live on "*.atlassian.net", not ".atlassian.com".`,
    );
  }

  return { ok: errors.length === 0, errors };
}
