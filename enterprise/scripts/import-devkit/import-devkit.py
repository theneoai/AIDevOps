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
import uuid
import yaml
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


class DevKitConverter:
    """Converts DevKit component.yml format to Dify DSL format"""

    def __init__(self):
        self.node_id_map = {}

    def generate_node_id(self, name: str) -> str:
        if name not in self.node_id_map:
            suffix = uuid.uuid4().hex[:8]
            self.node_id_map[name] = f"{name}-{suffix}"
        return self.node_id_map[name]

    def convert(self, component: dict) -> dict:
        kind = component.get("kind", "Workflow").lower()
        spec = component.get("spec", {})
        metadata = component.get("metadata", {})

        app_mode_map = {"workflow": "workflow", "chatflow": "chatflow", "agent": "agent"}
        app_mode = app_mode_map.get(kind, "workflow")

        if kind == "workflow":
            nodes, edges = self.convert_workflow_steps(spec, metadata)
        elif kind == "chatflow":
            nodes, edges = self.convert_chatflow_nodes(spec, metadata)
        elif kind == "agent":
            nodes, edges = self.convert_agent(spec, metadata)
        else:
            nodes, edges = self.convert_workflow_steps(spec, metadata)

        return {
            "app": {
                "description": metadata.get("description", ""),
                "icon": "\U0001F4C1",
                "icon_background": "#FFEAD5",
                "mode": app_mode,
                "name": metadata.get("name", "Unknown"),
                "use_icon_as_answer_icon": False,
            },
            "kind": "app",
            "version": "0.1.0",
            "workflow": {
                "conversation_variables": [],
                "environment_variables": [],
                "features": self.build_features(app_mode),
                "graph": {"edges": edges, "nodes": nodes, "viewport": {"x": 0, "y": 0, "zoom": 0.8}},
            },
        }

    def build_features(self, app_mode: str) -> dict:
        return {
            "file_upload": {
                "allowed_file_extensions": [".JPG", ".JPEG", ".PNG", ".GIF", ".WEBP", ".SVG"],
                "allowed_file_types": ["image"],
                "allowed_file_upload_methods": ["local_file", "remote_url"],
                "enabled": False,
                "image": {"enabled": False, "number_limits": 3, "transfer_methods": ["local_file", "remote_url"]},
                "number_limits": 3,
            },
            "opening_statement": "",
            "retriever_resource": {"enabled": False},
            "sensitive_word_avoidance": {"enabled": False},
            "speech_to_text": {"enabled": False},
            "suggested_questions": [],
            "suggested_questions_after_answer": {"enabled": False},
            "text_to_speech": {"enabled": False, "language": "", "voice": ""},
        }

    def convert_workflow_steps(self, spec: dict, metadata: dict) -> tuple:
        steps = spec.get("steps", [])
        inputs = spec.get("inputs", [])
        outputs = spec.get("outputs", [])

        if not steps:
            return [], []

        nodes = []
        edges = []

        start_node = self.create_start_node(inputs)
        nodes.append(start_node)

        prev_node_id = "start"
        for i, step in enumerate(steps):
            step_type = step.get("type", "llm")
            step_name = step.get("name", f"step-{i}")

            if step_type == "llm":
                node = self.create_llm_node(step, step_name)
            elif step_type == "tool":
                node = self.create_tool_node(step, step_name)
            elif step_type == "human-review":
                node = self.create_human_review_node(step, step_name)
            else:
                node = self.create_llm_node(step, step_name)

            nodes.append(node)

            edge = {
                "data": {"isInIteration": False, "sourceType": "start" if prev_node_id == "start" else "llm", "targetType": node["data"]["type"]},
                "id": f"edge-{prev_node_id}-{step_name}",
                "source": prev_node_id,
                "sourceHandle": "source",
                "target": node["id"],
                "targetHandle": "target",
                "type": "custom",
            }
            edges.append(edge)
            prev_node_id = node["id"]

        end_node = self.create_end_node(outputs)
        nodes.append(end_node)

        edge = {
            "data": {"isInIteration": False, "sourceType": "llm" if prev_node_id != "start" else "start", "targetType": "end"},
            "id": f"edge-{prev_node_id}-end",
            "source": prev_node_id,
            "sourceHandle": "source",
            "target": "end",
            "targetHandle": "target",
            "type": "custom",
        }
        edges.append(edge)

        return nodes, edges

    def convert_chatflow_nodes(self, spec: dict, metadata: dict) -> tuple:
        devkit_nodes = spec.get("nodes", [])
        inputs = spec.get("inputs", [])

        nodes = []
        edges = []

        start_node = self.create_start_node_chatflow(inputs)
        nodes.append(start_node)

        prev_node_id = "start"
        for i, devkit_node in enumerate(devkit_nodes):
            node_type = devkit_node.get("type", "llm")
            node_id = devkit_node.get("id", f"node-{i}")
            data = devkit_node.get("data", {})

            if node_type == "knowledge-retrieval":
                node = self.create_knowledge_retrieval_node(devkit_node, node_id)
            elif node_type == "llm":
                node = self.create_llm_node_from_chatflow(devkit_node, node_id)
            elif node_type == "answer":
                node = self.create_answer_node(devkit_node, node_id)
            else:
                node = self.create_llm_node_from_chatflow(devkit_node, node_id)

            nodes.append(node)

            edge = {
                "data": {"isInIteration": False, "sourceType": "start" if prev_node_id == "start" else "llm", "targetType": node["data"]["type"]},
                "id": f"edge-{prev_node_id}-{node_id}",
                "source": prev_node_id,
                "sourceHandle": "source",
                "target": node["id"],
                "targetHandle": "target",
                "type": "custom",
            }
            edges.append(edge)
            prev_node_id = node["id"]

        end_node = self.create_end_node([])
        nodes.append(end_node)

        edge = {
            "data": {"isInIteration": False, "sourceType": "llm", "targetType": "end"},
            "id": f"edge-{prev_node_id}-end",
            "source": prev_node_id,
            "sourceHandle": "source",
            "target": "end",
            "targetHandle": "target",
            "type": "custom",
        }
        edges.append(edge)

        return nodes, edges

    def convert_agent(self, spec: dict, metadata: dict) -> tuple:
        inputs = spec.get("inputs", [])
        outputs = spec.get("outputs", [])
        tools = spec.get("tools", [])
        model = spec.get("model", {})
        system_prompt = spec.get("systemPrompt", "")

        nodes = []
        edges = []

        start_node = self.create_start_node(inputs)
        nodes.append(start_node)

        agent_node = {
            "data": {
                "selected": False,
                "title": "Agent",
                "type": "agent",
                "variables": [],
                "model": {
                    "completion_params": {"temperature": model.get("temperature", 0.3), "max_tokens": model.get("maxTokens", 1024)},
                    "mode": "chat",
                    "name": model.get("name", "gpt-4o-mini"),
                    "provider": model.get("provider", "openai"),
                },
                "prompt": system_prompt,
                "tools": self.parse_tools(tools),
            },
            "height": 98,
            "id": "agent",
            "position": {"x": 400, "y": 282},
            "positionAbsolute": {"x": 400, "y": 282},
            "selected": False,
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "custom",
            "width": 244,
        }
        nodes.append(agent_node)

        start_edge = {
            "data": {"isInIteration": False, "sourceType": "start", "targetType": "agent"},
            "id": "edge-start-agent",
            "source": "start",
            "sourceHandle": "source",
            "target": "agent",
            "targetHandle": "target",
            "type": "custom",
        }
        edges.append(start_edge)

        end_node = self.create_end_node(outputs)
        nodes.append(end_node)

        end_edge = {
            "data": {"isInIteration": False, "sourceType": "agent", "targetType": "end"},
            "id": "edge-agent-end",
            "source": "agent",
            "sourceHandle": "source",
            "target": "end",
            "targetHandle": "target",
            "type": "custom",
        }
        edges.append(end_edge)

        return nodes, edges

    def create_start_node(self, inputs: list) -> dict:
        variables = []
        for inp in inputs:
            var_type = inp.get("type", "string")
            dify_type = "text-input" if var_type == "string" else var_type
            variables.append({
                "label": inp.get("description", inp.get("name", "")),
                "max_length": 10000,
                "options": [],
                "required": inp.get("required", True),
                "type": dify_type,
                "variable": inp.get("name", ""),
            })

        return {
            "data": {"desc": "Input start", "selected": False, "title": "Start", "type": "start", "variables": variables},
            "height": 154,
            "id": "start",
            "position": {"x": 80, "y": 282},
            "positionAbsolute": {"x": 80, "y": 282},
            "selected": False,
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "custom",
            "width": 244,
        }

    def create_start_node_chatflow(self, inputs: list) -> dict:
        variables = []
        for inp in inputs:
            if inp.get("name") == "query":
                variables.append({"label": inp.get("description", "User Query"), "max_length": 10000, "options": [], "required": True, "type": "paragraph", "variable": "query"})

        return {
            "data": {"desc": "Chat input", "selected": False, "title": "Start", "type": "start", "variables": variables},
            "height": 154,
            "id": "start",
            "position": {"x": 80, "y": 282},
            "positionAbsolute": {"x": 80, "y": 282},
            "selected": False,
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "custom",
            "width": 244,
        }

    def create_llm_node(self, step: dict, name: str) -> dict:
        model = step.get("model", {})
        prompt = step.get("prompt", "")

        return {
            "data": {
                "context": {"enabled": False, "variable_selector": []},
                "desc": step.get("description", ""),
                "model": {
                    "completion_params": {"temperature": model.get("temperature", 0), "max_tokens": model.get("maxTokens", 1024)},
                    "mode": "chat",
                    "name": model.get("name", "gpt-4o-mini"),
                    "provider": model.get("provider", "openai"),
                },
                "prompt_template": [{"id": f"system-{name}", "role": "system", "text": prompt}],
                "selected": False,
                "title": name.replace("-", " ").title(),
                "type": "llm",
                "variables": [],
                "vision": {"configs": {"detail": "high"}, "enabled": False},
            },
            "height": 98,
            "id": self.generate_node_id(name),
            "position": {"x": 400, "y": 282},
            "positionAbsolute": {"x": 400, "y": 282},
            "selected": False,
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "custom",
            "width": 244,
        }

    def create_tool_node(self, step: dict, name: str) -> dict:
        tool_ref = step.get("tool", "")
        tool_name = tool_ref.replace("ref:", "") if tool_ref.startswith("ref:") else tool_ref

        return {
            "data": {"desc": step.get("description", f"Tool: {tool_name}"), "selected": False, "title": name.replace("-", " ").title(), "type": "tool", "provider": "enterprise-tool-service", "tool": tool_name},
            "height": 98,
            "id": self.generate_node_id(name),
            "position": {"x": 400, "y": 282},
            "positionAbsolute": {"x": 400, "y": 282},
            "selected": False,
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "custom",
            "width": 244,
        }

    def create_human_review_node(self, step: dict, name: str) -> dict:
        return {
            "data": {"desc": step.get("description", "Human review required"), "selected": False, "title": name.replace("-", " ").title(), "type": "human-review", "condition": step.get("condition", ""), "approvers": step.get("approvers", []), "timeout": step.get("timeout", "24h")},
            "height": 98,
            "id": self.generate_node_id(name),
            "position": {"x": 720, "y": 282},
            "positionAbsolute": {"x": 720, "y": 282},
            "selected": False,
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "custom",
            "width": 244,
        }

    def create_knowledge_retrieval_node(self, devkit_node: dict, name: str) -> dict:
        data = devkit_node.get("data", {})
        return {
            "data": {"desc": "Knowledge retrieval", "selected": False, "title": "Knowledge Retrieval", "type": "knowledge-retrieval", "dataset_ids": [data.get("knowledgeBaseId", "")], "top_k": data.get("topK", 5), "score_threshold": data.get("scoreThreshold", 0.6)},
            "height": 98,
            "id": name,
            "position": {"x": 400, "y": 282},
            "positionAbsolute": {"x": 400, "y": 282},
            "selected": False,
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "custom",
            "width": 244,
        }

    def create_llm_node_from_chatflow(self, devkit_node: dict, name: str) -> dict:
        data = devkit_node.get("data", {})
        return {
            "data": {
                "context": {"enabled": True, "variable_selector": [name.split("-")[0], "text"]},
                "desc": "LLM processing",
                "model": {"completion_params": {"temperature": 0.1, "max_tokens": 2048}, "mode": "chat", "name": "gpt-4o", "provider": "openai"},
                "prompt_template": [{"id": f"user-{name}", "role": "user", "text": data.get("promptRef", "{{#start.query#}}")}],
                "selected": False,
                "title": "LLM",
                "type": "llm",
                "variables": [],
                "vision": {"configs": {"detail": "high"}, "enabled": False},
            },
            "height": 98,
            "id": name,
            "position": {"x": 720, "y": 282},
            "positionAbsolute": {"x": 720, "y": 282},
            "selected": False,
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "custom",
            "width": 244,
        }

    def create_answer_node(self, devkit_node: dict, name: str) -> dict:
        data = devkit_node.get("data", {})
        return {
            "data": {"desc": "Answer output", "outputs": [], "selected": False, "title": "Answer", "type": "answer", "showSources": data.get("showSources", True)},
            "height": 98,
            "id": name,
            "position": {"x": 1040, "y": 282},
            "positionAbsolute": {"x": 1040, "y": 282},
            "selected": False,
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "custom",
            "width": 244,
        }

    def parse_tools(self, tools: list) -> list:
        """Parse tools from component.yml - handles both string and dict formats"""
        result = []
        for t in tools:
            if isinstance(t, str):
                if t.startswith("ref:"):
                    tool_name = t.replace("ref:", "")
                    result.append({"provider_id": "enterprise-tool-service", "tool": tool_name})
            elif isinstance(t, dict):
                if "ref" in t:
                    tool_name = t["ref"].replace("ref:", "")
                    result.append({"provider_id": "enterprise-tool-service", "tool": tool_name})
        return result

    def create_end_node(self, outputs: list) -> dict:
        output_vars = []
        for out in outputs:
            output_vars.append({"type": "string", "value_selector": ["llm", "text"], "variable": out.get("name", "output")})

        return {
            "data": {"desc": "End", "outputs": output_vars, "selected": False, "title": "End", "type": "end"},
            "height": 98,
            "id": "end",
            "position": {"x": 1360, "y": 282},
            "positionAbsolute": {"x": 1360, "y": 282},
            "selected": False,
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "custom",
            "width": 244,
        }


