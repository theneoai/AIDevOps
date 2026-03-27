# AIDevOps - Multi-Person Collaborative DevOps Workflow Platform

A production-quality platform that uses LLM (Claude), MCP (Model Context Protocol), and Skills to automate the **研发提测 (dev-to-QA handoff)** workflow.

## Architecture

### Multi-Agent System

Four specialized Claude-powered agents collaborate through the workflow:

| Agent | Role | MCP Tools |
|-------|------|-----------|
| `DevAgent` | Analyzes code changes, generates test tickets, responds to bugs | GitHub Workflow |
| `ReviewerAgent` | Reviews code quality, security, approves/rejects PRs | GitHub Workflow |
| `QAAgent` | Reviews tickets, executes tests, reports bugs, approves releases | Test Management + GitHub |
| `OpsAgent` | Monitors builds, manages deployments, updates PR statuses | GitHub Workflow |

### Workflow States

```
CODING → PR_CREATED → CODE_REVIEW → BUILD_TEST →
SUBMIT_TEST_TICKET → QA_ASSIGNED → TESTING →
BUG_FIXING → RETEST → APPROVED → RELEASED
```

Human-in-the-loop checkpoints at:
- **CODE_REVIEW**: Tech lead / senior dev approves the code review
- **QA_ASSIGNED**: QA lead confirms assignment
- **APPROVED**: QA lead + product owner approve for release

### Project Structure

```
AIDevOps/
├── platform/
│   ├── core/
│   │   ├── workflow_engine.py    # State machine + async event bus
│   │   ├── agent_base.py         # Base agent with MCP client integration
│   │   └── context.py            # Shared workflow context
│   ├── agents/
│   │   ├── dev_agent.py          # Developer agent
│   │   ├── qa_agent.py           # QA engineer agent
│   │   ├── reviewer_agent.py     # Code reviewer agent
│   │   └── ops_agent.py          # DevOps/Ops agent
│   ├── workflows/
│   │   └── dev_to_qa.py          # Main workflow orchestrator
│   └── skills/
│       ├── code_analysis.py      # PR diff analysis skill
│       ├── test_case_gen.py      # Test case generation skill
│       ├── ticket_gen.py         # Test ticket generation skill
│       └── notification.py       # Multi-channel notification skill
├── mcp_servers/
│   ├── github_workflow/server.py # GitHub PR management MCP server
│   └── test_management/server.py # Test management MCP server
├── config/
│   ├── workflow.yaml             # Workflow configuration
│   └── agents.yaml               # Agent and MCP server config
└── examples/
    └── run_dev_to_qa.py          # Full workflow example
```

## Quick Start

### 1. Install Dependencies

```bash
pip install -e .
```

### 2. Set Environment Variables

```bash
export ANTHROPIC_API_KEY=your-anthropic-api-key

# Optional: for real GitHub PR access
export GITHUB_TOKEN=your-github-token

# Optional: for Slack/DingTalk notifications
export NOTIFICATION_WEBHOOK_URL=https://hooks.slack.com/...
```

### 3. Run the Demo

```bash
# Full workflow with interactive approvals:
python examples/run_dev_to_qa.py --demo

# Auto-approve all checkpoints (non-interactive):
python examples/run_dev_to_qa.py --demo --auto-approve

# Skills demo only (test individual components):
python examples/run_dev_to_qa.py --demo --skills-only

# Real PR (requires GITHUB_TOKEN):
python examples/run_dev_to_qa.py --pr-url https://github.com/org/repo/pull/123
```

### 4. Test MCP Servers Standalone

```bash
# GitHub Workflow MCP server:
mcp dev mcp_servers/github_workflow/server.py

# Test Management MCP server:
mcp dev mcp_servers/test_management/server.py
```

## Using the Platform in Your Code

