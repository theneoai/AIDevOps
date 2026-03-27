"""
QA Agent - Represents the Quality Assurance engineer role in the workflow.

Responsible for:
- Reviewing test tickets for completeness
- Generating detailed test plans
- Executing tests and recording results
- Reporting bugs with detailed reproduction steps
- Approving releases after successful testing
"""

import json
import logging
from typing import Any, Dict, List, Optional

from ..core.agent_base import BaseAgent, AgentResult
from ..core.context import WorkflowContext

logger = logging.getLogger(__name__)

QA_SYSTEM_PROMPT = """You are an expert QA engineer with deep knowledge of software testing methodologies.
Your role is to:
1. Review test tickets to ensure they are complete and testable
2. Create comprehensive test plans that cover all risk areas
3. Execute tests systematically and record results accurately
4. Report bugs with clear reproduction steps and severity assessment
5. Make final approval decisions based on testing outcomes

When reviewing test tickets, check for:
- Clear and unambiguous test cases
- Adequate coverage of happy paths and edge cases
- Proper risk assessment
- Clear acceptance criteria
- Realistic test environment requirements

When reporting bugs, include:
- Clear title summarizing the issue
- Steps to reproduce (numbered, precise)
- Expected vs actual behavior
- Environment details
- Screenshots or logs if relevant
- Severity assessment (CRITICAL/HIGH/MEDIUM/LOW)
- Priority recommendation

When making approval decisions, consider:
- All test cases executed and results recorded
- No critical or high severity bugs outstanding
- Risk assessment for any open lower-severity issues
- Business impact of any known issues

Always be thorough, objective, and data-driven in your assessments.
"""


