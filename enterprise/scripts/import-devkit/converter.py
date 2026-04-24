#!/usr/bin/env python3
"""
DevKit Component → Dify DSL Converter

Converts DevKit component.yml format to Dify DSL format for import.

DevKit format (source):
  apiVersion: dify.enterprise/v1
  kind: Workflow|Chatflow|Agent
  spec:
    steps/nodes: custom DevKit format
    inputs/outputs: variable definitions

Dify DSL format (target):
  app:
    mode: workflow|chatflow|agent
    name: ...
  workflow:
    graph:
      nodes: Dify node objects
      edges: Dify edge objects
"""

import uuid
import yaml
from pathlib import Path
from typing import Any


NODE_ID_MAP = {}


def generate_node_id(name: str) -> str:
    if name not in NODE_ID_MAP:
        safe_name = name.replace("-", "-").replace("_", "-")
        suffix = uuid.uuid4().hex[:8]
        NODE_ID_MAP[name] = f"{safe_name}-{suffix}"
    return NODE_ID_MAP[name]


def devkit_to_dify_workflow(component: dict) -> dict:
    kind = component.get("kind", "Workflow").lower()
    spec = component.get("spec", {})
    metadata = component.get("metadata", {})

    app_mode = {
        "workflow": "workflow",
        "chatflow": "advanced-chat",
        "agent": "workflow",
    }.get(kind, "workflow")

    nodes = []
    edges = []

    if kind == "workflow":
        nodes, edges = convert_workflow_steps(spec, metadata)
    elif kind == "chatflow":
        nodes, edges = convert_chatflow_nodes(spec, metadata)
    elif kind == "agent":
        nodes, edges = convert_agent(spec, metadata)

    dify_dsl = {
        "app": {
            "description": metadata.get("description", ""),
            "icon": "\U0001F4C1",
            "icon_background": "#FFEAD5",
            "mode": app_mode,
            "name": metadata.get("name", "Unknown"),
            "use_icon_as_answer_icon": False,
        },
        "kind": "app",
        "version": "0.6.0",
        "workflow": {
            "conversation_variables": [],
            "environment_variables": [],
            "features": build_features(app_mode),
            "graph": {
                "edges": edges,
                "nodes": nodes,
                "viewport": {"x": 0, "y": 0, "zoom": 0.8},
            },
        },
    }

    return dify_dsl


def build_features(app_mode: str) -> dict:
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


def convert_workflow_steps(spec: dict, metadata: dict) -> tuple:
    steps = spec.get("steps", [])
    inputs = spec.get("inputs", [])
    outputs = spec.get("outputs", [])

    if not steps:
        return [], []

    nodes = []
    edges = []

    start_node = create_start_node(inputs)
    nodes.append(start_node)

    prev_node_id = "start"
    for i, step in enumerate(steps):
        step_type = step.get("type", "llm")
        step_name = step.get("name", f"step-{i}")

        if step_type == "llm":
            node = create_llm_node(step, step_name)
        elif step_type == "tool":
            node = create_tool_node(step, step_name)
        elif step_type == "human-review":
            node = create_human_review_node(step, step_name)
        else:
            node = create_llm_node(step, step_name)

        nodes.append(node)

        edge = {
            "data": {
                "isInIteration": False,
                "sourceType": "start" if prev_node_id == "start" else "llm",
                "targetType": node["data"]["type"],
            },
            "id": f"edge-{prev_node_id}-{step_name}",
            "source": prev_node_id,
            "sourceHandle": "source",
            "target": node["id"],
            "targetHandle": "target",
            "type": "custom",
        }
        edges.append(edge)
        prev_node_id = node["id"]

    end_node = create_end_node(outputs)
    nodes.append(end_node)

    edge = {
        "data": {
            "isInIteration": False,
            "sourceType": "llm" if prev_node_id != "start" else "start",
            "targetType": "end",
        },
        "id": f"edge-{prev_node_id}-end",
        "source": prev_node_id,
        "sourceHandle": "source",
        "target": "end",
        "targetHandle": "target",
        "type": "custom",
    }
    edges.append(edge)

    return nodes, edges


def convert_chatflow_nodes(spec: dict, metadata: dict) -> tuple:
    devkit_nodes = spec.get("nodes", [])
    inputs = spec.get("inputs", [])

    nodes = []
    edges = []

    start_node = create_start_node_chatflow(inputs)
    nodes.append(start_node)

    prev_node_id = "start"
    for i, devkit_node in enumerate(devkit_nodes):
        node_type = devkit_node.get("type", "llm")
        node_id = devkit_node.get("id", f"node-{i}")
        data = devkit_node.get("data", {})

        if node_type == "knowledge-retrieval":
            node = create_knowledge_retrieval_node(devkit_node, node_id)
        elif node_type == "llm":
            node = create_llm_node_from_chatflow(devkit_node, node_id)
        elif node_type == "answer":
            node = create_answer_node(devkit_node, node_id)
        else:
            node = create_llm_node_from_chatflow(devkit_node, node_id)

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

    end_node = create_end_node([])
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


