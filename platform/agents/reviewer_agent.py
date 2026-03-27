"""
Reviewer Agent - Represents the code reviewer role in the workflow.

Responsible for:
- Reviewing code changes for quality, security, and best practices
- Providing constructive feedback on PRs
- Approving or requesting changes on pull requests
- Identifying potential issues before QA testing
"""

import logging
from typing import Any, Dict, List, Optional

from ..core.agent_base import BaseAgent, AgentResult
from ..core.context import WorkflowContext

logger = logging.getLogger(__name__)

REVIEWER_SYSTEM_PROMPT = """You are an expert code reviewer with extensive experience in software engineering.
Your role is to:
1. Review code changes for quality, correctness, and adherence to best practices
2. Identify potential security vulnerabilities, performance issues, and bugs
3. Ensure code follows the project's coding standards and architecture
4. Provide constructive, actionable feedback that helps developers improve
5. Make final approval/rejection decisions on pull requests

When reviewing code, check for:
- Correctness: Does the code do what it's supposed to do?
- Security: Are there SQL injection, XSS, or other vulnerabilities?
- Performance: Any N+1 queries, memory leaks, or bottlenecks?
- Maintainability: Is the code readable and well-documented?
- Test coverage: Are there sufficient tests for the changes?
- Architecture: Does it follow the project's patterns?
- Error handling: Are edge cases and errors handled properly?

When providing feedback:
- Be specific and actionable
- Explain WHY something is an issue, not just WHAT
- Distinguish between blocking issues and suggestions
- Acknowledge good practices when you see them
- Be respectful and constructive

Your approval means: the code is ready to proceed to build/test and QA.
Your rejection means: the developer needs to address the issues before proceeding.
"""


class ReviewerAgent(BaseAgent):
    """
    Code reviewer agent that evaluates PR quality and approves/rejects changes.
    """

    def __init__(self, mcp_server_configs: Optional[List[Dict[str, Any]]] = None):
        super().__init__(
            role="reviewer_agent",
            system_prompt=REVIEWER_SYSTEM_PROMPT,
            mcp_server_configs=mcp_server_configs,
        )

    def get_capabilities(self) -> List[str]:
        return [
            "Review code for quality and correctness",
            "Identify security vulnerabilities",
            "Check performance implications",
            "Assess test coverage",
            "Provide structured review feedback",
            "Approve or reject pull requests",
        ]

    async def review_pr(
        self,
        pr_url: str,
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Perform a comprehensive code review of a PR.

        Args:
            pr_url: URL of the pull request to review
            context: Shared workflow context

        Returns:
            AgentResult with structured review in JSON format
        """
        task = f"""Please perform a thorough code review of the pull request at: {pr_url}

Use the available tools to:
1. Get the PR information (title, description, author)
2. Fetch the complete diff
3. List all changed files

Then provide a comprehensive code review in JSON format:
{{
  "verdict": "APPROVED|CHANGES_REQUESTED|REJECTED",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "brief overview of the changes and review",
  "issues": [
    {{
      "severity": "BLOCKING|MAJOR|MINOR|SUGGESTION",
      "category": "security|performance|correctness|maintainability|testing|architecture",
      "file": "path/to/file.py",
      "line": 42,
      "title": "issue title",
      "description": "detailed description",
      "suggestion": "how to fix it"
    }}
  ],
  "strengths": ["things done well"],
  "blocking_count": 0,
  "major_count": 0,
  "minor_count": 0,
  "overall_quality_score": 8.5,
  "test_coverage_assessment": "adequate|needs improvement|insufficient",
  "security_assessment": "clean|minor concerns|blocking issues",
  "reviewer_notes": "additional context for the developer"
}}"""

        return await self.execute(task, context, extra_context={"pr_url": pr_url})

    async def check_security(
        self,
        pr_url: str,
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Perform a focused security review of a PR.

        Args:
            pr_url: URL of the pull request
            context: Shared workflow context

        Returns:
            AgentResult with security assessment
        """
        task = f"""Perform a focused security review of PR: {pr_url}

Check for:
1. SQL injection vulnerabilities
2. Cross-site scripting (XSS)
3. Authentication and authorization issues
4. Insecure data handling (PII, credentials)
5. Input validation gaps
6. Dependency vulnerabilities
7. Insecure cryptography usage
8. CORS/CSP issues
9. Rate limiting concerns
10. Information disclosure risks

Provide a security report in JSON format:
{{
  "security_verdict": "CLEAN|CONCERNS|BLOCKING",
  "vulnerabilities": [
    {{
      "cve_type": "e.g., OWASP-A1-2021",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "file": "path/to/file.py",
      "description": "vulnerability description",
      "remediation": "how to fix"
    }}
  ],
  "security_score": 9.0,
  "summary": "overall security assessment"
}}"""

        return await self.execute(task, context, extra_context={"pr_url": pr_url})

    async def add_review_comment(
        self,
        pr_url: str,
        review_result: Dict[str, Any],
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Add a review comment to the PR based on review results.

        Args:
            pr_url: URL of the pull request
            review_result: The structured review result to comment
            context: Shared workflow context

        Returns:
            AgentResult indicating if comment was added
        """
        task = f"""Based on the code review results, add a review comment to PR: {pr_url}

Format the comment as a clear, professional code review with:
- Summary of verdict
- Key issues found (grouped by severity)
- Specific suggestions
- Overall assessment

Make it constructive and professional. Use the add_pr_comment tool to post the comment."""

        return await self.execute(
            task,
            context,
            extra_context={"pr_url": pr_url, "review_result": review_result},
        )
