"""Boot-time validation of CONFLUENCE_BASE_URL.

The REST client appends ``/rest/api/...`` directly to the configured base URL.
A wrong shape (e.g. missing ``/wiki`` on Atlassian Cloud or a URL copied from
the browser) silently produces 404s only at request time. We validate the URL
at boot so the daemon dies fast with a precise message instead of crash-looping.
"""

import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

_FORBIDDEN_PATH_FRAGMENTS = (
    "/rest/api",
    "/rest/",
    "/wiki/spaces/",
    "/wiki/display/",
    "/spaces/",
    "/display/",
    "/pages/viewpage",
)


@dataclass(frozen=True)
class ConfluenceUrlValidation:
    ok: bool
    errors: list[str] = field(default_factory=list)


def validate_confluence_base_url(raw_url: str) -> ConfluenceUrlValidation:
    errors: list[str] = []

    parsed = urlsplit(raw_url)
    if not parsed.scheme or not parsed.hostname:
        return ConfluenceUrlValidation(
            ok=False,
            errors=[
                f'CONFLUENCE_BASE_URL is not a valid URL: "{raw_url}". '
                'Expected something like "https://your-org.atlassian.net/wiki".'
            ],
        )

    if parsed.scheme not in ("https", "http"):
        errors.append(f'CONFLUENCE_BASE_URL must use http(s), got "{parsed.scheme}:".')

    path = re.sub(r"/+$", "", parsed.path)

    for fragment in _FORBIDDEN_PATH_FRAGMENTS:
        if fragment in path:
            errors.append(
                "CONFLUENCE_BASE_URL must point at the Confluence root, not a specific "
                f'space, page, or API endpoint (found "{fragment}" in the path). '
                'Strip everything after "/wiki" (Cloud) or the deployment root (Server/DC). '
                'Example: "https://your-org.atlassian.net/wiki".'
            )
            break

    hostname = parsed.hostname or ""
    is_atlassian_cloud = hostname == "atlassian.net" or hostname.endswith(".atlassian.net")

    if is_atlassian_cloud and path != "/wiki":
        errors.append(
            'CONFLUENCE_BASE_URL for Atlassian Cloud (*.atlassian.net) must end in "/wiki". '
            f'Got path "{parsed.path}". Use "https://{hostname}/wiki".'
        )

    if hostname.endswith(".atlassian.com"):
        errors.append(
            f'CONFLUENCE_BASE_URL hostname looks wrong: "{hostname}". '
            'Atlassian Cloud sites live on "*.atlassian.net", not ".atlassian.com".'
        )

    return ConfluenceUrlValidation(ok=not errors, errors=errors)
