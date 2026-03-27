"""
GitHub Workflow MCP Server

A FastMCP server that provides tools for interacting with GitHub pull requests.
In production, this wraps the real GitHub API. For demo purposes, it provides
realistic mock responses that simulate GitHub API interactions.

Run standalone:
    mcp dev mcp_servers/github_workflow/server.py

Or as subprocess transport from agents.
"""

import json
import logging
import os
import re
from datetime import datetime
from typing import Any, Dict, Optional

from mcp.server.fastmcp import FastMCP

logger = logging.getLogger(__name__)

# Initialize FastMCP server
mcp = FastMCP(
    name="github-workflow",
    instructions=(
        "GitHub Workflow MCP server. Provides tools for working with GitHub "
        "pull requests: fetching PR info, diffs, adding comments, and updating "
        "CI/CD check statuses."
    ),
)

# In-memory state for PR data (simulates GitHub API state)
_pr_store: Dict[str, Dict[str, Any]] = {}
_comments_store: Dict[str, list] = {}
_status_store: Dict[str, Dict[str, Any]] = {}


def _get_or_create_pr(pr_url: str) -> Dict[str, Any]:
    """Get or create a PR record from the store."""
    if pr_url not in _pr_store:
        # Extract PR number from URL if possible
        pr_num_match = re.search(r'/pull/(\d+)', pr_url)
        pr_number = int(pr_num_match.group(1)) if pr_num_match else 1

        # Extract repo from URL if possible
        repo_match = re.search(r'github\.com/([^/]+/[^/]+)', pr_url)
        repo = repo_match.group(1) if repo_match else "example-org/example-repo"

        _pr_store[pr_url] = {
            "number": pr_number,
            "title": f"feat: Add new feature for PR #{pr_number}",
            "description": (
                "## Summary\n"
                "This PR adds a new user authentication feature with the following changes:\n"
                "- New `/api/auth/login` endpoint\n"
                "- JWT token generation and validation\n"
                "- Password hashing with bcrypt\n"
                "- User session management\n\n"
                "## Test Plan\n"
                "- [ ] Unit tests for auth module\n"
                "- [ ] Integration tests for login flow\n"
                "- [ ] Security testing for JWT validation"
            ),
            "author": "dev-alice",
            "base_branch": "main",
            "head_branch": f"feature/auth-module-{pr_number}",
            "repo": repo,
            "state": "open",
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "labels": ["feature", "needs-review"],
            "milestone": "v2.0",
        }
    return _pr_store[pr_url]


