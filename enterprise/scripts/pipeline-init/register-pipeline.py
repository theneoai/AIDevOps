#!/usr/bin/env python3
"""
Enterprise AI DevOps Pipeline — Dify Auto-Registration Script

Registers the Enterprise AI DevOps Pipeline into Dify on project startup.
Idempotent: skips silently if the pipeline already exists, preserving any
modifications the team may have made via the Dify UI.

Environment Variables:
  DIFY_CONSOLE_URL       Dify console base URL  (default: http://nginx)
  DIFY_CONSOLE_EMAIL     Admin email             (required)
  DIFY_CONSOLE_PASSWORD  Admin password          (required)
  PIPELINE_YAML_PATH     Path to Dify DSL YAML  (default: /app/enterprise-ai-devops-pipeline.yml)
  PIPELINE_NAME          App name to search for  (default: Enterprise AI DevOps Pipeline)
  MAX_RETRIES            Connection retry limit   (default: 20)
  RETRY_DELAY            Seconds between retries  (default: 15)
"""

import os
import sys
import time
import logging

try:
    import requests
except ImportError:
    print("[FATAL] 'requests' library not found. Install with: pip install requests")
    sys.exit(1)

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)-7s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("pipeline-init")

# ── Configuration ─────────────────────────────────────────────────────────────

CONSOLE_URL   = os.getenv("DIFY_CONSOLE_URL",   "http://nginx").rstrip("/")
EMAIL         = os.getenv("DIFY_CONSOLE_EMAIL",  "")
PASSWORD      = os.getenv("DIFY_CONSOLE_PASSWORD", "")
YAML_PATH     = os.getenv("PIPELINE_YAML_PATH",  "/app/enterprise-ai-devops-pipeline.yml")
PIPELINE_NAME = os.getenv("PIPELINE_NAME",       "Enterprise AI DevOps Pipeline")
MAX_RETRIES   = int(os.getenv("MAX_RETRIES",     "20"))
RETRY_DELAY   = int(os.getenv("RETRY_DELAY",     "15"))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get(session: requests.Session, path: str, **kwargs) -> requests.Response:
    return session.get(f"{CONSOLE_URL}{path}", timeout=30, **kwargs)


def _post(session: requests.Session, path: str, **kwargs) -> requests.Response:
    return session.post(f"{CONSOLE_URL}{path}", timeout=60, **kwargs)


# ── Step 1: Wait for Dify ─────────────────────────────────────────────────────

def wait_for_dify() -> bool:
    """Poll the Dify health endpoint until it responds or retries are exhausted."""
    health_url = f"{CONSOLE_URL}/health"
    log.info(f"Waiting for Dify console at {health_url} ...")

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(health_url, timeout=8)
            if r.status_code < 500:
                log.info(f"Dify responded (HTTP {r.status_code})")
                return True
        except Exception:
            pass
        log.info(f"  [{attempt}/{MAX_RETRIES}] not ready — retrying in {RETRY_DELAY}s")
        time.sleep(RETRY_DELAY)

    log.error("Dify did not become ready within the retry window.")
    return False


# ── Step 2: Login ─────────────────────────────────────────────────────────────

def login(session: requests.Session) -> str:
    """Authenticate with the Dify console API and return the access token."""
    log.info(f"Authenticating as {EMAIL} ...")
    payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "remember_me": True,
        "language": "zh-Hans",
    }
    r = _post(session, "/console/api/login", json=payload)

    if r.status_code not in (200, 201):
        raise RuntimeError(
            f"Login failed: HTTP {r.status_code} — {r.text[:300]}"
        )

    body = r.json()

    # Dify v1.x wraps the token in data.access_token
    # Dify v0.x may put it at the top level
    token = (
        (body.get("data") or {}).get("access_token")
        or body.get("access_token")
        or body.get("token")
    )

    if not token:
        raise RuntimeError(f"No access_token in login response: {body}")

    session.headers.update({"Authorization": f"Bearer {token}"})
    log.info("Login successful.")
    return token