def convert_agent(spec: dict, metadata: dict) -> tuple:
    inputs = spec.get("inputs", [])
    outputs = spec.get("outputs", [])
    tools = spec.get("tools", [])
    model = spec.get("model", {})
    system_prompt = spec.get("systemPrompt", "")

    nodes = []
    edges = []

    start_node = create_start_node(inputs)
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
            "tools": parse_tools(tools),
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

    end_node = create_end_node(outputs)
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


def parse_tools(tools: list) -> list:
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


def create_start_node(inputs: list) -> dict:
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
        "data": {
            "desc": "Input start",
            "selected": False,
            "title": "Start",
            "type": "start",
            "variables": variables,
        },
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


def create_start_node_chatflow(inputs: list) -> dict:
    variables = []
    for inp in inputs:
        if inp.get("name") == "query":
            variables.append({
                "label": inp.get("description", "User Query"),
                "max_length": 10000,
                "options": [],
                "required": True,
                "type": "paragraph",
                "variable": "query",
            })

    return {
        "data": {
            "desc": "Chat input",
            "selected": False,
            "title": "Start",
            "type": "start",
            "variables": variables,
        },
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


def create_llm_node(step: dict, name: str) -> dict:
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
        "id": generate_node_id(name),
        "position": {"x": 400, "y": 282},
        "positionAbsolute": {"x": 400, "y": 282},
        "selected": False,
        "sourcePosition": "right",
        "targetPosition": "left",
        "type": "custom",
        "width": 244,
    }


def create_tool_node(step: dict, name: str) -> dict:
    tool_ref = step.get("tool", "")
    tool_name = tool_ref.replace("ref:", "") if tool_ref.startswith("ref:") else tool_ref

    input_text = ""
    if isinstance(step.get("input"), dict):
        input_text = str(step.get("input", {}))

    return {
        "data": {
            "desc": step.get("description", f"Tool: {tool_name}"),
            "selected": False,
            "title": name.replace("-", " ").title(),
            "type": "tool",
            "provider": "enterprise-tool-service",
            "tool": tool_name,
            "input": input_text,
        },
        "height": 98,
        "id": generate_node_id(name),
        "position": {"x": 400, "y": 282},
        "positionAbsolute": {"x": 400, "y": 282},
        "selected": False,
        "sourcePosition": "right",
        "targetPosition": "left",
        "type": "custom",
        "width": 244,
    }


def create_human_review_node(step: dict, name: str) -> dict:
    return {
        "data": {
            "desc": step.get("description", "Human review required"),
            "selected": False,
            "title": name.replace("-", " ").title(),
            "type": "human-review",
            "condition": step.get("condition", ""),
            "approvers": step.get("approvers", []),
            "timeout": step.get("timeout", "24h"),
        },
        "height": 98,
        "id": generate_node_id(name),
        "position": {"x": 720, "y": 282},
        "positionAbsolute": {"x": 720, "y": 282},
        "selected": False,
        "sourcePosition": "right",
        "targetPosition": "left",
        "type": "custom",
        "width": 244,
    }


def create_knowledge_retrieval_node(devkit_node: dict, name: str) -> dict:
    data = devkit_node.get("data", {})
    return {
        "data": {
            "desc": "Knowledge retrieval",
            "selected": False,
            "title": "Knowledge Retrieval",
            "type": "knowledge-retrieval",
            "dataset_ids": [data.get("knowledgeBaseId", "")],
            "top_k": data.get("topK", 5),
            "score_threshold": data.get("scoreThreshold", 0.6),
        },
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


def create_llm_node_from_chatflow(devkit_node: dict, name: str) -> dict:
    data = devkit_node.get("data", {})
    return {
        "data": {
            "context": {"enabled": True, "variable_selector": [name.replace("-", "-").split("-")[0], "text"]},
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


def create_answer_node(devkit_node: dict, name: str) -> dict:
    data = devkit_node.get("data", {})
    return {
        "data": {
            "desc": "Answer output",
            "outputs": [],
            "selected": False,
            "title": "Answer",
            "type": "answer",
            "showSources": data.get("showSources", True),
        },
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


def create_end_node(outputs: list) -> dict:
    output_vars = []
    for out in outputs:
        output_vars.append({
            "type": "string",
            "value_selector": ["llm", "text"],
            "variable": out.get("name", "output"),
        })

    return {
        "data": {
            "desc": "End",
            "outputs": output_vars,
            "selected": False,
            "title": "End",
            "type": "end",
        },
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


def convert_file(component_path: Path) -> dict:
    with open(component_path, "r", encoding="utf-8") as f:
        component = yaml.safe_load(f)

    return devkit_to_dify_workflow(component)


def convert_to_yaml(dify_dsl: dict) -> str:
    return yaml.dump(dify_dsl, allow_unicode=True, sort_keys=False, default_flow_style=False)


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: converter.py <component.yml>")
        sys.exit(1)

    component_path = Path(sys.argv[1])
    dify_dsl = convert_file(component_path)
    print(convert_to_yaml(dify_dsl))