def _get_mock_diff(pr_url: str) -> str:
    """Generate a realistic mock diff for a PR."""
    pr_num_match = re.search(r'/pull/(\d+)', pr_url)
    pr_number = pr_num_match.group(1) if pr_num_match else "1"

    return f"""diff --git a/src/auth/__init__.py b/src/auth/__init__.py
new file mode 100644
index 0000000..e69de29
diff --git a/src/auth/jwt_handler.py b/src/auth/jwt_handler.py
new file mode 100644
index 0000000..a1b2c3d
--- /dev/null
+++ b/src/auth/jwt_handler.py
@@ -0,0 +1,52 @@
+\"\"\"JWT token handler for authentication.\"\"\"
+import jwt
+import bcrypt
+from datetime import datetime, timedelta
+from typing import Optional, Dict, Any
+
+SECRET_KEY = "your-secret-key"  # TODO: Move to environment variable
+ALGORITHM = "HS256"
+ACCESS_TOKEN_EXPIRE_MINUTES = 30
+
+def create_access_token(data: Dict[str, Any]) -> str:
+    \"\"\"Create a new JWT access token.\"\"\"
+    to_encode = data.copy()
+    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
+    to_encode.update({{"exp": expire}})
+    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
+
+def verify_token(token: str) -> Optional[Dict[str, Any]]:
+    \"\"\"Verify and decode a JWT token.\"\"\"
+    try:
+        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
+        return payload
+    except jwt.ExpiredSignatureError:
+        return None
+    except jwt.JWTError:
+        return None
+
+def hash_password(password: str) -> str:
+    \"\"\"Hash a password using bcrypt.\"\"\"
+    salt = bcrypt.gensalt()
+    return bcrypt.hashpw(password.encode(), salt).decode()
+
+def verify_password(plain_password: str, hashed_password: str) -> bool:
+    \"\"\"Verify a password against its hash.\"\"\"
+    return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())
diff --git a/src/api/routes/auth.py b/src/api/routes/auth.py
new file mode 100644
index 0000000..b2c3d4e
--- /dev/null
+++ b/src/api/routes/auth.py
@@ -0,0 +1,38 @@
+\"\"\"Authentication API routes.\"\"\"
+from fastapi import APIRouter, HTTPException, Depends
+from pydantic import BaseModel
+from ..auth.jwt_handler import create_access_token, verify_password
+from ..db.users import get_user_by_email
+
+router = APIRouter(prefix="/api/auth", tags=["auth"])
+
+class LoginRequest(BaseModel):
+    email: str
+    password: str
+
+class TokenResponse(BaseModel):
+    access_token: str
+    token_type: str = "bearer"
+
+@router.post("/login", response_model=TokenResponse)
+async def login(request: LoginRequest):
+    \"\"\"Authenticate user and return JWT token.\"\"\"
+    user = await get_user_by_email(request.email)
+    if not user:
+        raise HTTPException(status_code=401, detail="Invalid credentials")
+    if not verify_password(request.password, user.hashed_password):
+        raise HTTPException(status_code=401, detail="Invalid credentials")
+    token = create_access_token({{"sub": user.id, "email": user.email}})
+    return TokenResponse(access_token=token)
+
+@router.post("/logout")
+async def logout():
+    \"\"\"Logout endpoint (client-side token invalidation).\"\"\"
+    return {{"message": "Logged out successfully"}}
diff --git a/tests/test_auth.py b/tests/test_auth.py
new file mode 100644
index 0000000..c3d4e5f
--- /dev/null
+++ b/tests/test_auth.py
@@ -0,0 +1,35 @@
+\"\"\"Tests for authentication module.\"\"\"
+import pytest
+from src.auth.jwt_handler import (
+    create_access_token,
+    verify_token,
+    hash_password,
+    verify_password,
+)
+
+def test_create_and_verify_token():
+    data = {{"sub": "user123", "email": "test@example.com"}}
+    token = create_access_token(data)
+    assert token is not None
+    payload = verify_token(token)
+    assert payload["sub"] == "user123"
+
+def test_password_hashing():
+    password = "SecurePassword123!"
+    hashed = hash_password(password)
+    assert verify_password(password, hashed)
+    assert not verify_password("wrong-password", hashed)
diff --git a/requirements.txt b/requirements.txt
index 1234567..abcdef0 100644
--- a/requirements.txt
+++ b/requirements.txt
@@ -5,3 +5,6 @@ fastapi==0.115.0
 uvicorn==0.30.0
 sqlalchemy==2.0.0
 alembic==1.13.0
+PyJWT==2.8.0
+bcrypt==4.1.2
+python-multipart==0.0.9
"""


