"""
Workflow Engine - State machine + event bus for the DevOps workflow platform.

Manages state transitions for the 研发提测 (dev-to-QA handoff) workflow
with human-in-the-loop checkpoints and async event handling.
"""

import asyncio
import logging
from datetime import datetime
from enum import Enum
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)


class WorkflowState(str, Enum):
    """All states in the 研发提测 workflow."""
    CODING = "CODING"
    PR_CREATED = "PR_CREATED"
    CODE_REVIEW = "CODE_REVIEW"
    BUILD_TEST = "BUILD_TEST"
    SUBMIT_TEST_TICKET = "SUBMIT_TEST_TICKET"
    QA_ASSIGNED = "QA_ASSIGNED"
    TESTING = "TESTING"
    BUG_FIXING = "BUG_FIXING"
    RETEST = "RETEST"
    APPROVED = "APPROVED"
    RELEASED = "RELEASED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


@dataclass
class WorkflowEvent:
    """Represents a workflow event that triggers state transitions."""
    event_type: str
    payload: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.utcnow)
    source: str = "system"
    correlation_id: Optional[str] = None

    def __repr__(self) -> str:
        return (
            f"WorkflowEvent(type={self.event_type!r}, "
            f"source={self.source!r}, "
            f"ts={self.timestamp.isoformat()})"
        )


# Type alias for event handlers
EventHandler = Callable[[WorkflowEvent, "WorkflowContext"], Coroutine[Any, Any, None]]


# Valid state transitions table
# Maps (from_state, event_type) -> to_state
VALID_TRANSITIONS: Dict[Tuple[WorkflowState, str], WorkflowState] = {
    # Developer creates PR
    (WorkflowState.CODING, "pr_created"): WorkflowState.PR_CREATED,

    # PR triggers code review
    (WorkflowState.PR_CREATED, "review_requested"): WorkflowState.CODE_REVIEW,

    # Code review passes → build & test
    (WorkflowState.CODE_REVIEW, "review_approved"): WorkflowState.BUILD_TEST,

    # Code review fails → back to coding
    (WorkflowState.CODE_REVIEW, "review_rejected"): WorkflowState.CODING,

    # Build passes → submit test ticket
    (WorkflowState.BUILD_TEST, "build_passed"): WorkflowState.SUBMIT_TEST_TICKET,

    # Build fails → back to coding
    (WorkflowState.BUILD_TEST, "build_failed"): WorkflowState.CODING,

    # Test ticket submitted → assign to QA
    (WorkflowState.SUBMIT_TEST_TICKET, "ticket_submitted"): WorkflowState.QA_ASSIGNED,

    # QA assignment confirmed → start testing
    (WorkflowState.QA_ASSIGNED, "testing_started"): WorkflowState.TESTING,

    # Testing found bugs → bug fixing
    (WorkflowState.TESTING, "bugs_found"): WorkflowState.BUG_FIXING,

    # Testing passed → approved
    (WorkflowState.TESTING, "testing_passed"): WorkflowState.APPROVED,

    # Bugs fixed → retest
    (WorkflowState.BUG_FIXING, "bugs_fixed"): WorkflowState.RETEST,

    # Retest passed → approved
    (WorkflowState.RETEST, "retest_passed"): WorkflowState.APPROVED,

    # Retest found more bugs → back to bug fixing
    (WorkflowState.RETEST, "retest_failed"): WorkflowState.BUG_FIXING,

    # Approved → release
    (WorkflowState.APPROVED, "release_approved"): WorkflowState.RELEASED,

    # Any state → failed (on critical error)
    (WorkflowState.PR_CREATED, "workflow_failed"): WorkflowState.FAILED,
    (WorkflowState.CODE_REVIEW, "workflow_failed"): WorkflowState.FAILED,
    (WorkflowState.BUILD_TEST, "workflow_failed"): WorkflowState.FAILED,
    (WorkflowState.SUBMIT_TEST_TICKET, "workflow_failed"): WorkflowState.FAILED,
    (WorkflowState.QA_ASSIGNED, "workflow_failed"): WorkflowState.FAILED,
    (WorkflowState.TESTING, "workflow_failed"): WorkflowState.FAILED,
    (WorkflowState.BUG_FIXING, "workflow_failed"): WorkflowState.FAILED,
    (WorkflowState.RETEST, "workflow_failed"): WorkflowState.FAILED,
    (WorkflowState.APPROVED, "workflow_failed"): WorkflowState.FAILED,

    # Any state → cancelled
    (WorkflowState.CODING, "workflow_cancelled"): WorkflowState.CANCELLED,
    (WorkflowState.PR_CREATED, "workflow_cancelled"): WorkflowState.CANCELLED,
    (WorkflowState.CODE_REVIEW, "workflow_cancelled"): WorkflowState.CANCELLED,
    (WorkflowState.BUILD_TEST, "workflow_cancelled"): WorkflowState.CANCELLED,
    (WorkflowState.SUBMIT_TEST_TICKET, "workflow_cancelled"): WorkflowState.CANCELLED,
    (WorkflowState.QA_ASSIGNED, "workflow_cancelled"): WorkflowState.CANCELLED,
    (WorkflowState.TESTING, "workflow_cancelled"): WorkflowState.CANCELLED,
    (WorkflowState.BUG_FIXING, "workflow_cancelled"): WorkflowState.CANCELLED,
    (WorkflowState.RETEST, "workflow_cancelled"): WorkflowState.CANCELLED,
    (WorkflowState.APPROVED, "workflow_cancelled"): WorkflowState.CANCELLED,
}