class QAAgent(BaseAgent):
    """
    QA agent that manages testing activities and quality gates.
    """

    def __init__(self, mcp_server_configs: Optional[List[Dict[str, Any]]] = None):
        super().__init__(
            role="qa_agent",
            system_prompt=QA_SYSTEM_PROMPT,
            mcp_server_configs=mcp_server_configs,
        )

    def get_capabilities(self) -> List[str]:
        return [
            "Review test tickets for completeness",
            "Generate comprehensive test plans",
            "Record test execution results",
            "Report bugs with detailed reproduction steps",
            "Assess test coverage and quality metrics",
            "Make release approval decisions",
        ]

    async def review_test_ticket(
        self,
        ticket_data: Dict[str, Any],
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Review a test ticket for completeness and testability.

        Args:
            ticket_data: The test ticket to review
            context: Shared workflow context

        Returns:
            AgentResult with review feedback in JSON format
        """
        ticket_str = json.dumps(ticket_data, indent=2)
        task = f"""Review the following test ticket for completeness and quality:

{ticket_str}

Evaluate the ticket on:
1. Clarity of description and acceptance criteria
2. Completeness of test cases
3. Risk coverage
4. Testability of each test case
5. Environment setup clarity

Respond in JSON format:
{{
  "overall_quality": "GOOD|NEEDS_IMPROVEMENT|POOR",
  "can_proceed": true/false,
  "missing_items": ["list of missing items"],
  "improvement_suggestions": ["list of suggestions"],
  "test_case_reviews": [
    {{
      "test_case_id": "TC-001",
      "is_testable": true/false,
      "feedback": "specific feedback"
    }}
  ],
  "additional_test_cases_needed": ["list of additional scenarios to cover"],
  "estimated_testing_hours": 0,
  "qa_notes": "any additional notes"
}}"""

        return await self.execute(
            task, context, extra_context={"ticket": ticket_data}
        )

    async def generate_test_plan(
        self,
        ticket_data: Dict[str, Any],
        change_analysis: Optional[Dict[str, Any]] = None,
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Generate a detailed test execution plan.

        Args:
            ticket_data: The test ticket
            change_analysis: Optional code change analysis
            context: Shared workflow context

        Returns:
            AgentResult with detailed test plan in JSON format
        """
        extra = {"ticket": ticket_data}
        if change_analysis:
            extra["change_analysis"] = change_analysis

        task = f"""Based on the test ticket and change analysis provided, create a detailed test execution plan.

The test plan should include:
1. Test strategy overview
2. Test scope (in-scope and out-of-scope)
3. Test environment setup steps
4. Test execution order (with dependencies)
5. Risk mitigation strategies
6. Exit criteria

Format the response as JSON:
{{
  "strategy": "brief description of testing approach",
  "scope_in": ["what will be tested"],
  "scope_out": ["what will NOT be tested"],
  "environment_setup": ["step-by-step setup instructions"],
  "execution_phases": [
    {{
      "phase": "Phase 1: Smoke Testing",
      "test_cases": ["TC-001", "TC-002"],
      "duration_hours": 1,
      "dependencies": []
    }}
  ],
  "risk_mitigation": [
    {{
      "risk": "description of risk",
      "mitigation": "how to address it"
    }}
  ],
  "exit_criteria": [
    "All P0 and P1 test cases pass",
    "No CRITICAL bugs open"
  ],
  "total_estimated_hours": 0
}}"""

        return await self.execute(task, context, extra_context=extra)

    async def report_bugs(
        self,
        test_results: List[Dict[str, Any]],
        ticket_id: str,
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Analyze test results and generate bug reports.

        Args:
            test_results: List of test case execution results
            ticket_id: The test ticket ID
            context: Shared workflow context

        Returns:
            AgentResult with structured bug reports
        """
        results_str = json.dumps(test_results, indent=2)
        task = f"""Analyze the following test results for ticket {ticket_id} and generate bug reports
for any failures:

{results_str}

For each failing test case, create a structured bug report:
{{
  "bugs": [
    {{
      "bug_id": "BUG-001",
      "title": "concise bug title",
      "test_case_id": "TC-001",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "priority": "P0|P1|P2|P3",
      "environment": "environment where bug was found",
      "steps_to_reproduce": [
        "1. Navigate to...",
        "2. Click on...",
        "3. Observe..."
      ],
      "expected_behavior": "what should happen",
      "actual_behavior": "what actually happened",
      "affected_area": "component/module affected",
      "suggested_fix": "if obvious",
      "attachments_needed": ["screenshot", "logs", "etc"]
    }}
  ],
  "summary": {{
    "total_bugs": 0,
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0
  }}
}}"""

        return await self.execute(
            task,
            context,
            extra_context={"ticket_id": ticket_id, "test_results": test_results},
        )

    async def approve_release(
        self,
        ticket_id: str,
        test_summary: Dict[str, Any],
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Make a release approval decision based on test results.

        Args:
            ticket_id: The test ticket ID
            test_summary: Summary of all test results and bugs
            context: Shared workflow context

        Returns:
            AgentResult with approval decision and rationale
        """
        summary_str = json.dumps(test_summary, indent=2)
        task = f"""Based on the following test summary for ticket {ticket_id}, make a release approval decision:

{summary_str}

Evaluate:
1. Overall test pass rate
2. Severity and count of open bugs
3. Business impact of any known issues
4. Risk level for production deployment

Provide your decision in JSON format:
{{
  "decision": "APPROVED|APPROVED_WITH_CONDITIONS|REJECTED",
  "confidence": "HIGH|MEDIUM|LOW",
  "rationale": "detailed explanation of the decision",
  "conditions": ["list of conditions if APPROVED_WITH_CONDITIONS"],
  "blocking_issues": ["list of issues blocking approval if REJECTED"],
  "metrics": {{
    "tests_total": 0,
    "tests_passed": 0,
    "tests_failed": 0,
    "pass_rate": "0%",
    "bugs_open": 0,
    "bugs_critical": 0,
    "bugs_high": 0
  }},
  "risk_assessment": "LOW|MEDIUM|HIGH",
  "recommendations": ["post-release monitoring recommendations"]
}}"""

        return await self.execute(
            task,
            context,
            extra_context={"ticket_id": ticket_id, "test_summary": test_summary},
        )

    async def generate_test_report(
        self,
        ticket_id: str,
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Generate a final test report for the workflow.

        Args:
            ticket_id: The test ticket ID
            context: Shared workflow context

        Returns:
            AgentResult with comprehensive test report
        """
        task = f"""Generate a comprehensive test report for ticket {ticket_id}.

Use the available tools to:
1. Retrieve the test ticket details
2. Get all test results
3. List all bugs found

Then create a professional test report with:
- Executive summary
- Test coverage metrics
- Bug summary with severity breakdown
- Key risks and mitigations
- Final recommendation

Format as a clear document suitable for stakeholder review."""

        return await self.execute(task, context, extra_context={"ticket_id": ticket_id})