@mcp.tool()
def get_pr_info(pr_url: str) -> str:
    """
    Fetch comprehensive pull request information from GitHub.

    Args:
        pr_url: The full URL of the pull request (e.g., https://github.com/org/repo/pull/123)

    Returns:
        JSON string containing PR title, description, author, branches, labels, and metadata
    """
    logger.info(f"get_pr_info called for: {pr_url}")

    # Try to use real GitHub API if token is available
    github_token = os.environ.get("GITHUB_TOKEN")
    if github_token and "github.com" in pr_url:
        try:
            import httpx
            # Parse PR URL to get API URL
            # https://github.com/owner/repo/pull/123
            match = re.match(r'https://github\.com/([^/]+)/([^/]+)/pull/(\d+)', pr_url)
            if match:
                owner, repo, pr_number = match.groups()
                api_url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}"
                headers = {
                    "Authorization": f"Bearer {github_token}",
                    "Accept": "application/vnd.github.v3+json",
                }
                response = httpx.get(api_url, headers=headers, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    return json.dumps({
                        "url": pr_url,
                        "number": data["number"],
                        "title": data["title"],
                        "description": data.get("body", ""),
                        "author": data["user"]["login"],
                        "base_branch": data["base"]["ref"],
                        "head_branch": data["head"]["ref"],
                        "state": data["state"],
                        "created_at": data["created_at"],
                        "updated_at": data["updated_at"],
                        "labels": [l["name"] for l in data.get("labels", [])],
                        "repo": f"{owner}/{repo}",
                    }, indent=2)
        except Exception as e:
            logger.warning(f"GitHub API call failed: {e}, using mock data")

    # Fall back to mock data
    pr = _get_or_create_pr(pr_url)
    return json.dumps({
        "url": pr_url,
        "number": pr["number"],
        "title": pr["title"],
        "description": pr["description"],
        "author": pr["author"],
        "base_branch": pr["base_branch"],
        "head_branch": pr["head_branch"],
        "state": pr["state"],
        "created_at": pr["created_at"],
        "updated_at": pr["updated_at"],
        "labels": pr["labels"],
        "milestone": pr.get("milestone"),
        "repo": pr.get("repo"),
        "note": "Mock data - set GITHUB_TOKEN env var for real GitHub API access",
    }, indent=2)


@mcp.tool()
def get_pr_diff(pr_url: str) -> str:
    """
    Fetch the complete diff (patch) for a pull request.

    Args:
        pr_url: The full URL of the pull request

    Returns:
        The full git diff text showing all changes in the PR
    """
    logger.info(f"get_pr_diff called for: {pr_url}")

    github_token = os.environ.get("GITHUB_TOKEN")
    if github_token and "github.com" in pr_url:
        try:
            import httpx
            match = re.match(r'https://github\.com/([^/]+)/([^/]+)/pull/(\d+)', pr_url)
            if match:
                owner, repo, pr_number = match.groups()
                api_url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}"
                headers = {
                    "Authorization": f"Bearer {github_token}",
                    "Accept": "application/vnd.github.v3.diff",
                }
                response = httpx.get(api_url, headers=headers, timeout=30)
                if response.status_code == 200:
                    return response.text
        except Exception as e:
            logger.warning(f"GitHub diff API call failed: {e}, using mock diff")

    return _get_mock_diff(pr_url)


@mcp.tool()
def add_pr_comment(pr_url: str, comment: str) -> str:
    """
    Add a review comment to a pull request.

    Args:
        pr_url: The full URL of the pull request
        comment: The comment text to add (supports Markdown)

    Returns:
        JSON string with the created comment details including comment_id
    """
    logger.info(f"add_pr_comment called for: {pr_url}")

    if pr_url not in _comments_store:
        _comments_store[pr_url] = []

    comment_id = f"comment-{len(_comments_store[pr_url]) + 1}"
    comment_data = {
        "id": comment_id,
        "body": comment,
        "author": "aidevops-bot",
        "created_at": datetime.utcnow().isoformat(),
        "url": f"{pr_url}#issuecomment-{comment_id}",
    }
    _comments_store[pr_url].append(comment_data)

    github_token = os.environ.get("GITHUB_TOKEN")
    if github_token and "github.com" in pr_url:
        try:
            import httpx
            match = re.match(r'https://github\.com/([^/]+)/([^/]+)/pull/(\d+)', pr_url)
            if match:
                owner, repo, pr_number = match.groups()
                api_url = f"https://api.github.com/repos/{owner}/{repo}/issues/{pr_number}/comments"
                headers = {
                    "Authorization": f"Bearer {github_token}",
                    "Accept": "application/vnd.github.v3+json",
                }
                response = httpx.post(
                    api_url,
                    json={"body": comment},
                    headers=headers,
                    timeout=10,
                )
                if response.status_code == 201:
                    data = response.json()
                    return json.dumps({
                        "success": True,
                        "comment_id": str(data["id"]),
                        "url": data["html_url"],
                    })
        except Exception as e:
            logger.warning(f"GitHub comment API call failed: {e}")

    logger.info(f"Comment added to {pr_url}: {comment[:100]}...")
    return json.dumps({
        "success": True,
        "comment_id": comment_id,
        "url": comment_data["url"],
        "note": "Mock - comment stored locally",
    })


