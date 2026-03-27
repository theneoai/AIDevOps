"""
Test Management MCP Server

A FastMCP server that provides tools for managing test tickets, recording
test results, and generating test reports.

Simulates a test management system (like Jira, TestRail, or Zephyr).
In production, connect this to your actual test management platform.

Run standalone:
    mcp dev mcp_servers/test_management/server.py

Or as subprocess transport from agents.
"""

import json
import logging
import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from mcp.server.fastmcp import FastMCP

logger = logging.getLogger(__name__)

# Initialize FastMCP server
mcp = FastMCP(
    name="test-management",
    instructions=(
        "Test Management MCP server. Provides tools for creating and managing "
        "test tickets, assigning them to QA engineers, recording test results, "
        "logging bugs, and generating test reports."
    ),
)

# In-memory storage for test management data
_tickets: Dict[str, Dict[str, Any]] = {}
_test_results: Dict[str, List[Dict[str, Any]]] = {}
_bugs: Dict[str, List[Dict[str, Any]]] = {}
_assignments: Dict[str, str] = {}  # ticket_id -> assignee


@mcp.tool()
def create_test_ticket(ticket_data: dict) -> str:
    """
    Create a new test ticket in the test management system.

    Args:
        ticket_data: Dictionary containing ticket information:
            - title (str): Ticket title
            - pr_url (str): Pull request URL
            - author (str): Developer who submitted the PR
            - description (str): What needs to be tested
            - test_scope (str): Scope of testing
            - risk_points (list): Risk areas to focus on
            - test_cases (list): List of test case objects
            - environment (str): Test environment required
            - deadline (str): Testing deadline
            - priority (str): URGENT/HIGH/NORMAL/LOW

    Returns:
        JSON string with created ticket details including ticket_id
    """
    logger.info(f"create_test_ticket called: {ticket_data.get('title', 'Unknown')}")

    ticket_id = f"TT-{uuid.uuid4().hex[:8].upper()}"

    ticket = {
        "ticket_id": ticket_id,
        "title": ticket_data.get("title", "Test Ticket"),
        "pr_url": ticket_data.get("pr_url", ""),
        "author": ticket_data.get("author", "unknown"),
        "description": ticket_data.get("description", ""),
        "test_scope": ticket_data.get("test_scope", ""),
        "out_of_scope": ticket_data.get("out_of_scope", ""),
        "risk_points": ticket_data.get("risk_points", []),
        "test_cases": ticket_data.get("test_cases", []),
        "environment": ticket_data.get("environment", "staging"),
        "environment_setup": ticket_data.get("environment_setup", []),
        "deadline": ticket_data.get("deadline", ""),
        "priority": ticket_data.get("priority", "NORMAL"),
        "labels": ticket_data.get("labels", []),
        "notes": ticket_data.get("notes", ""),
        "status": "open",
        "assignee": "",
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
        "total_test_cases": len(ticket_data.get("test_cases", [])),
        "passed_test_cases": 0,
        "failed_test_cases": 0,
    }

    _tickets[ticket_id] = ticket
    _test_results[ticket_id] = []
    _bugs[ticket_id] = []

    logger.info(f"Created ticket {ticket_id}: {ticket['title']}")

    return json.dumps({
        "success": True,
        "ticket_id": ticket_id,
        "title": ticket["title"],
        "status": "open",
        "total_test_cases": ticket["total_test_cases"],
        "created_at": ticket["created_at"],
        "url": f"https://test-mgmt.example.com/tickets/{ticket_id}",
    }, indent=2)


@mcp.tool()
def assign_ticket(ticket_id: str, assignee: str) -> str:
    """
    Assign a test ticket to a QA engineer.

    Args:
        ticket_id: The test ticket identifier (e.g., TT-ABC12345)
        assignee: The QA engineer's username or ID to assign the ticket to

    Returns:
        JSON string confirming the assignment
    """
    logger.info(f"assign_ticket called: {ticket_id} -> {assignee}")

    if ticket_id not in _tickets:
        return json.dumps({
            "success": False,
            "error": f"Ticket {ticket_id} not found",
        })

    _tickets[ticket_id]["assignee"] = assignee
    _tickets[ticket_id]["status"] = "assigned"
    _tickets[ticket_id]["assigned_at"] = datetime.utcnow().isoformat()
    _tickets[ticket_id]["updated_at"] = datetime.utcnow().isoformat()
    _assignments[ticket_id] = assignee

    logger.info(f"Ticket {ticket_id} assigned to {assignee}")

    return json.dumps({
        "success": True,
        "ticket_id": ticket_id,
        "assignee": assignee,
        "status": "assigned",
        "assigned_at": _tickets[ticket_id]["assigned_at"],
    }, indent=2)