def find_devkit_component_files(components_dir: Path) -> list:
    """查找所有 DevKit component.yml 文件"""
    files = []
    if not components_dir.exists():
        log.warning(f"组件目录不存在: {components_dir}")
        return files

    templates_dir = components_dir / "templates"
    if not templates_dir.exists():
        log.warning(f"模板目录不存在: {templates_dir}")
        return files

    for item in templates_dir.iterdir():
        component_yml = item / "component.yml"
        if item.is_dir() and component_yml.exists():
            files.append(component_yml)

    return files


def get_marketplace_plugins_config() -> dict:
    """从 marketplace-plugins.yaml 读取插件配置"""
    script_dir = Path(__file__).parent.parent.parent
    config_file = script_dir / "config" / "marketplace-plugins.yaml"

    if not config_file.exists():
        return {"marketplace_plugins": [], "github_plugins": []}

    try:
        with open(config_file, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
            return config or {"marketplace_plugins": [], "github_plugins": []}
    except Exception as e:
        log.warning(f"读取插件配置文件失败: {e}")
        return {"marketplace_plugins": [], "github_plugins": []}


def install_marketplace_plugins(session: requests.Session, plugin_identifiers: list) -> bool:
    """安装市场插件"""
    if not plugin_identifiers:
        return True

    log.info(f"安装 {len(plugin_identifiers)} 个市场插件...")

    install_endpoint = "/console/api/workspaces/current/plugin/install/marketplace"
    payload = {"plugin_unique_identifiers": plugin_identifiers}

    r = _api_post(session, install_endpoint, json=payload)

    if r.status_code == 409:
        log.info("插件可能已安装，跳过")
        return True

    if r.status_code != 200:
        log.error(f"插件安装请求失败: HTTP {r.status_code} - {r.text[:200]}")
        return False

    result = r.json()
    task_id = result.get("task_id")

    if not task_id:
        log.error("未收到任务 ID")
        return False

    log.info(f"插件安装任务已创建: {task_id}")

    task_endpoint = f"/console/api/workspaces/current/plugin/tasks/{task_id}"
    max_attempts = 30
    retry_delay = 2

    for attempt in range(max_attempts):
        time.sleep(retry_delay)

        task_r = _api_get(session, task_endpoint)
        if task_r.status_code != 200:
            log.warning(f"获取任务状态失败: HTTP {task_r.status_code}")
            continue

        task_data = task_r.json()
        task_info = task_data.get("task", {})
        status = task_info.get("status")

        if status == "success":
            plugins = task_info.get("plugins", [])
            for p in plugins:
                log.info(f"  已安装: {p.get('plugin_id')}")
            log.info("插件安装成功")
            return True

        if status == "failed":
            log.error("插件安装失败")
            plugins = task_info.get("plugins", [])
            for p in plugins:
                log.error(f"  {p.get('plugin_id')}: {p.get('message')}")
            return False

    log.error("插件安装超时")
    return False


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

    converter = DevKitConverter()
    all_success = True

    # 1. 导入 Dify DSL 工作流 (原生格式)
    workflows_dir = Path(WORKFLOWS_DIR)
    dsl_files = find_dify_dsl_files(workflows_dir)
    log.info(f"找到 {len(dsl_files)} 个 Dify DSL 文件")

    for dsl_file in dsl_files:
        name = dsl_file.stem
        log.info(f"处理 Dify DSL 工作流: {name}")

        if name in existing_apps:
            log.info(f"  跳过 (已存在): {name}")
            continue

        try:
            with open(dsl_file, "r", encoding="utf-8") as f:
                yaml_content = f.read()

            result = import_app(session, yaml_content, name)
            if result.get("success"):
                log.info(f"  成功: {name}")
            else:
                log.error(f"  失败: {name} - {result.get('error')}")
                all_success = False
        except Exception as e:
            log.error(f"  错误: {name} - {e}")
            all_success = False

    # 2. 转换并导入 DevKit 组件
    components_dir = Path(COMPONENTS_DIR)
    devkit_files = find_devkit_component_files(components_dir)
    log.info(f"找到 {len(devkit_files)} 个 DevKit 组件")

    for component_file in devkit_files:
        try:
            with open(component_file, "r", encoding="utf-8") as f:
                component = yaml.safe_load(f)

            name = component.get("metadata", {}).get("name", component_file.parent.name)

            if name in existing_apps:
                log.info(f"  跳过 (已存在): {name}")
                continue

            log.info(f"转换 DevKit 组件: {name}")

            dify_dsl = converter.convert(component)
            yaml_content = yaml.dump(dify_dsl, allow_unicode=True, sort_keys=False, default_flow_style=False)

            result = import_app(session, yaml_content, name)
            if result.get("success"):
                log.info(f"  成功: {name}")
            else:
                log.error(f"  失败: {name} - {result.get('error')}")
                all_success = False
        except Exception as e:
            log.error(f"  错误: {component_file.name} - {e}")
            all_success = False

    # 3. 安装市场插件
    plugin_config = get_marketplace_plugins_config()
    marketplace_plugins = plugin_config.get("marketplace_plugins", [])

    if marketplace_plugins:
        log.info(f"找到 {len(marketplace_plugins)} 个市场插件需要安装")
        if not install_marketplace_plugins(session, marketplace_plugins):
            all_success = False
    else:
        log.info("未配置需要安装的市场插件")

    if all_success:
        log.info("全部导入成功")
    else:
        log.warning("部分导入存在失败")

    return 0 if all_success else 1


if __name__ == "__main__":
    main()