#!/usr/bin/env python3
"""
DevKit Components — Dify Auto-Import Script

自动将 DevKit 组件导入到 Dify 工作区。
幂等设计：若组件已存在则跳过。

环境变量:
  DIFY_CONSOLE_URL       Dify 控制台地址  (默认: http://nginx)
  DIFY_CONSOLE_EMAIL     管理员邮箱        (必填)
  DIFY_CONSOLE_PASSWORD  管理员密码        (必填)
  COMPONENTS_DIR         组件目录          (默认: /app/enterprise/components)
  MAX_RETRIES            连接重试次数       (默认: 30)
  RETRY_DELAY            重试间隔(秒)      (默认: 10)
"""

import os
import sys
import json
import logging
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("[FATAL] 'requests' library not found")
    sys.exit(1)

try:
    import yaml
except ImportError:
    print("[FATAL] 'pyyaml' library not found")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)-7s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("import-devkit")

CONSOLE_URL = os.getenv("DIFY_CONSOLE_URL", "http://nginx").rstrip("/")
EMAIL = os.getenv("DIFY_CONSOLE_EMAIL", "")
PASSWORD = os.getenv("DIFY_CONSOLE_PASSWORD", "")
COMPONENTS_DIR = os.getenv("COMPONENTS_DIR", "/app/enterprise/components")
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "30"))
RETRY_DELAY = int(os.getenv("RETRY_DELAY", "10"))


def wait_for_dify_console(session: requests.Session) -> bool:
    """等待 Dify Console API 就绪"""
    for i in range(MAX_RETRIES):
        try:
            resp = session.get(f"{CONSOLE_URL}/console/api/health", timeout=10)
            if resp.status_code == 200:
                log.info("Dify Console API 已就绪")
                return True
        except requests.RequestException:
            pass
        log.info(f"等待 Dify 就绪... ({i+1}/{MAX_RETRIES})")
        time.sleep(RETRY_DELAY)
    return False


def login_to_dify(email: str, password: str) -> requests.Session | None:
    """登录 Dify Console 并返回认证会话"""
    session = requests.Session()

    log.info(f"正在登录 Dify Console: {CONSOLE_URL}")

    try:
        resp = session.post(
            f"{CONSOLE_URL}/console/api/login",
            json={"email": email, "password": password, "language": "zh-Hans"},
            timeout=30,
        )
        if resp.status_code == 200:
            log.info("登录成功")
            return session
        else:
            log.error(f"登录失败: {resp.status_code} {resp.text}")
    except requests.RequestException as e:
        log.error(f"登录请求失败: {e}")

    return None


