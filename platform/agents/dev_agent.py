"""
Developer Agent - Represents the developer role in the 研发提测 workflow.

Responsible for:
- Analyzing code changes in a PR
- Generating test tickets from PR information
- Responding to bug reports with fixes
- Providing context about implementation decisions
"""

import json
import logging
from typing import Any, Dict, List, Optional

from ..core.agent_base import BaseAgent, AgentResult
from ..core.context import WorkflowContext

logger = logging.getLogger(__name__)

DEV_SYSTEM_PROMPT = """You are an expert software developer participating in a DevOps workflow.
Your role is to:
1. Analyze code changes and pull requests thoroughly
2. Generate comprehensive test tickets that clearly describe what needs to be tested
3. Provide clear descriptions of implementation decisions and potential risk areas
4. Respond to bug reports with detailed explanations and fixes
5. Communicate technical details in a way that QA engineers can understand

When analyzing PRs, consider:
- Business logic changes and their implications
- Edge cases that should be tested
- Performance impacts
- Security considerations
- Backward compatibility

When generating test tickets, include:
- Clear description of the feature/fix
- Test scope (what to test and what NOT to test)
- Risk areas and potential regression points
- Test environment requirements
- Dependencies and setup instructions

Always be precise, thorough, and helpful. Format your outputs as structured JSON when requested.
"""


class DevAgent(BaseAgent):
    """
    Developer agent that handles code analysis and test ticket generation.
    """

    def __init__(self, mcp_server_configs: Optional[List[Dict[str, Any]]] = None):
        super().__init__(
            role="dev_agent",
            system_prompt=DEV_SYSTEM_PROMPT,
            mcp_server_configs=mcp_server_configs,
        )

    def get_capabilities(self) -> List[str]:
        return [
            "Analyze PR diffs and identify changed files",
            "Assess risk level of code changes",
            "Generate comprehensive test tickets",
            "Provide implementation context for QA",
            "Respond to bug reports with fixes",
            "Identify regression test scope",
        ]

    async def analyze_changes(
        self,
        pr_url: str,
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Analyze the changes in a PR and produce a structured ChangeAnalysis.

        Args:
            pr_url: URL of the pull request
            context: Shared workflow context

        Returns:
            AgentResult with JSON-encoded ChangeAnalysis data
        """
        task = f"""Analyze the pull request at: {pr_url}

Please use the available tools to:
1. Fetch the PR information (title, description, author)
2. Get the full diff of the PR
3. List all changed files

Then provide a comprehensive analysis in the following JSON format:
{{
  "changed_files": ["list of changed file paths"],
  "risk_level": "LOW|MEDIUM|HIGH",
  "risk_reasons": ["reasons for the risk level"],
  "test_scope": ["areas that need to be tested"],
  "key_changes_summary": "brief summary of key changes",
  "implementation_notes": "notes for QA about the implementation",
  "regression_areas": ["areas that might be affected by regression"],
  "test_environment": "required test environment details"
}}

Be thorough and consider all implications of the changes."""

        return await self.execute(task, context, extra_context={"pr_url": pr_url})

    async def generate_test_ticket(
        self,
        pr_url: str,
        change_analysis: Dict[str, Any],
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Generate a comprehensive test ticket for QA.

        Args:
            pr_url: URL of the pull request
            change_analysis: Result from analyze_changes()
            context: Shared workflow context

        Returns:
            AgentResult with JSON-encoded TestTicket data
        """
        task = f"""Based on the PR at {pr_url} and the change analysis provided,
generate a comprehensive test ticket for the QA team.

The test ticket must be in the following JSON format:
{{
  "title": "descriptive ticket title",
  "pr_url": "{pr_url}",
  "author": "developer name from PR",
  "description": "what this change does and why",
  "test_scope": "what needs to be tested",
  "risk_points": ["list of risk areas to pay attention to"],
  "test_cases": [
    {{
      "id": "TC-001",
      "title": "test case title",
      "type": "functional|regression|smoke|performance",
      "priority": "P0|P1|P2|P3",
      "preconditions": "setup required",
      "steps": ["step 1", "step 2", "..."],
      "expected_result": "what should happen",
      "test_data": "any required test data"
    }}
  ],
  "environment": "test environment requirements",
  "deadline": "suggested deadline (e.g., 2 business days)",
  "notes": "any additional notes for QA"
}}

Generate at least 5 comprehensive test cases covering smoke, functional, and regression scenarios."""

        return await self.execute(
            task,
            context,
            extra_context={"pr_url": pr_url, "change_analysis": change_analysis},
        )

    async def respond_to_bugs(
        self,
        bug_list: List[Dict[str, Any]],
        pr_url: str,
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Respond to bug reports found during testing.

        Args:
            bug_list: List of bug dictionaries from QA
            pr_url: URL of the pull request
            context: Shared workflow context

        Returns:
            AgentResult with developer response to each bug
        """
        bugs_str = json.dumps(bug_list, indent=2)
        task = f"""QA has found the following bugs during testing of PR {pr_url}:

{bugs_str}

For each bug, please:
1. Assess if this is a valid bug or a misunderstanding
2. If valid, describe the root cause
3. Provide a fix plan or explain why it's not a bug
4. Estimate the fix complexity (SIMPLE/MEDIUM/COMPLEX)

Respond with a JSON array:
[
  {{
    "bug_id": "bug identifier",
    "is_valid": true/false,
    "root_cause": "explanation",
    "fix_plan": "how to fix it",
    "fix_complexity": "SIMPLE|MEDIUM|COMPLEX",
    "notes": "any additional notes"
  }}
]"""

        return await self.execute(
            task,
            context,
            extra_context={"pr_url": pr_url, "bugs": bug_list},
        )

    async def provide_handoff_summary(
        self,
        pr_url: str,
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Provide a developer handoff summary for QA.

        Args:
            pr_url: URL of the pull request
            context: Shared workflow context

        Returns:
            AgentResult with handoff summary
        """
        task = f"""Prepare a comprehensive handoff summary for the QA team for PR: {pr_url}

The handoff summary should include:
1. What was changed and why (business context)
2. Key technical implementation details
3. Known limitations or technical debt
4. Setup instructions for test environment
5. Tips for effective testing
6. Contact information for questions

Format this as a clear, readable document that a QA engineer can use as a reference
during testing. Make it practical and actionable."""

        return await self.execute(task, context, extra_context={"pr_url": pr_url})
