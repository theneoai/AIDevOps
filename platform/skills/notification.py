"""
Notification Skill - Multi-channel notification capabilities.

Sends workflow notifications via multiple channels:
- Console/logging (always available)
- Webhook (Slack, DingTalk, WeChat Work, etc.)
- Email (if configured)

In production, integrate with your actual notification services.
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


class NotificationLevel(str, Enum):
    """Notification importance level."""
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"


@dataclass
class NotificationConfig:
    """Configuration for notification channels."""
    # Webhook URL (Slack, DingTalk, etc.)
    webhook_url: Optional[str] = None
    # Webhook type: slack, dingtalk, wecom, generic
    webhook_type: str = "generic"
    # Email configuration
    email_recipients: List[str] = field(default_factory=list)
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    # Mention user IDs (for Slack, DingTalk, etc.)
    mention_users: List[str] = field(default_factory=list)


@dataclass
class Notification:
    """A notification to be sent."""
    title: str
    message: str
    level: NotificationLevel = NotificationLevel.INFO
    workflow_id: Optional[str] = None
    pr_url: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.utcnow)


class NotificationSkill:
    """
    Multi-channel notification skill for workflow events.

    Usage:
        skill = NotificationSkill(config)
        await skill.notify_pr_submitted(pr_url, author, ticket_id)
        await skill.notify_review_complete(pr_url, verdict, reviewer)
        await skill.notify_qa_assigned(ticket_id, assignee)
        await skill.notify_release_approved(pr_url, qa_lead)
    """

    def __init__(self, config: Optional[NotificationConfig] = None):
        self._config = config or NotificationConfig()

    async def send(self, notification: Notification) -> bool:
        """
        Send a notification through all configured channels.

        Args:
            notification: The notification to send

        Returns:
            True if at least one channel succeeded
        """
        success = False

        # Always log
        self._log_notification(notification)
        success = True

        # Send via webhook if configured
        if self._config.webhook_url:
            webhook_success = await self._send_webhook(notification)
            success = success or webhook_success

        return success

    async def notify_workflow_started(
        self,
        pr_url: str,
        author: str,
        workflow_id: str,
    ) -> bool:
        """Notify that a new workflow has started."""
        return await self.send(Notification(
            title="🚀 Dev-to-QA Workflow Started",
            message=f"New workflow started for PR by {author}.\nPR: {pr_url}",
            level=NotificationLevel.INFO,
            workflow_id=workflow_id,
            pr_url=pr_url,
            metadata={"author": author},
        ))

    async def notify_review_requested(
        self,
        pr_url: str,
        author: str,
        reviewers: List[str],
    ) -> bool:
        """Notify reviewers that code review is requested."""
        reviewers_str = ", ".join(reviewers) if reviewers else "assigned reviewers"
        return await self.send(Notification(
            title="👀 Code Review Requested",
            message=(
                f"Code review requested for PR by {author}.\n"
                f"Reviewers: {reviewers_str}\n"
                f"PR: {pr_url}"
            ),
            level=NotificationLevel.INFO,
            pr_url=pr_url,
            metadata={"author": author, "reviewers": reviewers},
        ))

    async def notify_review_complete(
        self,
        pr_url: str,
        verdict: str,
        reviewer: str,
        comments_count: int = 0,
    ) -> bool:
        """Notify that code review is complete."""
        level = NotificationLevel.SUCCESS if verdict == "APPROVED" else NotificationLevel.WARNING
        emoji = "✅" if verdict == "APPROVED" else "🔄"
        return await self.send(Notification(
            title=f"{emoji} Code Review {verdict}",
            message=(
                f"Code review completed by {reviewer}.\n"
                f"Verdict: {verdict}\n"
                f"Comments: {comments_count}\n"
                f"PR: {pr_url}"
            ),
            level=level,
            pr_url=pr_url,
            metadata={"reviewer": reviewer, "verdict": verdict},
        ))

    async def notify_build_result(
        self,
        pr_url: str,
        build_status: str,
        build_id: str = "",
    ) -> bool:
        """Notify about CI/CD build result."""
        level = NotificationLevel.SUCCESS if build_status == "PASSED" else NotificationLevel.ERROR
        emoji = "✅" if build_status == "PASSED" else "❌"
        return await self.send(Notification(
            title=f"{emoji} Build {build_status}",
            message=(
                f"CI/CD build {build_status.lower()}.\n"
                f"Build ID: {build_id or 'N/A'}\n"
                f"PR: {pr_url}"
            ),
            level=level,
            pr_url=pr_url,
            metadata={"build_status": build_status, "build_id": build_id},
        ))

    async def notify_test_ticket_created(
        self,
        ticket_id: str,
        pr_url: str,
        author: str,
        qa_assignee: str = "",
    ) -> bool:
        """Notify that a test ticket has been created and assigned."""
        assignee_info = f"\nAssigned to: {qa_assignee}" if qa_assignee else ""
        return await self.send(Notification(
            title="📋 Test Ticket Created",
            message=(
                f"Test ticket {ticket_id} created by {author}.{assignee_info}\n"
                f"PR: {pr_url}"
            ),
            level=NotificationLevel.INFO,
            pr_url=pr_url,
            metadata={"ticket_id": ticket_id, "author": author, "assignee": qa_assignee},
        ))

    async def notify_qa_assigned(
        self,
        ticket_id: str,
        assignee: str,
        pr_url: str,
    ) -> bool:
        """Notify QA engineer of new assignment."""
        return await self.send(Notification(
            title="📌 QA Assignment",
            message=(
                f"Test ticket {ticket_id} assigned to {assignee}.\n"
                f"Please begin testing.\nPR: {pr_url}"
            ),
            level=NotificationLevel.INFO,
            pr_url=pr_url,
            metadata={"ticket_id": ticket_id, "assignee": assignee},
        ))

    async def notify_bugs_found(
        self,
        ticket_id: str,
        pr_url: str,
        bug_count: int,
        critical_count: int = 0,
    ) -> bool:
        """Notify developer of bugs found during testing."""
        level = NotificationLevel.ERROR if critical_count > 0 else NotificationLevel.WARNING
        return await self.send(Notification(
            title=f"🐛 {bug_count} Bug(s) Found",
            message=(
                f"QA found {bug_count} bug(s) in ticket {ticket_id}.\n"
                f"Critical bugs: {critical_count}\n"
                f"Please review and fix.\nPR: {pr_url}"
            ),
            level=level,
            pr_url=pr_url,
            metadata={
                "ticket_id": ticket_id,
                "bug_count": bug_count,
                "critical_count": critical_count,
            },
        ))

    async def notify_release_approved(
        self,
        pr_url: str,
        ticket_id: str,
        approver: str,
    ) -> bool:
        """Notify that release has been approved by QA."""
        return await self.send(Notification(
            title="✅ Release Approved",
            message=(
                f"QA has approved the release!\n"
                f"Ticket: {ticket_id}\n"
                f"Approved by: {approver}\n"
                f"PR: {pr_url}"
            ),
            level=NotificationLevel.SUCCESS,
            pr_url=pr_url,
            metadata={"ticket_id": ticket_id, "approver": approver},
        ))

    async def notify_released(
        self,
        pr_url: str,
        version: str = "",
    ) -> bool:
        """Notify that the release has been deployed."""
        return await self.send(Notification(
            title="🎉 Released to Production",
            message=(
                f"Successfully released to production!\n"
                f"Version: {version or 'N/A'}\n"
                f"PR: {pr_url}"
            ),
            level=NotificationLevel.SUCCESS,
            pr_url=pr_url,
            metadata={"version": version},
        ))

    async def notify_workflow_failed(
        self,
        pr_url: str,
        state: str,
        error: str,
        workflow_id: str = "",
    ) -> bool:
        """Notify that the workflow has failed."""
        return await self.send(Notification(
            title="❌ Workflow Failed",
            message=(
                f"Workflow failed at state: {state}\n"
                f"Error: {error}\n"
                f"PR: {pr_url}"
            ),
            level=NotificationLevel.ERROR,
            workflow_id=workflow_id,
            pr_url=pr_url,
            metadata={"state": state, "error": error},
        ))

    async def notify_human_approval_needed(
        self,
        checkpoint: str,
        pr_url: str,
        approvers: List[str],
        timeout_hours: int,
    ) -> bool:
        """Notify approvers that human input is needed."""
        approvers_str = ", ".join(approvers)
        return await self.send(Notification(
            title=f"⏳ Approval Needed: {checkpoint}",
            message=(
                f"Human approval required at checkpoint: {checkpoint}\n"
                f"Approvers: {approvers_str}\n"
                f"Timeout: {timeout_hours} hours\n"
                f"PR: {pr_url}"
            ),
            level=NotificationLevel.WARNING,
            pr_url=pr_url,
            metadata={
                "checkpoint": checkpoint,
                "approvers": approvers,
                "timeout_hours": timeout_hours,
            },
        ))

    def _log_notification(self, notification: Notification) -> None:
        """Log notification to console."""
        level_to_log = {
            NotificationLevel.INFO: logger.info,
            NotificationLevel.SUCCESS: logger.info,
            NotificationLevel.WARNING: logger.warning,
            NotificationLevel.ERROR: logger.error,
        }
        log_fn = level_to_log.get(notification.level, logger.info)
        log_fn(
            f"[NOTIFICATION] {notification.title}\n"
            f"  {notification.message.replace(chr(10), chr(10) + '  ')}"
        )

    async def _send_webhook(self, notification: Notification) -> bool:
        """Send notification via webhook."""
        if not self._config.webhook_url:
            return False

        try:
            payload = self._build_webhook_payload(notification)

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    self._config.webhook_url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                response.raise_for_status()
                logger.debug(f"Webhook sent successfully: {response.status_code}")
                return True

        except Exception as e:
            logger.warning(f"Webhook notification failed: {e}")
            return False

    def _build_webhook_payload(self, notification: Notification) -> Dict[str, Any]:
        """Build webhook payload based on webhook type."""
        webhook_type = self._config.webhook_type.lower()

        if webhook_type == "slack":
            return self._build_slack_payload(notification)
        elif webhook_type == "dingtalk":
            return self._build_dingtalk_payload(notification)
        elif webhook_type == "wecom":
            return self._build_wecom_payload(notification)
        else:
            # Generic webhook payload
            return {
                "title": notification.title,
                "message": notification.message,
                "level": notification.level.value,
                "pr_url": notification.pr_url,
                "workflow_id": notification.workflow_id,
                "timestamp": notification.timestamp.isoformat(),
                "metadata": notification.metadata,
            }

    def _build_slack_payload(self, notification: Notification) -> Dict[str, Any]:
        """Build Slack webhook payload."""
        color_map = {
            NotificationLevel.INFO: "#36a64f",
            NotificationLevel.SUCCESS: "#2eb886",
            NotificationLevel.WARNING: "#daa038",
            NotificationLevel.ERROR: "#cc0000",
        }
        color = color_map.get(notification.level, "#36a64f")

        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*{notification.title}*\n{notification.message}",
                },
            }
        ]

        if notification.pr_url:
            blocks.append({
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"<{notification.pr_url}|View PR>",
                    }
                ],
            })

        # Add mentions
        if self._config.mention_users:
            mentions = " ".join(f"<@{u}>" for u in self._config.mention_users)
            blocks.append({
                "type": "section",
                "text": {"type": "mrkdwn", "text": mentions},
            })

        return {
            "attachments": [
                {
                    "color": color,
                    "blocks": blocks,
                }
            ]
        }

    def _build_dingtalk_payload(self, notification: Notification) -> Dict[str, Any]:
        """Build DingTalk webhook payload."""
        at_mobiles = self._config.mention_users
        text = f"### {notification.title}\n\n{notification.message}"
        if notification.pr_url:
            text += f"\n\n[查看PR]({notification.pr_url})"

        return {
            "msgtype": "markdown",
            "markdown": {
                "title": notification.title,
                "text": text,
            },
            "at": {
                "atMobiles": at_mobiles,
                "isAtAll": False,
            },
        }

    def _build_wecom_payload(self, notification: Notification) -> Dict[str, Any]:
        """Build WeChat Work (企业微信) webhook payload."""
        text = f"{notification.title}\n{notification.message}"
        if notification.pr_url:
            text += f"\n查看PR: {notification.pr_url}"

        return {
            "msgtype": "text",
            "text": {
                "content": text,
                "mentioned_list": self._config.mention_users or [],
            },
        }