# Terminal states that cannot transition further
TERMINAL_STATES: Set[WorkflowState] = {
    WorkflowState.RELEASED,
    WorkflowState.FAILED,
    WorkflowState.CANCELLED,
}


class WorkflowEngine:
    """
    State machine + async event bus for the DevOps workflow.

    Manages state transitions with validation, fires events to registered
    handlers, and supports human-in-the-loop checkpoints.
    """

    def __init__(self, initial_state: WorkflowState = WorkflowState.CODING):
        self._state = initial_state
        self._history: List[Tuple[WorkflowState, WorkflowEvent]] = []
        self._handlers: Dict[str, List[EventHandler]] = {}
        self._wildcard_handlers: List[EventHandler] = []
        self._event_queue: asyncio.Queue[WorkflowEvent] = asyncio.Queue()
        self._running = False
        self._lock = asyncio.Lock()

    @property
    def state(self) -> WorkflowState:
        """Current workflow state."""
        return self._state

    @property
    def history(self) -> List[Tuple[WorkflowState, WorkflowEvent]]:
        """Immutable view of state transition history."""
        return list(self._history)

    def get_state(self) -> WorkflowState:
        """Get the current workflow state."""
        return self._state

    def register_handler(
        self,
        event_type: str,
        handler: EventHandler,
    ) -> None:
        """
        Register an async handler for a specific event type.

        Use '*' as event_type to handle all events.
        """
        if event_type == "*":
            self._wildcard_handlers.append(handler)
            logger.debug(f"Registered wildcard handler: {handler.__name__}")
        else:
            if event_type not in self._handlers:
                self._handlers[event_type] = []
            self._handlers[event_type].append(handler)
            logger.debug(
                f"Registered handler for '{event_type}': {handler.__name__}"
            )

    def can_transition(self, event_type: str) -> bool:
        """Check if a transition is valid from current state via event_type."""
        return (self._state, event_type) in VALID_TRANSITIONS

    async def trigger(
        self,
        event_type: str,
        payload: Optional[Dict[str, Any]] = None,
        source: str = "system",
        context: Optional["WorkflowContext"] = None,
    ) -> WorkflowState:
        """
        Trigger a state transition via an event.

        Validates the transition, updates state, records history,
        and fires all registered handlers.

        Args:
            event_type: The event type string (e.g., 'pr_created')
            payload: Optional data payload for the event
            source: Event source identifier (e.g., agent name)
            context: Optional workflow context to pass to handlers

        Returns:
            The new workflow state after transition

        Raises:
            ValueError: If the transition is invalid from current state
            RuntimeError: If current state is terminal
        """
        async with self._lock:
            if self._state in TERMINAL_STATES:
                raise RuntimeError(
                    f"Workflow is in terminal state {self._state.value}. "
                    "No further transitions are possible."
                )

            transition_key = (self._state, event_type)
            if transition_key not in VALID_TRANSITIONS:
                raise ValueError(
                    f"Invalid transition: cannot go from {self._state.value} "
                    f"via event '{event_type}'. "
                    f"Valid events from this state: "
                    f"{self._get_valid_events()}"
                )

            new_state = VALID_TRANSITIONS[transition_key]
            event = WorkflowEvent(
                event_type=event_type,
                payload=payload or {},
                source=source,
            )

            old_state = self._state
            self._state = new_state
            self._history.append((old_state, event))

            logger.info(
                f"State transition: {old_state.value} → {new_state.value} "
                f"(event: {event_type}, source: {source})"
            )

        # Fire handlers outside the lock to avoid deadlocks
        await self._fire_handlers(event, context)

        return new_state

    async def _fire_handlers(
        self,
        event: WorkflowEvent,
        context: Optional["WorkflowContext"] = None,
    ) -> None:
        """Fire all registered handlers for an event."""
        from .context import WorkflowContext as WC
        ctx = context or WC()

        handlers_to_run = []

        # Wildcard handlers
        handlers_to_run.extend(self._wildcard_handlers)

        # Event-specific handlers
        if event.event_type in self._handlers:
            handlers_to_run.extend(self._handlers[event.event_type])

        if not handlers_to_run:
            return

        # Run all handlers concurrently
        tasks = [handler(event, ctx) for handler in handlers_to_run]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for handler, result in zip(handlers_to_run, results):
            if isinstance(result, Exception):
                logger.error(
                    f"Handler {handler.__name__} raised exception: {result}",
                    exc_info=result,
                )

    def _get_valid_events(self) -> List[str]:
        """Get list of valid event types from current state."""
        return [
            event_type
            for (state, event_type) in VALID_TRANSITIONS
            if state == self._state
        ]

    def get_progress_summary(self) -> Dict[str, Any]:
        """Get a summary of the workflow progress."""
        all_states = list(WorkflowState)
        current_idx = all_states.index(self._state)

        return {
            "current_state": self._state.value,
            "is_terminal": self._state in TERMINAL_STATES,
            "transitions_completed": len(self._history),
            "valid_next_events": self._get_valid_events(),
            "history": [
                {
                    "from_state": state.value,
                    "event": event.event_type,
                    "source": event.source,
                    "timestamp": event.timestamp.isoformat(),
                }
                for state, event in self._history
            ],
        }
