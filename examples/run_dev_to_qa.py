"""
Example: Run the 研发提测 (Dev-to-QA handoff) Workflow

This example demonstrates how to trigger and run the complete dev-to-QA
workflow for a pull request.

Usage:
    # Run with a real PR URL (requires ANTHROPIC_API_KEY):
    python examples/run_dev_to_qa.py --pr-url https://github.com/org/repo/pull/123

    # Run in demo mode with simulated PR data (no real GitHub PR needed):
    python examples/run_dev_to_qa.py --demo

    # Run with auto-approval (skip human checkpoints):
    python examples/run_dev_to_qa.py --demo --auto-approve

    # Run with MCP tool integration:
    python examples/run_dev_to_qa.py --demo --with-mcp

Environment variables:
    ANTHROPIC_API_KEY   Required: Your Anthropic API key
    GITHUB_TOKEN        Optional: GitHub token for real PR access
"""

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax

from platform.agents.dev_agent import DevAgent
from platform.agents.qa_agent import QAAgent
from platform.agents.reviewer_agent import ReviewerAgent
from platform.agents.ops_agent import OpsAgent
from platform.core.context import WorkflowContext
from platform.skills.code_analysis import CodeAnalysisSkill
from platform.skills.test_case_gen import TestCaseGenSkill
from platform.skills.ticket_gen import TestTicketGenSkill
from platform.workflows.dev_to_qa import DevToQAWorkflow, WorkflowResult

console = Console()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def build_mcp_configs(use_mcp: bool = False) -> dict:
    """Build MCP server configurations for agents."""
    if not use_mcp:
        return {
            "github": None,
            "test_mgmt": None,
        }

    project_root = Path(__file__).parent.parent
    github_server = str(project_root / "mcp_servers" / "github_workflow" / "server.py")
    test_server = str(project_root / "mcp_servers" / "test_management" / "server.py")

    github_config = {
        "name": "github_workflow",
        "command": sys.executable,
        "args": [github_server],
        "env": {
            "GITHUB_TOKEN": os.environ.get("GITHUB_TOKEN", ""),
            "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", ""),
        },
    }

    test_mgmt_config = {
        "name": "test_management",
        "command": sys.executable,
        "args": [test_server],
        "env": {
            "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", ""),
        },
    }

    return {
        "github": github_config,
        "test_mgmt": test_mgmt_config,
    }


async def run_skills_demo(pr_url: str) -> None:
    """
    Demonstrate the skills independently before running the full workflow.
    """
    console.print(Panel(
        "[bold cyan]Skills Demonstration[/bold cyan]\n"
        "Testing individual skills: Code Analysis, Test Case Gen, Ticket Gen",
        border_style="cyan",
    ))

    # Sample PR diff for demo
    sample_diff = """diff --git a/src/auth/jwt_handler.py b/src/auth/jwt_handler.py
new file mode 100644
--- /dev/null
+++ b/src/auth/jwt_handler.py
@@ -0,0 +1,30 @@
+import jwt
+import bcrypt
+from datetime import datetime, timedelta
+
+SECRET_KEY = "your-secret-key"
+ALGORITHM = "HS256"
+
+def create_access_token(data: dict) -> str:
+    expire = datetime.utcnow() + timedelta(minutes=30)
+    data.update({"exp": expire})
+    return jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)
+
+def verify_password(plain: str, hashed: str) -> bool:
+    return bcrypt.checkpw(plain.encode(), hashed.encode())
"""

    # 1. Code Analysis
    console.print("\n[bold]Step 1: Code Analysis Skill[/bold]")
    code_skill = CodeAnalysisSkill()
    analysis = await code_skill.analyze_pr_diff(
        diff_text=sample_diff,
        pr_title="feat: Add JWT authentication module",
        pr_description="Adds JWT token creation and password verification",
    )
    console.print(f"  Risk Level: [bold]{analysis.risk_level.value}[/bold]")
    console.print(f"  Changed Files: {analysis.changed_files}")
    console.print(f"  Test Scope: {analysis.test_scope[:3]}")
    console.print(f"  Has Security Implications: {analysis.has_security_implications}")

    # 2. Test Case Generation
    console.print("\n[bold]Step 2: Test Case Generation Skill[/bold]")
    tc_skill = TestCaseGenSkill()
    test_cases = await tc_skill.generate(
        change_analysis=analysis,
        requirements="Users must be able to login with email and password and receive a JWT token",
        target_count=5,
    )
    console.print(f"  Generated {len(test_cases)} test cases:")
    for tc in test_cases[:3]:
        console.print(f"    [{tc.priority.value}] {tc.id}: {tc.title}")

    # 3. Test Ticket Generation
    console.print("\n[bold]Step 3: Test Ticket Generation Skill[/bold]")
    ticket_skill = TestTicketGenSkill()
    ticket = await ticket_skill.generate(
        pr_info={
            "url": pr_url,
            "title": "feat: Add JWT authentication module",
            "description": "Adds JWT token creation and password verification",
            "author": "dev-alice",
        },
        change_analysis=analysis,
        test_cases=test_cases,
    )
    console.print(f"  Ticket Title: {ticket.title}")
    console.print(f"  Priority: {ticket.priority}")
    console.print(f"  Risk Points: {len(ticket.risk_points)} identified")
    console.print(f"  Test Cases: {len(ticket.test_cases)} included")

    console.print("\n[green]Skills demo completed successfully![/green]")