@mcp.tool()
def update_ticket_status(ticket_id: str, status: str, comment: str = "") -> str:
    """
    Update the status of a test ticket.

    Args:
        ticket_id: The test ticket identifier
        status: New status - one of: open, assigned, in_progress, blocked,
                bug_fixing, retesting, resolved, closed
        comment: Optional comment explaining the status change

    Returns:
        JSON string confirming the status update
    """
    logger.info(f"update_ticket_status called: {ticket_id} -> {status}")

    if ticket_id not in _tickets:
        return json.dumps({
            "success": False,
            "error": f"Ticket {ticket_id} not found",
        })

    valid_statuses = {
        "open", "assigned", "in_progress", "blocked",
        "bug_fixing", "retesting", "resolved", "closed",
    }

    if status not in valid_statuses:
        return json.dumps({
            "success": False,
            "error": f"Invalid status '{status}'. Must be one of: {valid_statuses}",
        })

    old_status = _tickets[ticket_id]["status"]
    _tickets[ticket_id]["status"] = status
    _tickets[ticket_id]["updated_at"] = datetime.utcnow().isoformat()

    if comment:
        if "status_history" not in _tickets[ticket_id]:
            _tickets[ticket_id]["status_history"] = []
        _tickets[ticket_id]["status_history"].append({
            "from": old_status,
            "to": status,
            "comment": comment,
            "timestamp": datetime.utcnow().isoformat(),
        })

    return json.dumps({
        "success": True,
        "ticket_id": ticket_id,
        "previous_status": old_status,
        "new_status": status,
        "comment": comment,
        "updated_at": _tickets[ticket_id]["updated_at"],
    }, indent=2)


@mcp.tool()
def add_test_result(
    ticket_id: str,
    test_case_id: str,
    result: str,
    notes: str = "",
    bug_info: Optional[dict] = None,
) -> str:
    """
    Record the result of executing a test case.

    Args:
        ticket_id: The test ticket identifier
        test_case_id: The test case identifier (e.g., TC-001)
        result: Test result - one of: PASSED, FAILED, BLOCKED, SKIPPED, IN_PROGRESS
        notes: Optional notes about the test execution
        bug_info: Optional bug information if the test failed, with fields:
            - title (str): Bug title
            - severity (str): CRITICAL/HIGH/MEDIUM/LOW
            - description (str): Bug description
            - steps (list): Steps to reproduce

    Returns:
        JSON string with the recorded result and any created bug ID
    """
    logger.info(f"add_test_result called: {ticket_id}/{test_case_id} -> {result}")

    if ticket_id not in _tickets:
        return json.dumps({
            "success": False,
            "error": f"Ticket {ticket_id} not found",
        })

    valid_results = {"PASSED", "FAILED", "BLOCKED", "SKIPPED", "IN_PROGRESS"}
    if result not in valid_results:
        return json.dumps({
            "success": False,
            "error": f"Invalid result '{result}'. Must be one of: {valid_results}",
        })

    test_result = {
        "test_case_id": test_case_id,
        "result": result,
        "notes": notes,
        "executed_at": datetime.utcnow().isoformat(),
        "executed_by": _assignments.get(ticket_id, "qa_engineer"),
    }

    # Create bug if test failed and bug_info provided
    bug_id = None
    if result == "FAILED" and bug_info:
        bug_id = f"BUG-{uuid.uuid4().hex[:6].upper()}"
        bug = {
            "bug_id": bug_id,
            "ticket_id": ticket_id,
            "test_case_id": test_case_id,
            "title": bug_info.get("title", f"Bug in {test_case_id}"),
            "severity": bug_info.get("severity", "MEDIUM"),
            "priority": bug_info.get("priority", "P2"),
            "description": bug_info.get("description", ""),
            "steps_to_reproduce": bug_info.get("steps", []),
            "expected_behavior": bug_info.get("expected", ""),
            "actual_behavior": bug_info.get("actual", ""),
            "status": "open",
            "created_at": datetime.utcnow().isoformat(),
        }
        _bugs[ticket_id].append(bug)
        test_result["bug_id"] = bug_id

    _test_results[ticket_id].append(test_result)

    # Update ticket counters
    ticket = _tickets[ticket_id]
    results_for_ticket = _test_results[ticket_id]
    ticket["passed_test_cases"] = sum(1 for r in results_for_ticket if r["result"] == "PASSED")
    ticket["failed_test_cases"] = sum(1 for r in results_for_ticket if r["result"] == "FAILED")
    ticket["updated_at"] = datetime.utcnow().isoformat()

    return json.dumps({
        "success": True,
        "ticket_id": ticket_id,
        "test_case_id": test_case_id,
        "result": result,
        "bug_id": bug_id,
        "total_results": len(_test_results[ticket_id]),
        "passed": ticket["passed_test_cases"],
        "failed": ticket["failed_test_cases"],
    }, indent=2)