def get_workspace_id(session: requests.Session) -> str | None:
    """获取当前工作区 ID"""
    try:
        resp = session.get(f"{CONSOLE_URL}/console/api/workspaces/current", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            ws_id = data.get("data", {}).get("id")
            log.info(f"工作区 ID: {ws_id}")
            return ws_id
    except requests.RequestException as e:
        log.error(f"获取工作区失败: {e}")
    return None


def list_existing_providers(session: requests.Session) -> dict[str, str]:
    """获取已存在的工具提供商列表，返回 {name: id}"""
    providers = {}
    try:
        resp = session.get(
            f"{CONSOLE_URL}/console/api/workspaces/current/tool-provider/api/list",
            timeout=15,
        )
        if resp.status_code == 200:
            data = resp.json().get("data", [])
            for p in data:
                providers[p.get("provider", "")] = p.get("id", "")
    except requests.RequestException as e:
        log.warning(f"获取已存在提供商列表失败: {e}")
    return providers


def import_tool_provider(session: requests.Session, provider_data: dict) -> dict:
    """导入工具提供商"""
    try:
        resp = session.post(
            f"{CONSOLE_URL}/console/api/workspaces/current/tool-provider/api/add",
            json=provider_data,
            timeout=30,
        )
        if resp.status_code in (200, 201):
            return {"success": True, "data": resp.json()}
        return {"success": False, "error": f"{resp.status_code}: {resp.text}"}
    except requests.RequestException as e:
        return {"success": False, "error": str(e)}


def convert_component_to_provider(name: str, yaml_content: str) -> dict | None:
    """将 DevKit 组件 YAML 转换为 Dify 工具提供商格式"""
    try:
        dsl = yaml.safe_load(yaml_content)
    except Exception as e:
        log.error(f"YAML 解析失败 ({name}): {e}")
        return None

    if not dsl:
        return None

    kind = dsl.get("kind", "")
    metadata = dsl.get("metadata", {})
    spec = dsl.get("spec", {})

    auth = spec.get("authentication", {})
    auth_type = auth.get("type", "api_key") if auth else "api_key"

    credentials = {"auth_type": auth_type}
    if auth_type == "api_key":
        credentials["api_key_header"] = auth.get("keyName", "X-API-Key")
        credentials["api_key_value"] = auth.get("keyValue", "")

    provider = {
        "provider": metadata.get("name", name),
        "icon": metadata.get(
            "icon", "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg"
        ),
        "credentials": json.dumps(credentials),
        "schema_type": "openapi",
        "schema_": yaml_content,
        "custom_disclaimer": metadata.get("description", ""),
        "labels": metadata.get("tags", []),
    }

    return provider


def find_components(components_path: Path) -> list:
    """查找所有 DevKit 组件"""
    components = []
    templates_dir = components_path / "templates"

    if not templates_dir.exists():
        log.warning(f"组件模板目录不存在: {templates_dir}")
        return components

    for item in templates_dir.iterdir():
        if item.is_dir():
            component_file = item / "component.yml"
            if component_file.exists():
                try:
                    with open(component_file, "r", encoding="utf-8") as f:
                        content = f.read()
                        dsl = yaml.safe_load(content)
                        kind = dsl.get("kind", "Unknown") if dsl else "Unknown"
                        components.append(
                            {
                                "name": item.name,
                                "path": component_file,
                                "kind": kind,
                                "content": content,
                            }
                        )
                except Exception as e:
                    log.error(f"读取组件失败 {component_file}: {e}")

    return components


def main():
    if not EMAIL or not PASSWORD:
        log.error("DIFY_CONSOLE_EMAIL 和 DIFY_CONSOLE_PASSWORD 必须设置")
        sys.exit(1)

    components_path = Path(COMPONENTS_DIR)
    if not components_path.exists():
        log.error(f"组件目录不存在: {components_path}")
        sys.exit(1)

    session = login_to_dify(EMAIL, PASSWORD)
    if not session:
        sys.exit(1)

    if not wait_for_dify_console(session):
        log.error("Dify Console API 未响应")
        sys.exit(1)

    workspace_id = get_workspace_id(session)
    if not workspace_id:
        log.error("无法获取工作区 ID")
        sys.exit(1)

    existing = list_existing_providers(session)
    log.info(f"已存在的提供商: {list(existing.keys())}")

    components = find_components(components_path)
    if not components:
        log.info("未找到 DevKit 组件")
        return

    log.info(f"找到 {len(components)} 个 DevKit 组件")

    success_count = 0
    for comp in components:
        name = comp["name"]

        if name in existing:
            log.info(f"  跳过 (已存在): {name}")
            continue

        log.info(f"导入 {comp['kind']}: {name}")

        provider_data = convert_component_to_provider(name, comp["content"])
        if not provider_data:
            log.error(f"  转换失败: {name}")
            continue

        result = import_tool_provider(session, provider_data)

        if result.get("success"):
            log.info(f"  成功: {name}")
            success_count += 1
        else:
            log.error(f"  失败: {name} - {result.get('error')}")

    log.info(f"导入完成: {success_count}/{len(components)} 成功")


if __name__ == "__main__":
    main()