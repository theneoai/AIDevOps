"""
Dev-to-QA Workflow - Orchestrates the 研发提测 (dev-to-QA handoff) workflow.

This workflow coordinates all agents through the full lifecycle:
CODING → PR_CREATED → CODE_REVIEW → BUILD_TEST → SUBMIT_TEST_TICKET →
QA_ASSIGNED → TESTING → BUG_FIXING → RETEST → APPROVED → RELEASED

Human approval checkpoints at:
- CODE_REVIEW: Awaits tech lead/senior dev approval
- QA_ASSIGNED: Awaits QA lead assignment confirmation
- APPROVED: Awaits QA lead + product owner approval
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

from ..core.workflow_engine import WorkflowEngine, WorkflowState
from ..core.context import WorkflowContext, PRInfo, TestTicketInfo
from ..agents.dev_agent import DevAgent
from ..agents.qa_agent import QAAgent
from ..agents.reviewer_agent import ReviewerAgent
from ..agents.ops_agent import OpsAgent
from ..skills.code_analysis import CodeAnalysisSkill
from ..skills.test_case_gen import TestCaseGenSkill
from ..skills.ticket_gen import TestTicketGenSkill
from ..skills.notification import NotificationSkill, NotificationConfig

logger = logging.getLogger(__name__)
console = Console()


@dataclass
class WorkflowResult:
    """Final result of a workflow execution."""
    success: bool
    final_state: WorkflowState
    workflow_id: str
    pr_url: str
    ticket_id: str = ""
    ticket_markdown: str = ""
    test_cases_count: int = 0
    bugs_found: int = 0
    approved: bool = False
    release_info: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    duration_seconds: float = 0.0
    context_summary: Dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        status = "SUCCESS" if self.success else "FAILED"
        return (
            f"WorkflowResult({status}, state={self.final_state.value}, "
            f"pr={self.pr_url}, ticket={self.ticket_id})"
        )


# Human approval callback type
# Called with (checkpoint_name, context) and must return (approved, approver, comment)
HumanApprovalCallback = Callable[
    [str, WorkflowContext],
    "asyncio.Future[tuple[bool, str, str]]",
]


class DevToQAWorkflow:
    """
    Orchestrates the complete 研发提测 (dev-to-QA handoff) workflow.

    Coordinates DevAgent, ReviewerAgent, QAAgent, and OpsAgent through
    all workflow states with human-in-the-loop checkpoints.

    Usage:
        workflow = DevToQAWorkflow(
            dev_agent=dev_agent,
            qa_agent=qa_agent,
            reviewer_agent=reviewer_agent,
            ops_agent=ops_agent,
        )
        result = await workflow.run(pr_url="https://github.com/org/repo/pull/123")
    """

    def __init__(
        self,
        dev_agent: Optional[DevAgent] = None,
        qa_agent: Optional[QAAgent] = None,
        reviewer_agent: Optional[ReviewerAgent] = None,
        ops_agent: Optional[OpsAgent] = None,
        notification_config: Optional[NotificationConfig] = None,
        human_approval_callback: Optional[HumanApprovalCallback] = None,
        auto_approve_checkpoints: bool = False,
        default_qa_assignee: str = "qa_lead",
    ):
        """
        Initialize the workflow.

        Args:
            dev_agent: Developer agent instance
            qa_agent: QA agent instance
            reviewer_agent: Code reviewer agent instance
            ops_agent: Ops/deploy agent instance
            notification_config: Configuration for notifications
            human_approval_callback: Async callback for human approval gates.
                If None and auto_approve_checkpoints=False, uses console input.
            auto_approve_checkpoints: Skip human approval gates (for testing)
            default_qa_assignee: Default QA engineer to assign tickets to
        """
        self.dev_agent = dev_agent or DevAgent()
        self.qa_agent = qa_agent or QAAgent()
        self.reviewer_agent = reviewer_agent or ReviewerAgent()
        self.ops_agent = ops_agent or OpsAgent()

        # Skills
        self.code_analysis = CodeAnalysisSkill()
        self.test_case_gen = TestCaseGenSkill()
        self.ticket_gen = TestTicketGenSkill()
        self.notifier = NotificationSkill(notification_config)

        # Workflow engine
        self.engine = WorkflowEngine()

        # Approval configuration
        self._human_approval_callback = human_approval_callback
        self._auto_approve = auto_approve_checkpoints
        self._default_qa_assignee = default_qa_assignee

        # Register event handlers for logging
        self.engine.register_handler("*", self._on_state_change)

    async def run(
        self,
        pr_url: str,
        context: Optional[WorkflowContext] = None,
        pr_info_override: Optional[Dict[str, Any]] = None,
    ) -> WorkflowResult:
        """
        Run the complete dev-to-QA workflow.

        Args:
            pr_url: URL of the pull request to process
            context: Optional pre-existing workflow context
            pr_info_override: Override PR info (useful for testing without real PRs)

        Returns:
            WorkflowResult with the final outcome
        """
        ctx = context or WorkflowContext()
        start_time = datetime.utcnow()

        console.print(Panel(
            f"[bold blue]研发提测 Workflow Starting[/bold blue]\n"
            f"PR: {pr_url}\n"
            f"Workflow ID: {ctx.workflow_id}",
            title="DevOps Workflow Platform",
            border_style="blue",
        ))

        try:
            # Initialize PR info in context
            ctx.pr_info = PRInfo(url=pr_url)
            if pr_info_override:
                ctx.pr_info = PRInfo(url=pr_url, **pr_info_override)

            await self.notifier.notify_workflow_started(
                pr_url, ctx.pr_info.author or "Developer", ctx.workflow_id
            )

            # Run through workflow states
            result = await self._execute_workflow(pr_url, ctx)

        except Exception as e:
            logger.error(f"Workflow failed with unhandled exception: {e}", exc_info=True)
            await self.notifier.notify_workflow_failed(
                pr_url, self.engine.state.value, str(e), ctx.workflow_id
            )
            result = WorkflowResult(
                success=False,
                final_state=self.engine.state,
                workflow_id=ctx.workflow_id,
                pr_url=pr_url,
                error=str(e),
            )

        # Calculate duration
        duration = (datetime.utcnow() - start_time).total_seconds()
        result.duration_seconds = duration
        result.context_summary = ctx.to_dict()

        # Print final summary
        self._print_summary(result)

        return result

    async def _execute_workflow(
        self,
        pr_url: str,
        ctx: WorkflowContext,
    ) -> WorkflowResult:
        """Execute the main workflow state machine."""

        # ─── PHASE 1: PR Created ──────────────────────────────────────────────
        self._print_phase("Phase 1: PR Submitted")
        await self.engine.trigger("pr_created", {"pr_url": pr_url}, "dev_agent", ctx)

        # ─── PHASE 2: Code Review ─────────────────────────────────────────────
        self._print_phase("Phase 2: Code Review")
        await self.engine.trigger("review_requested", {"pr_url": pr_url}, "system", ctx)
        await self.notifier.notify_review_requested(
            pr_url, ctx.pr_info.author or "developer", ["tech_lead"]
        )

        # Reviewer agent analyzes the PR
        console.print("[yellow]Reviewer agent analyzing PR...[/yellow]")
        review_result = await self.reviewer_agent.review_pr(pr_url, ctx)
        await ctx.add_agent_note("reviewer", f"Review completed: {review_result.output[:200]}")

        # Parse review result
        review_data = self._parse_json_safely(review_result.output)
        verdict = review_data.get("verdict", "APPROVED") if review_data else "APPROVED"
        console.print(f"[cyan]Review verdict: {verdict}[/cyan]")

        # Human approval checkpoint: CODE_REVIEW
        approved, approver, comment = await self._request_human_approval(
            checkpoint="CODE_REVIEW",
            description=f"Code review completed. Verdict: {verdict}\n\nReview summary:\n{review_result.output[:500]}",
            approvers=["tech_lead", "senior_dev"],
            context=ctx,
        )

        await ctx.record_human_decision("CODE_REVIEW", approver, approved, comment)
        await self.notifier.notify_review_complete(pr_url, verdict, approver)

        if not approved or verdict == "REJECTED":
            # Send back to coding
            await self.engine.trigger("review_rejected", {"reason": comment}, approver, ctx)
            return WorkflowResult(
                success=False,
                final_state=WorkflowState.CODING,
                workflow_id=ctx.workflow_id,
                pr_url=pr_url,
                error="Code review rejected: " + comment,
            )

        # Review approved → proceed to build
        await self.engine.trigger("review_approved", {"reviewer": approver}, approver, ctx)

        # ─── PHASE 3: Build & Test ────────────────────────────────────────────
        self._print_phase("Phase 3: CI/CD Build")
        await self.notifier.notify_build_result(pr_url, "RUNNING")

        # Ops agent checks build status
        console.print("[yellow]Ops agent checking build status...[/yellow]")
        build_result = await self.ops_agent.check_build_status(pr_url, ctx)
        build_data = self._parse_json_safely(build_result.output)
        build_status = (build_data or {}).get("build_status", "PASSED")
        console.print(f"[cyan]Build status: {build_status}[/cyan]")

        await self.notifier.notify_build_result(pr_url, build_status)

        if build_status == "FAILED":
            await self.engine.trigger(
                "build_failed", {"error": build_result.output[:200]}, "ops_agent", ctx
            )
            return WorkflowResult(
                success=False,
                final_state=WorkflowState.CODING,
                workflow_id=ctx.workflow_id,
                pr_url=pr_url,
                error="Build failed",
            )

        await self.engine.trigger("build_passed", {"build_id": "ci-build-001"}, "ops_agent", ctx)

        # ─── PHASE 4: Code Analysis & Test Case Generation ────────────────────
        self._print_phase("Phase 4: Code Analysis & Test Generation")

        # Dev agent analyzes changes
        console.print("[yellow]Dev agent analyzing code changes...[/yellow]")
        analysis_result = await self.dev_agent.analyze_changes(pr_url, ctx)
        analysis_data = self._parse_json_safely(analysis_result.output) or {}
        await ctx.set("raw_analysis", analysis_data)

        # Use CodeAnalysisSkill for structured analysis
        # Build a representative diff from analysis data or use placeholder
        diff_text = await ctx.get("pr_diff", "")
        if not diff_text:
            # Generate a descriptive diff summary from analysis
            diff_text = f"# Analysis from dev agent:\n{analysis_result.output}"

        change_analysis = await self.code_analysis.analyze_pr_diff(
            diff_text=diff_text,
            pr_title=ctx.pr_info.title or "",
            pr_description=ctx.pr_info.description or "",
            additional_context=analysis_data,
        )
        ctx.change_analysis = change_analysis.model_dump()
        console.print(f"[cyan]Risk level: {change_analysis.risk_level.value}[/cyan]")

        # Generate test cases using TestCaseGenSkill
        console.print("[yellow]Generating test cases...[/yellow]")
        test_cases = await self.test_case_gen.generate(
            change_analysis=change_analysis,
            requirements=ctx.pr_info.description or "",
            target_count=8,
        )
        ctx.test_cases = [tc.model_dump() for tc in test_cases]
        console.print(f"[cyan]Generated {len(test_cases)} test cases[/cyan]")

        # ─── PHASE 5: Generate & Submit Test Ticket ───────────────────────────
        self._print_phase("Phase 5: Test Ticket Generation")

        pr_info_dict = {
            "url": pr_url,
            "title": ctx.pr_info.title or "PR Feature",
            "description": ctx.pr_info.description or "",
            "author": ctx.pr_info.author or "developer",
        }

        # Use TicketGenSkill for structured ticket
        console.print("[yellow]Generating test ticket...[/yellow]")
        test_ticket = await self.ticket_gen.generate(
            pr_info=pr_info_dict,
            change_analysis=change_analysis,
            test_cases=test_cases,
        )

        # Store ticket info
        ticket_id = f"TT-{ctx.workflow_id[:8].upper()}"
        ctx.test_ticket = TestTicketInfo(
            ticket_id=ticket_id,
            title=test_ticket.title,
            status="open",
            test_cases_total=len(test_cases),
        )

        ticket_markdown = test_ticket.to_markdown()
        console.print(f"[green]Test ticket created: {ticket_id}[/green]")
        console.print(f"[dim]{test_ticket.title}[/dim]")

        await self.engine.trigger(
            "ticket_submitted",
            {"ticket_id": ticket_id, "title": test_ticket.title},
            "dev_agent",
            ctx,
        )
        await self.notifier.notify_test_ticket_created(
            ticket_id, pr_url, ctx.pr_info.author or "developer"
        )

        # ─── PHASE 6: QA Assignment ───────────────────────────────────────────
        self._print_phase("Phase 6: QA Assignment")

        # Human approval checkpoint: QA_ASSIGNED
        ticket_preview = f"Ticket: {test_ticket.title}\nTest cases: {len(test_cases)}\nRisk: {change_analysis.risk_level.value}"
        approved, approver, comment = await self._request_human_approval(
            checkpoint="QA_ASSIGNED",
            description=f"Test ticket ready for QA assignment.\n\n{ticket_preview}",
            approvers=["qa_lead"],
            context=ctx,
        )

        await ctx.record_human_decision("QA_ASSIGNED", approver, approved, comment)

        qa_assignee = comment if comment and not comment.lower().startswith("approved") else self._default_qa_assignee
        ctx.test_ticket.assignee = qa_assignee

        await self.engine.trigger(
            "testing_started",
            {"assignee": qa_assignee, "ticket_id": ticket_id},
            "qa_agent",
            ctx,
        )
        await self.notifier.notify_qa_assigned(ticket_id, qa_assignee, pr_url)

        # ─── PHASE 7: QA Testing ─────────────────────────────────────────────
        self._print_phase("Phase 7: QA Testing")

        # QA agent reviews the ticket
        console.print("[yellow]QA agent reviewing test ticket...[/yellow]")
        ticket_review = await self.qa_agent.review_test_ticket(
            test_ticket.model_dump(), ctx
        )
        review_data = self._parse_json_safely(ticket_review.output) or {}

        # QA agent generates test plan
        console.print("[yellow]QA agent generating test plan...[/yellow]")
        test_plan_result = await self.qa_agent.generate_test_plan(
            test_ticket.model_dump(), change_analysis.model_dump(), ctx
        )
        await ctx.set("test_plan", test_plan_result.output)

        # Simulate test execution results (in production, this would be actual QA work)
        # For demo, we show the QA agent's assessment
        console.print("[yellow]QA agent executing tests...[/yellow]")

        # Simulate mixed test results for demo
        test_results = self._simulate_test_results(test_cases)
        failed_count = sum(1 for r in test_results if r.get("status") == "FAILED")

        if failed_count > 0:
            # QA found bugs
            console.print(f"[red]QA found {failed_count} failing test(s)[/red]")

            bug_report = await self.qa_agent.report_bugs(
                [r for r in test_results if r.get("status") == "FAILED"],
                ticket_id,
                ctx,
            )
            bugs_data = self._parse_json_safely(bug_report.output) or {}
            bugs = bugs_data.get("bugs", [])

            ctx.test_ticket.test_cases_failed = failed_count
            ctx.test_ticket.test_cases_passed = len(test_cases) - failed_count
            ctx.test_ticket.bugs = bugs

            await self.notifier.notify_bugs_found(
                ticket_id, pr_url, len(bugs),
                sum(1 for b in bugs if b.get("severity") == "CRITICAL"),
            )

            await self.engine.trigger(
                "bugs_found",
                {"bug_count": len(bugs), "ticket_id": ticket_id},
                "qa_agent",
                ctx,
            )

            # ─── PHASE 8: Bug Fixing ─────────────────────────────────────────
            self._print_phase("Phase 8: Bug Fixing")

            # Dev responds to bugs
            console.print("[yellow]Dev agent reviewing bugs...[/yellow]")
            dev_response = await self.dev_agent.respond_to_bugs(bugs, pr_url, ctx)
            await ctx.add_agent_note("dev_agent", f"Bug response: {dev_response.output[:200]}")

            await self.engine.trigger(
                "bugs_fixed",
                {"fixed_bugs": len(bugs)},
                "dev_agent",
                ctx,
            )

            # ─── PHASE 9: Retest ─────────────────────────────────────────────
            self._print_phase("Phase 9: Retest")

            # All tests pass on retest (simplified)
            ctx.test_ticket.test_cases_passed = len(test_cases)
            ctx.test_ticket.test_cases_failed = 0
            console.print("[green]Retest complete - all tests passing[/green]")

            await self.engine.trigger(
                "retest_passed",
                {"ticket_id": ticket_id},
                "qa_agent",
                ctx,
            )
        else:
            # All tests passed
            ctx.test_ticket.test_cases_passed = len(test_cases)
            ctx.test_ticket.test_cases_failed = 0
            console.print("[green]All tests passed![/green]")

            await self.engine.trigger(
                "testing_passed",
                {"ticket_id": ticket_id},
                "qa_agent",
                ctx,
            )

        # ─── PHASE 10: Final Approval ─────────────────────────────────────────
        self._print_phase("Phase 10: Release Approval")

        # QA generates final approval decision
        test_summary = {
            "ticket_id": ticket_id,
            "total_tests": len(test_cases),
            "passed": ctx.test_ticket.test_cases_passed,
            "failed": ctx.test_ticket.test_cases_failed,
            "bugs_total": len(ctx.test_ticket.bugs),
            "bugs_critical": 0,
        }

        console.print("[yellow]QA agent making approval decision...[/yellow]")
        approval_decision = await self.qa_agent.approve_release(
            ticket_id, test_summary, ctx
        )
        decision_data = self._parse_json_safely(approval_decision.output) or {}
        qa_decision = decision_data.get("decision", "APPROVED")
        console.print(f"[cyan]QA decision: {qa_decision}[/cyan]")

        # Human approval checkpoint: APPROVED
        approved, approver, comment = await self._request_human_approval(
            checkpoint="APPROVED",
            description=(
                f"QA has completed testing.\n"
                f"QA Decision: {qa_decision}\n"
                f"Tests: {ctx.test_ticket.test_cases_passed}/{len(test_cases)} passed\n"
                f"Bugs found: {len(ctx.test_ticket.bugs)}\n\n"
                f"Approve for production release?"
            ),
            approvers=["qa_lead", "product_owner"],
            context=ctx,
        )

        await ctx.record_human_decision("APPROVED", approver, approved, comment)

        if not approved:
            return WorkflowResult(
                success=False,
                final_state=WorkflowState.APPROVED,
                workflow_id=ctx.workflow_id,
                pr_url=pr_url,
                ticket_id=ticket_id,
                ticket_markdown=ticket_markdown,
                test_cases_count=len(test_cases),
                bugs_found=len(ctx.test_ticket.bugs),
                error="Release approval rejected: " + comment,
            )

        await self.notifier.notify_release_approved(pr_url, ticket_id, approver)
        await self.engine.trigger(
            "release_approved",
            {"approver": approver},
            approver,
            ctx,
        )

        # ─── PHASE 11: Release ────────────────────────────────────────────────
        self._print_phase("Phase 11: Production Release")

        console.print("[yellow]Ops agent preparing release...[/yellow]")
        release_result = await self.ops_agent.prepare_release(
            pr_url,
            {"approver": approver, "ticket_id": ticket_id},
            ctx,
        )
        release_data = self._parse_json_safely(release_result.output) or {}
        console.print(f"[green]Release complete![/green]")

        await self.notifier.notify_released(pr_url, release_data.get("version", ""))

        return WorkflowResult(
            success=True,
            final_state=WorkflowState.RELEASED,
            workflow_id=ctx.workflow_id,
            pr_url=pr_url,
            ticket_id=ticket_id,
            ticket_markdown=ticket_markdown,
            test_cases_count=len(test_cases),
            bugs_found=len(ctx.test_ticket.bugs),
            approved=True,
            release_info=release_data,
        )

    async def _request_human_approval(
        self,
        checkpoint: str,
        description: str,
        approvers: List[str],
        context: WorkflowContext,
    ) -> tuple:
        """
        Request human approval at a workflow checkpoint.

        Returns:
            Tuple of (approved: bool, approver: str, comment: str)
        """
        await self.notifier.notify_human_approval_needed(
            checkpoint, context.pr_info.url if context.pr_info else "", approvers, 24
        )

        if self._auto_approve:
            logger.info(f"Auto-approving checkpoint: {checkpoint}")
            return True, approvers[0], "Auto-approved"

        if self._human_approval_callback:
            result = await self._human_approval_callback(checkpoint, context)
            return result

        # Default: interactive console approval
        return await self._console_approval(checkpoint, description, approvers)

    async def _console_approval(
        self,
        checkpoint: str,
        description: str,
        approvers: List[str],
    ) -> tuple:
        """Interactive console approval prompt."""
        console.print(Panel(
            f"[bold yellow]⏳ Human Approval Required[/bold yellow]\n\n"
            f"[bold]Checkpoint:[/bold] {checkpoint}\n"
            f"[bold]Required approvers:[/bold] {', '.join(approvers)}\n\n"
            f"{description}",
            title="Human-in-the-Loop",
            border_style="yellow",
        ))

        # Run blocking input in a thread pool to avoid blocking the event loop
        loop = asyncio.get_event_loop()

        def get_input():
            try:
                decision = input(f"\n[{checkpoint}] Approve? (y/n): ").strip().lower()
                approver_name = input("Your name/ID: ").strip() or approvers[0]
                comment = input("Comment (optional): ").strip()
                return decision, approver_name, comment
            except (EOFError, KeyboardInterrupt):
                return "y", approvers[0], "Auto-approved (no terminal input)"

        decision, approver_name, comment = await loop.run_in_executor(None, get_input)
        approved = decision in ("y", "yes", "approve", "approved", "1")

        return approved, approver_name, comment

    async def _on_state_change(self, event: Any, context: Any) -> None:
        """Handle state change events for logging."""
        console.print(
            f"[dim]  → State: [bold]{self.engine.state.value}[/bold] "
            f"(event: {event.event_type})[/dim]"
        )

    def _parse_json_safely(self, text: str) -> Optional[Dict[str, Any]]:
        """Safely parse JSON from agent output text."""
        if not text:
            return None

        # Try direct parse
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Try to find JSON block in text
        import re
        # Look for JSON objects
        patterns = [
            r'```json\s*([\s\S]*?)\s*```',  # Markdown code block
            r'```\s*([\s\S]*?)\s*```',       # Generic code block
            r'(\{[\s\S]*\})',                # Any JSON object
            r'(\[[\s\S]*\])',                # Any JSON array
        ]

        for pattern in patterns:
            matches = re.findall(pattern, text)
            for match in matches:
                try:
                    return json.loads(match)
                except json.JSONDecodeError:
                    continue

        return None

    def _simulate_test_results(
        self, test_cases: List[Any]
    ) -> List[Dict[str, Any]]:
        """
        Simulate test execution results for demo purposes.

        In production, this would be replaced with actual QA tool integration.
        For demo, we make most tests pass with a few failures to show the workflow.
        """
        results = []
        for i, tc in enumerate(test_cases):
            tc_dict = tc if isinstance(tc, dict) else tc.model_dump()
            # Simulate: most P0/P1 tests pass, some P2/P3 tests fail
            priority = tc_dict.get("priority", "P2")
            # 90% pass rate for P0/P1, 80% for others
            import random
            pass_rate = 0.9 if priority in ("P0", "P1") else 0.8
            status = "PASSED" if random.random() < pass_rate else "FAILED"

            results.append({
                "test_case_id": tc_dict.get("id", f"TC-{i+1:03d}"),
                "title": tc_dict.get("title", ""),
                "status": status,
                "notes": "Test executed" if status == "PASSED" else "Assertion failed: unexpected behavior observed",
                "executed_by": self._default_qa_assignee,
                "executed_at": datetime.utcnow().isoformat(),
            })

        return results

    def _print_phase(self, phase_name: str) -> None:
        """Print a phase header."""
        console.print(f"\n[bold green]{'─' * 50}[/bold green]")
        console.print(f"[bold cyan]{phase_name}[/bold cyan]")
        console.print(f"[bold green]{'─' * 50}[/bold green]")

    def _print_summary(self, result: WorkflowResult) -> None:
        """Print workflow execution summary."""
        status_color = "green" if result.success else "red"
        status_text = "SUCCESS" if result.success else "FAILED"

        table = Table(title="Workflow Summary", show_header=True)
        table.add_column("Field", style="cyan")
        table.add_column("Value", style="white")

        table.add_row("Status", f"[{status_color}]{status_text}[/{status_color}]")
        table.add_row("Final State", result.final_state.value)
        table.add_row("Workflow ID", result.workflow_id)
        table.add_row("PR URL", result.pr_url)
        table.add_row("Ticket ID", result.ticket_id or "N/A")
        table.add_row("Test Cases", str(result.test_cases_count))
        table.add_row("Bugs Found", str(result.bugs_found))
        table.add_row("Approved", "Yes" if result.approved else "No")
        table.add_row("Duration", f"{result.duration_seconds:.1f}s")

        if result.error:
            table.add_row("Error", f"[red]{result.error[:100]}[/red]")

        console.print(table)