@mcp.tool()
def list_bugs(ticket_id: str) -> str:
    """
    List all bugs found during testing of a specific ticket.

    Args:
        ticket_id: The test ticket identifier

    Returns:
        JSON string with list of all bugs found, grouped by severity
    """
    logger.info(f"list_bugs called for ticket: {ticket_id}")

    if ticket_id not in _tickets:
        return json.dumps({
            "success": False,
            "error": f"Ticket {ticket_id} not found",
        })

    bugs = _bugs.get(ticket_id, [])

    # Group by severity
    severity_groups: Dict[str, List] = {
        "CRITICAL": [],
        "HIGH": [],
        "MEDIUM": [],
        "LOW": [],
    }

    for bug in bugs:
        severity = bug.get("severity", "MEDIUM")
        if severity in severity_groups:
            severity_groups[severity].append(bug)
        else:
            severity_groups["MEDIUM"].append(bug)

    return json.dumps({
        "ticket_id": ticket_id,
        "bugs": bugs,
        "total_bugs": len(bugs),
        "by_severity": {
            severity: len(bug_list)
            for severity, bug_list in severity_groups.items()
        },
        "open_bugs": sum(1 for b in bugs if b.get("status") == "open"),
        "resolved_bugs": sum(1 for b in bugs if b.get("status") == "resolved"),
    }, indent=2)


@mcp.tool()
def generate_test_report(ticket_id: str) -> str:
    """
    Generate a comprehensive final test report for a ticket.

    Args:
        ticket_id: The test ticket identifier

    Returns:
        JSON string with complete test report including coverage, bugs, and recommendation
    """
    logger.info(f"generate_test_report called for ticket: {ticket_id}")

    if ticket_id not in _tickets:
        return json.dumps({
            "success": False,
            "error": f"Ticket {ticket_id} not found",
        })

    ticket = _tickets[ticket_id]
    results = _test_results.get(ticket_id, [])
    bugs = _bugs.get(ticket_id, [])

    total_cases = ticket["total_test_cases"]
    passed = ticket["passed_test_cases"]
    failed = ticket["failed_test_cases"]
    not_executed = max(0, total_cases - len(results))
    pass_rate = (passed / total_cases * 100) if total_cases > 0 else 0

    # Determine overall result
    critical_bugs = sum(1 for b in bugs if b.get("severity") == "CRITICAL" and b.get("status") == "open")
    high_bugs = sum(1 for b in bugs if b.get("severity") == "HIGH" and b.get("status") == "open")

    if critical_bugs > 0:
        overall_result = "FAILED"
        recommendation = "BLOCK_RELEASE"
        reason = f"{critical_bugs} critical bug(s) still open"
    elif high_bugs > 0:
        overall_result = "CONDITIONAL_PASS"
        recommendation = "CONDITIONAL_RELEASE"
        reason = f"{high_bugs} high severity bug(s) open - review required"
    elif pass_rate >= 95:
        overall_result = "PASSED"
        recommendation = "APPROVE_RELEASE"
        reason = f"All critical tests passed ({pass_rate:.1f}% pass rate)"
    elif pass_rate >= 80:
        overall_result = "CONDITIONAL_PASS"
        recommendation = "CONDITIONAL_RELEASE"
        reason = f"Acceptable pass rate ({pass_rate:.1f}%) with no critical issues"
    else:
        overall_result = "FAILED"
        recommendation = "BLOCK_RELEASE"
        reason = f"Low pass rate ({pass_rate:.1f}%)"

    report = {
        "ticket_id": ticket_id,
        "title": ticket["title"],
        "pr_url": ticket["pr_url"],
        "author": ticket["author"],
        "assignee": ticket.get("assignee", ""),
        "created_at": ticket["created_at"],
        "completed_at": datetime.utcnow().isoformat(),

        "summary": {
            "overall_result": overall_result,
            "recommendation": recommendation,
            "reason": reason,
        },

        "test_coverage": {
            "total_cases": total_cases,
            "executed": len(results),
            "passed": passed,
            "failed": failed,
            "blocked": sum(1 for r in results if r["result"] == "BLOCKED"),
            "skipped": sum(1 for r in results if r["result"] == "SKIPPED"),
            "not_executed": not_executed,
            "pass_rate": f"{pass_rate:.1f}%",
        },

        "bug_summary": {
            "total_bugs": len(bugs),
            "open_bugs": sum(1 for b in bugs if b.get("status") == "open"),
            "resolved_bugs": sum(1 for b in bugs if b.get("status") == "resolved"),
            "by_severity": {
                "CRITICAL": critical_bugs,
                "HIGH": high_bugs,
                "MEDIUM": sum(1 for b in bugs if b.get("severity") == "MEDIUM"),
                "LOW": sum(1 for b in bugs if b.get("severity") == "LOW"),
            },
        },

        "test_results": results,
        "bugs": bugs,
        "risk_assessment": ticket.get("risk_points", []),
        "notes": ticket.get("notes", ""),
    }

    return json.dumps(report, indent=2)


