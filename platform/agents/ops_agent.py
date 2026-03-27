"""
Ops Agent - Represents the DevOps/Operations role in the workflow.

Responsible for:
- Monitoring and triggering CI/CD builds
- Managing deployment pipelines
- Updating PR statuses
- Coordinating environment provisioning
- Releasing to production after approval
"""

import logging
from typing import Any, Dict, List, Optional

from ..core.agent_base import BaseAgent, AgentResult
from ..core.context import WorkflowContext

logger = logging.getLogger(__name__)

OPS_SYSTEM_PROMPT = """You are an expert DevOps/Operations engineer responsible for build and deployment pipelines.
Your role is to:
1. Trigger and monitor CI/CD builds for pull requests
2. Manage test environment provisioning
3. Update PR status checks based on build/test results
4. Coordinate release deployments after QA approval
5. Monitor production deployments and report status

When handling builds:
- Check build status and wait for completion
- Parse build logs to identify failures
- Update PR status with build results
- Notify relevant parties of build outcomes

When managing deployments:
- Validate deployment prerequisites
- Execute deployment steps in correct order
- Monitor deployment health
- Rollback if deployment fails
- Confirm successful deployment

Always prioritize:
- Production stability over speed
- Clear communication about deployment status
- Proper validation before proceeding to next step
- Comprehensive logging of all actions taken

Report status clearly and immediately when issues arise.
"""


class OpsAgent(BaseAgent):
    """
    Ops agent that manages CI/CD and deployment operations.
    """

    def __init__(self, mcp_server_configs: Optional[List[Dict[str, Any]]] = None):
        super().__init__(
            role="ops_agent",
            system_prompt=OPS_SYSTEM_PROMPT,
            mcp_server_configs=mcp_server_configs,
        )

    def get_capabilities(self) -> List[str]:
        return [
            "Monitor CI/CD build status",
            "Update PR status checks",
            "Provision test environments",
            "Coordinate release deployments",
            "Monitor production health post-deploy",
            "Execute rollback procedures",
        ]

    async def check_build_status(
        self,
        pr_url: str,
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Check the CI/CD build status for a PR.

        Args:
            pr_url: URL of the pull request
            context: Shared workflow context

        Returns:
            AgentResult with build status information
        """
        task = f"""Check the build status for PR: {pr_url}

Use available tools to:
1. Get current PR status and check runs
2. Identify any failing build steps
3. Parse any build error messages

Provide a build status report in JSON format:
{{
  "build_status": "PASSED|FAILED|RUNNING|PENDING",
  "build_id": "identifier",
  "duration_seconds": 0,
  "failed_steps": ["list of failed steps if any"],
  "error_summary": "brief description of failures",
  "artifacts": ["list of build artifacts if any"],
  "next_action": "what should happen next"
}}"""

        return await self.execute(task, context, extra_context={"pr_url": pr_url})

    async def update_pr_status(
        self,
        pr_url: str,
        status: str,
        message: str,
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Update the status check on a PR.

        Args:
            pr_url: URL of the pull request
            status: Status to set (pending/success/failure/error)
            message: Status message
            context: Shared workflow context

        Returns:
            AgentResult indicating success
        """
        task = f"""Update the PR status for: {pr_url}

Status to set: {status}
Message: {message}

Use the update_pr_status tool to update the PR check status.
Then confirm the update was successful."""

        return await self.execute(
            task,
            context,
            extra_context={"pr_url": pr_url, "status": status, "message": message},
        )

    async def prepare_release(
        self,
        pr_url: str,
        approval_info: Dict[str, Any],
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Prepare and execute a production release.

        Args:
            pr_url: URL of the approved pull request
            approval_info: QA approval information
            context: Shared workflow context

        Returns:
            AgentResult with release outcome
        """
        task = f"""Prepare and execute the production release for approved PR: {pr_url}

The PR has received QA approval. Now:
1. Update the PR status to indicate deployment in progress
2. Add a comment summarizing the release
3. Update the final PR status to indicate successful deployment

Provide a release summary in JSON format:
{{
  "release_status": "SUCCESS|FAILED|PARTIAL",
  "deployed_at": "timestamp",
  "environment": "production",
  "version": "version identifier",
  "deployment_steps": ["list of completed steps"],
  "rollback_plan": "how to rollback if needed",
  "monitoring_checks": ["post-deployment checks to perform"],
  "release_notes": "summary of what was released"
}}"""

        return await self.execute(
            task,
            context,
            extra_context={"pr_url": pr_url, "approval_info": approval_info},
        )

    async def setup_test_environment(
        self,
        pr_url: str,
        requirements: Dict[str, Any],
        context: Optional[WorkflowContext] = None,
    ) -> AgentResult:
        """
        Set up a test environment for QA testing.

        Args:
            pr_url: URL of the pull request
            requirements: Environment requirements from test ticket
            context: Shared workflow context

        Returns:
            AgentResult with environment setup details
        """
        task = f"""Set up a test environment for PR: {pr_url}

Environment requirements: {requirements}

Coordinate the test environment setup:
1. Update PR status to indicate environment provisioning
2. Add a comment with environment access details
3. Provide setup verification steps

Return environment details in JSON format:
{{
  "environment_id": "env-identifier",
  "status": "READY|PROVISIONING|FAILED",
  "access_url": "http://test-env.example.com",
  "credentials": {{"username": "test", "note": "see secrets manager"}},
  "ready_at": "timestamp",
  "expires_at": "timestamp",
  "setup_notes": "any important setup notes"
}}"""

        return await self.execute(
            task,
            context,
            extra_context={"pr_url": pr_url, "requirements": requirements},
        )
