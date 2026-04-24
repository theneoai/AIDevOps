#!/usr/bin/env python3
"""
DevKit Components — Dify Auto-Import Script

自动将 DevKit 组件和 Dify DSL 工作流导入到 Dify 工作区。
幂等设计：若应用已存在则跳过。

环境变量:
  DIFY_CONSOLE_URL       Dify 控制台地址  (默认: http://nginx)
  DIFY_CONSOLE_EMAIL     管理员邮箱        (必填)
  DIFY_CONSOLE_PASSWORD  管理员密码        (必填)
  COMPONENTS_DIR         组件目录          (默认: /app/enterprise/components)
  WORKFLOWS_DIR          工作流目录         (默认: /app/enterprise/workflows)
  MAX_RETRIES            连接重试次数       (默认: 30)
  RETRY_DELAY            重试间隔(秒)      (默认: 10)
"""

import os
import sys
import json
import logging
import time
import base64
from pathlib import Path
from typing import Optional

try:
    import requests
except ImportError:
    print("[FATAL] 'requests' library not found")
    sys.exit(1)

# Load .env file if it exists
def load_dotenv():
    script_dir = Path(__file__).parent.resolve()
    possible_paths = [
        script_dir / ".env",
        script_dir.parent / ".env",
        script_dir.parent.parent / ".env",
        script_dir.parent.parent.parent / ".env",
        script_dir.parent.parent.parent.parent / ".env",
    ]
    for p in possible_paths:
        if p.exists() and p.is_file():
            with open(p) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, value = line.split("=", 1)
                        key = key.strip()
                        value = value.strip().strip('"').strip("'")
                        os.environ.setdefault(key, value)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)-7s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("import-devkit")

IN_DOCKER = os.path.exists("/.dockerenv")
CONSOLE_URL = os.getenv("DIFY_CONSOLE_URL", "http://localhost" if not IN_DOCKER else "http://nginx").rstrip("/")
EMAIL = os.getenv("DIFY_CONSOLE_EMAIL", "")
PASSWORD = os.getenv("DIFY_CONSOLE_PASSWORD", "")

if IN_DOCKER:
    COMPONENTS_DIR = os.getenv("COMPONENTS_DIR", "/app/enterprise/components")
    WORKFLOWS_DIR = os.getenv("WORKFLOWS_DIR", "/app/enterprise/workflows")
else:
    repo_root = Path(__file__).parent.parent.parent
    COMPONENTS_DIR = os.getenv("COMPONENTS_DIR", str(repo_root / "components"))
    WORKFLOWS_DIR = os.getenv("WORKFLOWS_DIR", str(repo_root / "workflows"))

MAX_RETRIES = int(os.getenv("MAX_RETRIES", "30"))
RETRY_DELAY = int(os.getenv("RETRY_DELAY", "10"))


def _get(session: requests.Session, path: str, **kwargs) -> requests.Response:
    return session.get(f"{CONSOLE_URL}{path}", timeout=30, **kwargs)


def _post(session: requests.Session, path: str, **kwargs) -> requests.Response:
    return session.post(f"{CONSOLE_URL}{path}", timeout=60, **kwargs)


def wait_for_dify_console(session: requests.Session) -> bool:
    """等待 Dify Console API 就绪"""
    for i in range(MAX_RETRIES):
        try:
            resp = _api_get(session, "/console/api/ping")
            if resp.status_code == 200:
                log.info("Dify Console API 已就绪")
                return True
        except requests.RequestException:
            pass
        log.info(f"等待 Dify 就绪... ({i+1}/{MAX_RETRIES})")
        time.sleep(RETRY_DELAY)
    return False


def login(session: requests.Session) -> str:
    """登录 Dify Console 并返回 access_token"""
    log.info(f"正在登录 Dify Console: {CONSOLE_URL}")

    encoded_password = base64.b64encode(PASSWORD.encode("utf-8")).decode("utf-8")
    payload = {
        "email": EMAIL,
        "password": encoded_password,
        "language": "zh-Hans",
    }
    r = _post(session, "/console/api/login", json=payload)

    if r.status_code != 200:
        raise RuntimeError(f"登录失败: HTTP {r.status_code} — {r.text[:300]}")

    body = r.json()
    token = (
        (body.get("data") or {}).get("access_token")
        or body.get("access_token")
        or body.get("token")
    )

    # If no token in body, try to get from cookies
    if not token:
        for name in session.cookies.keys():
            if name == "access_token":
                token = session.cookies.get(name)
                break

    if not token:
        raise RuntimeError(f"登录响应中没有 access_token: {body}")

    session.headers.update({"Authorization": f"Bearer {token}"})
    log.info("登录成功")
    return token