@mcp.tool()
def get_ticket(ticket_id: str) -> str:
    """
    Get full details of a test ticket.

    Args:
        ticket_id: The test ticket identifier

    Returns:
        JSON string with complete ticket details
    """
    logger.info(f"get_ticket called for: {ticket_id}")

    if ticket_id not in _tickets:
        return json.dumps({
            "success": False,
            "error": f"Ticket {ticket_id} not found",
        })

    ticket = _tickets[ticket_id].copy()
    ticket["test_results"] = _test_results.get(ticket_id, [])
    ticket["bugs"] = _bugs.get(ticket_id, [])

    return json.dumps(ticket, indent=2)


@mcp.tool()
def list_tickets(status: str = "") -> str:
    """
    List all test tickets, optionally filtered by status.

    Args:
        status: Optional status filter (open, assigned, in_progress, resolved, closed)
                Leave empty to list all tickets

    Returns:
        JSON string with list of tickets
    """
    logger.info(f"list_tickets called, status filter: {status or 'all'}")

    tickets = list(_tickets.values())

    if status:
        tickets = [t for t in tickets if t.get("status") == status]

    # Return summary view
    summary = [
        {
            "ticket_id": t["ticket_id"],
            "title": t["title"],
            "status": t["status"],
            "assignee": t.get("assignee", ""),
            "priority": t.get("priority", "NORMAL"),
            "total_test_cases": t["total_test_cases"],
            "passed": t["passed_test_cases"],
            "failed": t["failed_test_cases"],
            "bugs": len(_bugs.get(t["ticket_id"], [])),
            "created_at": t["created_at"],
        }
        for t in tickets
    ]

    return json.dumps({
        "tickets": summary,
        "total": len(summary),
        "filter": status or "all",
    }, indent=2)


@mcp.tool()
def close_bug(ticket_id: str, bug_id: str, resolution: str = "fixed") -> str:
    """
    Mark a bug as resolved/closed.

    Args:
        ticket_id: The test ticket identifier
        bug_id: The bug identifier (e.g., BUG-ABC123)
        resolution: Resolution type: fixed, wont_fix, duplicate, not_a_bug

    Returns:
        JSON string confirming the bug was closed
    """
    logger.info(f"close_bug called: {ticket_id}/{bug_id}")

    if ticket_id not in _bugs:
        return json.dumps({"success": False, "error": f"Ticket {ticket_id} not found"})

    bug_list = _bugs[ticket_id]
    bug = next((b for b in bug_list if b["bug_id"] == bug_id), None)

    if not bug:
        return json.dumps({"success": False, "error": f"Bug {bug_id} not found"})

    bug["status"] = "resolved"
    bug["resolution"] = resolution
    bug["resolved_at"] = datetime.utcnow().isoformat()

    return json.dumps({
        "success": True,
        "bug_id": bug_id,
        "resolution": resolution,
        "resolved_at": bug["resolved_at"],
    }, indent=2)


# Entry point for running as standalone MCP server
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("Starting Test Management MCP server...")
    mcp.run()