async def run_workflow(
    pr_url: str,
    auto_approve: bool = False,
    with_mcp: bool = False,
    pr_info_override: dict = None,
) -> WorkflowResult:
    """
    Run the complete dev-to-QA workflow.
    """
    mcp_configs = build_mcp_configs(use_mcp=with_mcp)

    # Create agents
    dev_agent = DevAgent(
        mcp_server_configs=[mcp_configs["github"]] if mcp_configs["github"] else None,
    )
    qa_agent = QAAgent(
        mcp_server_configs=[mcp_configs["test_mgmt"]] if mcp_configs["test_mgmt"] else None,
    )
    reviewer_agent = ReviewerAgent(
        mcp_server_configs=[mcp_configs["github"]] if mcp_configs["github"] else None,
    )
    ops_agent = OpsAgent(
        mcp_server_configs=[mcp_configs["github"]] if mcp_configs["github"] else None,
    )

    # Create workflow
    workflow = DevToQAWorkflow(
        dev_agent=dev_agent,
        qa_agent=qa_agent,
        reviewer_agent=reviewer_agent,
        ops_agent=ops_agent,
        auto_approve_checkpoints=auto_approve,
        default_qa_assignee="qa_engineer_alice",
    )

    # Run the workflow
    result = await workflow.run(
        pr_url=pr_url,
        pr_info_override=pr_info_override,
    )

    return result


def print_ticket_preview(result: WorkflowResult) -> None:
    """Print the generated test ticket in Markdown format."""
    if result.ticket_markdown:
        console.print("\n")
        console.print(Panel(
            Syntax(result.ticket_markdown[:3000], "markdown", theme="monokai"),
            title=f"Generated Test Ticket: {result.ticket_id}",
            border_style="green",
        ))


async def main():
    parser = argparse.ArgumentParser(
        description="Run the 研发提测 (Dev-to-QA) workflow",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--pr-url",
        help="GitHub PR URL to process",
    )
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Run with simulated demo PR data",
    )
    parser.add_argument(
        "--auto-approve",
        action="store_true",
        help="Auto-approve all human checkpoints (skip interactive prompts)",
    )
    parser.add_argument(
        "--with-mcp",
        action="store_true",
        help="Enable MCP server integration for tools",
    )
    parser.add_argument(
        "--skills-only",
        action="store_true",
        help="Only run the skills demo, not the full workflow",
    )
    parser.add_argument(
        "--output",
        help="Save workflow result to JSON file",
    )

    args = parser.parse_args()

    # Validate environment
    if not os.environ.get("ANTHROPIC_API_KEY"):
        console.print("[red]ERROR: ANTHROPIC_API_KEY environment variable is required[/red]")
        console.print("Set it with: export ANTHROPIC_API_KEY=your-key-here")
        sys.exit(1)

    # Determine PR URL
    if args.demo or not args.pr_url:
        pr_url = "https://github.com/example-org/example-service/pull/42"
        pr_info_override = {
            "title": "feat: Add user authentication with JWT",
            "description": (
                "## Summary\n"
                "This PR implements JWT-based user authentication:\n"
                "- New `/api/auth/login` endpoint\n"
                "- JWT token generation and validation\n"
                "- Password hashing with bcrypt\n\n"
                "## Test Requirements\n"
                "- Test login with valid/invalid credentials\n"
                "- Test token expiration\n"
                "- Test concurrent sessions"
            ),
            "author": "dev-alice",
            "head_branch": "feature/jwt-auth",
        }
        console.print(f"[dim]Using demo PR: {pr_url}[/dim]")
    else:
        pr_url = args.pr_url
        pr_info_override = None

    # Run skills demo if requested
    if args.skills_only:
        await run_skills_demo(pr_url)
        return

    # Run full workflow
    console.print(f"\n[bold]PR URL:[/bold] {pr_url}")
    console.print(f"[bold]Auto-approve:[/bold] {args.auto_approve}")
    console.print(f"[bold]MCP Integration:[/bold] {args.with_mcp}\n")

    try:
        result = await run_workflow(
            pr_url=pr_url,
            auto_approve=args.auto_approve,
            with_mcp=args.with_mcp,
            pr_info_override=pr_info_override,
        )

        # Print ticket preview
        print_ticket_preview(result)

        # Save result if requested
        if args.output:
            output_data = {
                "success": result.success,
                "final_state": result.final_state.value,
                "workflow_id": result.workflow_id,
                "pr_url": result.pr_url,
                "ticket_id": result.ticket_id,
                "test_cases_count": result.test_cases_count,
                "bugs_found": result.bugs_found,
                "approved": result.approved,
                "duration_seconds": result.duration_seconds,
                "error": result.error,
                "release_info": result.release_info,
            }
            with open(args.output, "w") as f:
                json.dump(output_data, f, indent=2)
            console.print(f"\n[green]Result saved to: {args.output}[/green]")

        # Exit code based on success
        sys.exit(0 if result.success else 1)

    except KeyboardInterrupt:
        console.print("\n[yellow]Workflow interrupted by user[/yellow]")
        sys.exit(130)
    except Exception as e:
        console.print(f"\n[red]Fatal error: {e}[/red]")
        logger.exception("Fatal workflow error")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