@mcp.tool()
def update_pr_status(pr_url: str, status: str, message: str) -> str:
    """
    Update the CI/CD check status on a pull request.

    Args:
        pr_url: The full URL of the pull request
        status: Status to set - one of: pending, success, failure, error
        message: Human-readable status message describing the check result

    Returns:
        JSON string confirming the status update
    """
    logger.info(f"update_pr_status called: {pr_url} -> {status}")

    valid_statuses = {"pending", "success", "failure", "error", "running"}
    if status not in valid_statuses:
        return json.dumps({
            "success": False,
            "error": f"Invalid status '{status}'. Must be one of: {valid_statuses}",
        })

    _status_store[pr_url] = {
        "status": status,
        "message": message,
        "updated_at": datetime.utcnow().isoformat(),
        "updated_by": "aidevops-workflow",
    }

    return json.dumps({
        "success": True,
        "pr_url": pr_url,
        "status": status,
        "message": message,
        "updated_at": datetime.utcnow().isoformat(),
    })


@mcp.tool()
def list_changed_files(pr_url: str) -> str:
    """
    List all files changed in a pull request with change statistics.

    Args:
        pr_url: The full URL of the pull request

    Returns:
        JSON string with list of changed files including additions, deletions, and change type
    """
    logger.info(f"list_changed_files called for: {pr_url}")

    github_token = os.environ.get("GITHUB_TOKEN")
    if github_token and "github.com" in pr_url:
        try:
            import httpx
            match = re.match(r'https://github\.com/([^/]+)/([^/]+)/pull/(\d+)', pr_url)
            if match:
                owner, repo, pr_number = match.groups()
                api_url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/files"
                headers = {
                    "Authorization": f"Bearer {github_token}",
                    "Accept": "application/vnd.github.v3+json",
                }
                response = httpx.get(api_url, headers=headers, timeout=10)
                if response.status_code == 200:
                    files_data = response.json()
                    return json.dumps({
                        "files": [
                            {
                                "path": f["filename"],
                                "status": f["status"],  # added, removed, modified, renamed
                                "additions": f["additions"],
                                "deletions": f["deletions"],
                                "changes": f["changes"],
                            }
                            for f in files_data
                        ],
                        "total_files": len(files_data),
                    }, indent=2)
        except Exception as e:
            logger.warning(f"GitHub files API call failed: {e}, using mock data")

    # Mock data
    mock_files = [
        {
            "path": "src/auth/__init__.py",
            "status": "added",
            "additions": 0,
            "deletions": 0,
            "changes": 0,
        },
        {
            "path": "src/auth/jwt_handler.py",
            "status": "added",
            "additions": 52,
            "deletions": 0,
            "changes": 52,
        },
        {
            "path": "src/api/routes/auth.py",
            "status": "added",
            "additions": 38,
            "deletions": 0,
            "changes": 38,
        },
        {
            "path": "tests/test_auth.py",
            "status": "added",
            "additions": 35,
            "deletions": 0,
            "changes": 35,
        },
        {
            "path": "requirements.txt",
            "status": "modified",
            "additions": 3,
            "deletions": 0,
            "changes": 3,
        },
    ]

    return json.dumps({
        "files": mock_files,
        "total_files": len(mock_files),
        "total_additions": sum(f["additions"] for f in mock_files),
        "total_deletions": sum(f["deletions"] for f in mock_files),
        "note": "Mock data - set GITHUB_TOKEN env var for real data",
    }, indent=2)


@mcp.tool()
def get_pr_comments(pr_url: str) -> str:
    """
    Get all comments on a pull request.

    Args:
        pr_url: The full URL of the pull request

    Returns:
        JSON string with list of all PR comments
    """
    logger.info(f"get_pr_comments called for: {pr_url}")

    comments = _comments_store.get(pr_url, [])
    return json.dumps({
        "comments": comments,
        "total": len(comments),
    }, indent=2)


@mcp.tool()
def get_pr_status(pr_url: str) -> str:
    """
    Get the current CI/CD status of a pull request.

    Args:
        pr_url: The full URL of the pull request

    Returns:
        JSON string with current status information
    """
    logger.info(f"get_pr_status called for: {pr_url}")

    status = _status_store.get(pr_url, {
        "status": "pending",
        "message": "No status updates yet",
        "updated_at": datetime.utcnow().isoformat(),
    })

    return json.dumps(status, indent=2)


# Entry point for running as standalone MCP server
if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)
    logger.info("Starting GitHub Workflow MCP server...")
    mcp.run()