# ── Step 3: Check if pipeline already exists ──────────────────────────────────

def find_pipeline(session: requests.Session) -> dict | None:
    """Return the first app matching PIPELINE_NAME, or None."""
    page = 1
    while page <= 10:                           # guard: max 10 pages
        r = _get(session, "/console/api/apps",
                 params={"page": page, "page_size": 20, "mode": "workflow"})
        if not r.ok:
            log.warning(f"Could not list apps: HTTP {r.status_code}")
            return None

        body = r.json()
        apps = body.get("data", [])

        for app in apps:
            if app.get("name") == PIPELINE_NAME:
                return app

        # Pagination: stop if we have seen all items
        total = body.get("total", 0)
        seen = (page - 1) * 20 + len(apps)
        if seen >= total or not apps:
            break
        page += 1

    return None


# ── Step 4: Import pipeline from DSL YAML ─────────────────────────────────────

def import_pipeline(session: requests.Session, yaml_content: str) -> dict:
    """
    Import the pipeline into Dify via the Console API.

    Tries the v1.x endpoint first; falls back to the v0.x path if the
    server returns 404.  Both endpoints expect the Dify DSL YAML as a
    JSON-encoded string in the 'data' field.
    """
    payload = {"data": yaml_content, "mode": "yaml-content"}

    # Dify ≥ 1.0
    r = _post(session, "/console/api/apps/import", json=payload)

    if r.status_code == 404:
        log.debug("Primary import endpoint not found, trying legacy path ...")
        r = _post(session, "/console/api/app/import", json=payload)

    if not r.ok:
        raise RuntimeError(
            f"Pipeline import failed: HTTP {r.status_code} — {r.text[:500]}"
        )

    result = r.json()
    return result


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    log.info("=" * 60)
    log.info("  Enterprise AI DevOps Pipeline — Dify Registration")
    log.info("=" * 60)

    # Validate required configuration
    if not EMAIL or not PASSWORD:
        log.error(
            "DIFY_CONSOLE_EMAIL and DIFY_CONSOLE_PASSWORD must be set. "
            "Add them to your .env file."
        )
        sys.exit(1)

    # Load workflow DSL
    if not os.path.exists(YAML_PATH):
        log.error(f"Pipeline YAML not found at: {YAML_PATH}")
        sys.exit(1)

    with open(YAML_PATH, "r", encoding="utf-8") as fh:
        yaml_content = fh.read()
    log.info(f"Loaded pipeline DSL ({len(yaml_content):,} bytes) from {YAML_PATH}")

    # Wait for Dify to start
    if not wait_for_dify():
        sys.exit(1)

    # Extra grace period — Dify may still be initialising its DB connections
    time.sleep(5)

    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})

    # Authenticate
    try:
        login(session)
    except Exception as exc:
        log.error(f"Authentication error: {exc}")
        sys.exit(1)

    # Idempotency check — skip if the pipeline already exists
    existing = find_pipeline(session)
    if existing:
        app_id = existing.get("id", "unknown")
        log.info(f"Pipeline '{PIPELINE_NAME}' already registered (id: {app_id}).")
        log.info(f"  View in Dify UI → {CONSOLE_URL}/app/{app_id}/workflow")
        log.info("Nothing to do — exiting cleanly.")
        return

    # Import the pipeline
    log.info(f"Creating '{PIPELINE_NAME}' in Dify ...")
    try:
        result = import_pipeline(session, yaml_content)
    except Exception as exc:
        log.error(f"Import error: {exc}")
        sys.exit(1)

    app_id = result.get("id", "unknown")
    log.info(f"Pipeline created successfully! (id: {app_id})")
    log.info(f"  View in Dify UI → {CONSOLE_URL}/app/{app_id}/workflow")
    log.info("Registration complete.")


if __name__ == "__main__":
    main()