def get_csrf_token(session: requests.Session) -> Optional[str]:
    """从 cookie 中提取 CSRF token"""
    for name in session.cookies.keys():
        if name == "csrf_token":
            return session.cookies.get(name)
    return None


def _api_get(session: requests.Session, path: str, **kwargs) -> requests.Response:
    """带 CSRF token 的 GET 请求"""
    csrf = get_csrf_token(session)
    if csrf:
        session.headers["X-CSRF-Token"] = csrf
    return session.get(f"{CONSOLE_URL}{path}", timeout=30, **kwargs)


def _api_post(session: requests.Session, path: str, **kwargs) -> requests.Response:
    """带 CSRF token 的 POST 请求"""
    csrf = get_csrf_token(session)
    if csrf:
        session.headers["X-CSRF-Token"] = csrf
    return session.post(f"{CONSOLE_URL}{path}", timeout=60, **kwargs)


def get_existing_apps(session: requests.Session) -> dict:
    """获取已存在的应用列表，返回 {name: app_info}"""
    apps = {}
    page = 1
    while page <= 10:
        r = _api_get(session, "/console/api/apps", params={"page": page, "page_size": 50})
        if not r.ok:
            log.warning(f"获取应用列表失败: HTTP {r.status_code}")
            break

        body = r.json()
        for app in body.get("data", []):
            apps[app.get("name", "")] = app

        total = body.get("total", 0)
        seen = (page - 1) * 50 + len(body.get("data", []))
        if seen >= total or not body.get("data"):
            break
        page += 1

    return apps


def import_app(session: requests.Session, yaml_content: str, name: str) -> dict:
    """导入 DSL YAML 应用"""
    payload = {"yaml_content": yaml_content, "mode": "yaml-content"}

    r = _api_post(session, "/console/api/apps/imports", json=payload)

    if r.status_code == 404:
        r = _api_post(session, "/console/api/app/imports", json=payload)

    if not r.ok:
        return {"success": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}

    return {"success": True, "data": r.json()}


def find_dify_dsl_files(workflows_dir: Path) -> list:
    """查找所有 Dify DSL YAML 文件"""
    files = []
    if not workflows_dir.exists():
        log.warning(f"工作流目录不存在: {workflows_dir}")
        return files

    for item in workflows_dir.iterdir():
        if item.is_file() and item.suffix in (".yml", ".yaml"):
            files.append(item)
    return files


def main():
    if not EMAIL or not PASSWORD:
        log.error("DIFY_CONSOLE_EMAIL 和 DIFY_CONSOLE_PASSWORD 必须设置")
        sys.exit(1)

    session = requests.Session()
    login(session)

    if not wait_for_dify_console(session):
        log.error("Dify Console API 未响应")
        sys.exit(1)

    existing_apps = get_existing_apps(session)
    log.info(f"已存在的应用: {list(existing_apps.keys())}")

    # 导入 Dify DSL 工作流
    workflows_dir = Path(WORKFLOWS_DIR)
    dsl_files = find_dify_dsl_files(workflows_dir)
    log.info(f"找到 {len(dsl_files)} 个 Dify DSL 文件")

    success_count = 0
    for dsl_file in dsl_files:
        name = dsl_file.stem
        log.info(f"处理工作流: {name}")

        if name in existing_apps:
            log.info(f"  跳过 (已存在): {name}")
            continue

        try:
            with open(dsl_file, "r", encoding="utf-8") as f:
                yaml_content = f.read()

            result = import_app(session, yaml_content, name)
            if result.get("success"):
                log.info(f"  成功: {name}")
                success_count += 1
            else:
                log.error(f"  失败: {name} - {result.get('error')}")
        except Exception as e:
            log.error(f"  错误: {name} - {e}")

    log.info(f"导入完成: {success_count}/{len(dsl_files)} 成功")


if __name__ == "__main__":
    main()