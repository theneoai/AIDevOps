"""
Shared Workflow Context - Shared state and data across all agents in a workflow run.

Provides a thread-safe, async-compatible store for workflow metadata,
PR information, test artifacts, and inter-agent communication.
"""

import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class PRInfo(BaseModel):
    """Pull Request information."""
    url: str
    title: str = ""
    description: str = ""
    author: str = ""
    base_branch: str = "main"
    head_branch: str = ""
    diff: str = ""
    changed_files: List[str] = Field(default_factory=list)
    created_at: Optional[datetime] = None


class BuildInfo(BaseModel):
    """CI/CD build information."""
    build_id: str = ""
    status: str = "pending"  # pending, running, passed, failed
    log_url: str = ""
    test_results: Dict[str, Any] = Field(default_factory=dict)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class TestTicketInfo(BaseModel):
    """Test ticket information."""
    ticket_id: str = ""
    title: str = ""
    assignee: str = ""
    status: str = "open"  # open, in_progress, resolved, closed
    created_at: Optional[datetime] = None
    test_cases_total: int = 0
    test_cases_passed: int = 0
    test_cases_failed: int = 0
    bugs: List[Dict[str, Any]] = Field(default_factory=list)


class WorkflowContext:
    """
    Shared context for a workflow execution run.

    Provides async-safe read/write access to shared state
    across all agents participating in a workflow.
    """

    def __init__(self, workflow_id: Optional[str] = None):
        import uuid
        self.workflow_id = workflow_id or str(uuid.uuid4())
        self.created_at = datetime.utcnow()

        # Core workflow data
        self.pr_info: Optional[PRInfo] = None
        self.build_info: Optional[BuildInfo] = None
        self.test_ticket: Optional[TestTicketInfo] = None

        # Analysis artifacts (populated by skills)
        self.change_analysis: Optional[Dict[str, Any]] = None
        self.test_cases: List[Dict[str, Any]] = []
        self.test_report: Optional[Dict[str, Any]] = None

        # Agent outputs and notes
        self.agent_notes: Dict[str, List[str]] = {}
        self.human_decisions: Dict[str, Dict[str, Any]] = {}

        # Generic key-value store for extensibility
        self._data: Dict[str, Any] = {}
        self._lock = asyncio.Lock()

        logger.debug(f"Created WorkflowContext: {self.workflow_id}")

    async def set(self, key: str, value: Any) -> None:
        """Thread-safe key-value set."""
        async with self._lock:
            self._data[key] = value
            logger.debug(f"Context[{self.workflow_id}] set: {key}")

    async def get(self, key: str, default: Any = None) -> Any:
        """Thread-safe key-value get."""
        async with self._lock:
            return self._data.get(key, default)

    async def add_agent_note(self, agent_role: str, note: str) -> None:
        """Add a note from an agent to the context."""
        async with self._lock:
            if agent_role not in self.agent_notes:
                self.agent_notes[agent_role] = []
            self.agent_notes[agent_role].append(
                f"[{datetime.utcnow().isoformat()}] {note}"
            )
        logger.debug(f"Context[{self.workflow_id}] note from {agent_role}: {note[:80]}")

    async def record_human_decision(
        self,
        checkpoint: str,
        approver: str,
        approved: bool,
        comment: str = "",
    ) -> None:
        """Record a human-in-the-loop decision at a checkpoint."""
        async with self._lock:
            self.human_decisions[checkpoint] = {
                "approver": approver,
                "approved": approved,
                "comment": comment,
                "timestamp": datetime.utcnow().isoformat(),
            }
        logger.info(
            f"Context[{self.workflow_id}] human decision at '{checkpoint}': "
            f"{'APPROVED' if approved else 'REJECTED'} by {approver}"
        )

    def is_approved(self, checkpoint: str) -> bool:
        """Check if a specific checkpoint was approved."""
        decision = self.human_decisions.get(checkpoint)
        return decision is not None and decision.get("approved", False)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize context to dictionary for logging/storage."""
        return {
            "workflow_id": self.workflow_id,
            "created_at": self.created_at.isoformat(),
            "pr_info": self.pr_info.model_dump() if self.pr_info else None,
            "build_info": self.build_info.model_dump() if self.build_info else None,
            "test_ticket": self.test_ticket.model_dump() if self.test_ticket else None,
            "change_analysis": self.change_analysis,
            "test_cases_count": len(self.test_cases),
            "agent_notes": {
                role: len(notes)
                for role, notes in self.agent_notes.items()
            },
            "human_decisions": self.human_decisions,
            "custom_data_keys": list(self._data.keys()),
        }

    def __repr__(self) -> str:
        return (
            f"WorkflowContext(id={self.workflow_id!r}, "
            f"pr={self.pr_info.url if self.pr_info else 'none'})"
        )