```python
import asyncio
from platform.workflows.dev_to_qa import DevToQAWorkflow
from platform.agents.dev_agent import DevAgent
from platform.agents.qa_agent import QAAgent
from platform.agents.reviewer_agent import ReviewerAgent
from platform.agents.ops_agent import OpsAgent

async def main():
    # Create workflow with default agents (no MCP tools)
    workflow = DevToQAWorkflow(
        auto_approve_checkpoints=True,  # Skip human approvals for testing
    )

    result = await workflow.run(
        pr_url="https://github.com/org/repo/pull/42",
        pr_info_override={
            "title": "feat: Add authentication",
            "description": "Adds JWT auth...",
            "author": "dev-alice",
        }
    )

    print(f"Workflow: {result.final_state.value}")
    print(f"Ticket: {result.ticket_id}")
    print(f"Success: {result.success}")

asyncio.run(main())
```

### Using Skills Independently

```python
from platform.skills.code_analysis import CodeAnalysisSkill
from platform.skills.test_case_gen import TestCaseGenSkill
from platform.skills.ticket_gen import TestTicketGenSkill

# Analyze a diff
analyzer = CodeAnalysisSkill()
analysis = await analyzer.analyze_pr_diff(diff_text, pr_title, pr_description)
print(f"Risk: {analysis.risk_level.value}")
print(f"Test scope: {analysis.test_scope}")

# Generate test cases
tc_gen = TestCaseGenSkill()
test_cases = await tc_gen.generate(analysis, requirements="...", target_count=8)

# Generate test ticket
ticket_gen = TestTicketGenSkill()
ticket = await ticket_gen.generate(pr_info, analysis, test_cases)
print(ticket.to_markdown())
```

### Custom Human Approval Callback

```python
async def my_approval_handler(checkpoint, context):
    # Integrate with your approval system (Slack bot, web UI, etc.)
    # Return (approved: bool, approver: str, comment: str)
    result = await your_approval_system.request(checkpoint)
    return result.approved, result.approver_id, result.comment

workflow = DevToQAWorkflow(
    human_approval_callback=my_approval_handler,
)
```

## MCP Server Tools

### GitHub Workflow Server (`mcp_servers/github_workflow/server.py`)

| Tool | Description |
|------|-------------|
| `get_pr_info(pr_url)` | Fetch PR title, description, author, branches |
| `get_pr_diff(pr_url)` | Get full diff text |
| `add_pr_comment(pr_url, comment)` | Add review comment |
| `update_pr_status(pr_url, status, message)` | Update CI check status |
| `list_changed_files(pr_url)` | List changed files with stats |
| `get_pr_comments(pr_url)` | Get all PR comments |
| `get_pr_status(pr_url)` | Get current check status |

### Test Management Server (`mcp_servers/test_management/server.py`)

| Tool | Description |
|------|-------------|
| `create_test_ticket(ticket_data)` | Create a test ticket, returns ticket_id |
| `assign_ticket(ticket_id, assignee)` | Assign to QA engineer |
| `update_ticket_status(ticket_id, status, comment)` | Update ticket status |
| `add_test_result(ticket_id, test_case_id, result, notes, bug_info)` | Record test result |
| `list_bugs(ticket_id)` | List all bugs found |
| `generate_test_report(ticket_id)` | Generate final test report |
| `get_ticket(ticket_id)` | Get full ticket details |
| `list_tickets(status)` | List all tickets |
| `close_bug(ticket_id, bug_id, resolution)` | Close a bug |

## Configuration

### `config/workflow.yaml`
Defines workflow states, transitions, human checkpoints, and agent assignments.

### `config/agents.yaml`
Defines agent configurations, MCP server commands, and environment variables.

## Design Principles

1. **Event-Driven State Machine**: `WorkflowEngine` validates all state transitions and fires async event handlers
2. **Agent Autonomy**: Each agent has its own system prompt and tool access, making independent decisions
3. **Human-in-the-Loop**: Three mandatory checkpoints prevent fully automated releases
4. **Skill Reusability**: `CodeAnalysisSkill`, `TestCaseGenSkill`, `TestTicketGenSkill` can be used independently
5. **MCP Extensibility**: Add new capabilities by creating new MCP servers
6. **Graceful Degradation**: Agents fall back to no-tool mode if MCP connection fails
