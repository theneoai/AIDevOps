"""
Code Analysis Skill - Analyzes PR diffs to understand change scope and risk.

Uses Claude to intelligently analyze code diffs and produce structured
ChangeAnalysis results that inform test planning and risk assessment.
"""

import json
import logging
from enum import Enum
from typing import Any, Dict, List, Optional

import anthropic
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class RiskLevel(str, Enum):
    """Risk level assessment for code changes."""
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class ChangeAnalysis(BaseModel):
    """
    Structured analysis of code changes in a PR.

    Produced by CodeAnalysisSkill.analyze_pr_diff().
    """
    changed_files: List[str] = Field(
        default_factory=list,
        description="List of changed file paths",
    )
    risk_level: RiskLevel = Field(
        default=RiskLevel.MEDIUM,
        description="Overall risk level of the changes",
    )
    risk_reasons: List[str] = Field(
        default_factory=list,
        description="Reasons for the risk level assessment",
    )
    test_scope: List[str] = Field(
        default_factory=list,
        description="Areas that need to be tested",
    )
    key_changes_summary: str = Field(
        default="",
        description="Brief human-readable summary of key changes",
    )
    implementation_notes: str = Field(
        default="",
        description="Technical notes for QA about the implementation",
    )
    regression_areas: List[str] = Field(
        default_factory=list,
        description="Areas that might regress due to these changes",
    )
    affected_components: List[str] = Field(
        default_factory=list,
        description="Software components affected by the changes",
    )
    has_database_changes: bool = Field(
        default=False,
        description="Whether the changes include database schema/migration changes",
    )
    has_api_changes: bool = Field(
        default=False,
        description="Whether the changes include API interface changes",
    )
    has_security_implications: bool = Field(
        default=False,
        description="Whether the changes have security implications",
    )
    lines_added: int = Field(default=0, description="Number of lines added")
    lines_removed: int = Field(default=0, description="Number of lines removed")


class CodeAnalysisSkill:
    """
    Skill for analyzing code changes in pull requests.

    Uses Claude to intelligently analyze diffs and produce structured
    ChangeAnalysis results. Can work with raw diff text or PR metadata.
    """

    def __init__(self, model: str = "claude-sonnet-4-6"):
        self._client = anthropic.Anthropic()
        self._model = model

    async def analyze_pr_diff(
        self,
        diff_text: str,
        pr_title: str = "",
        pr_description: str = "",
        additional_context: Optional[Dict[str, Any]] = None,
    ) -> ChangeAnalysis:
        """
        Analyze a PR diff to produce a structured ChangeAnalysis.

        Args:
            diff_text: The raw git diff text from the PR
            pr_title: PR title for context
            pr_description: PR description for context
            additional_context: Any additional context to consider

        Returns:
            ChangeAnalysis dataclass with structured analysis results
        """
        # Count lines added/removed from diff
        lines_added = sum(
            1 for line in diff_text.split("\n")
            if line.startswith("+") and not line.startswith("+++")
        )
        lines_removed = sum(
            1 for line in diff_text.split("\n")
            if line.startswith("-") and not line.startswith("---")
        )

        # Truncate diff if too long (keep first 8000 chars)
        truncated_diff = diff_text[:8000]
        if len(diff_text) > 8000:
            truncated_diff += "\n... [diff truncated for brevity] ..."

        context_str = ""
        if additional_context:
            context_str = f"\n\nAdditional context:\n{json.dumps(additional_context, indent=2)}"

        prompt = f"""Analyze the following pull request diff and provide a structured analysis.

PR Title: {pr_title or 'Not provided'}
PR Description: {pr_description or 'Not provided'}
{context_str}

Diff:
```diff
{truncated_diff}
```

Provide a comprehensive analysis in the following JSON format (respond ONLY with valid JSON, no other text):
{{
  "changed_files": ["list of file paths that were changed"],
  "risk_level": "LOW|MEDIUM|HIGH",
  "risk_reasons": ["reason 1", "reason 2"],
  "test_scope": ["area to test 1", "area to test 2"],
  "key_changes_summary": "2-3 sentence summary of the key changes",
  "implementation_notes": "technical notes for QA testers",
  "regression_areas": ["area that might regress 1"],
  "affected_components": ["component 1", "component 2"],
  "has_database_changes": false,
  "has_api_changes": false,
  "has_security_implications": false
}}

Risk level guidelines:
- LOW: Minor UI/documentation changes, small bug fixes with limited scope
- MEDIUM: Feature additions, moderate business logic changes
- HIGH: Core business logic, authentication/security, database schema, API contracts, payment processing"""

        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )

            # Extract text from response
            content = ""
            for block in response.content:
                if hasattr(block, "type") and block.type == "text":
                    content += block.text

            # Parse JSON response
            # Strip markdown code blocks if present
            content = content.strip()
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

            analysis_data = json.loads(content)
            analysis_data["lines_added"] = lines_added
            analysis_data["lines_removed"] = lines_removed

            return ChangeAnalysis(**analysis_data)

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse analysis JSON: {e}")
            # Return a default analysis on parse failure
            return self._default_analysis(diff_text, lines_added, lines_removed)
        except Exception as e:
            logger.error(f"Code analysis failed: {e}")
            return self._default_analysis(diff_text, lines_added, lines_removed)

    async def analyze_file_changes(
        self,
        changed_files: List[str],
        context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Analyze a list of changed files to understand scope and categorize changes.

        Args:
            changed_files: List of changed file paths
            context: Optional context about the changes

        Returns:
            Dictionary with file change categorization
        """
        files_str = "\n".join(f"  - {f}" for f in changed_files)
        prompt = f"""Given the following list of changed files in a PR, analyze and categorize the changes:

Changed files:
{files_str}

{f'Context: {context}' if context else ''}

Respond in JSON format:
{{
  "categories": {{
    "frontend": ["file paths"],
    "backend": ["file paths"],
    "database": ["file paths"],
    "tests": ["file paths"],
    "config": ["file paths"],
    "docs": ["file paths"],
    "other": ["file paths"]
  }},
  "primary_change_area": "frontend|backend|database|fullstack|devops",
  "complexity_estimate": "SIMPLE|MODERATE|COMPLEX",
  "requires_db_migration": false,
  "requires_config_update": false,
  "test_files_included": false,
  "summary": "brief summary of what changed"
}}"""

        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )

            content = ""
            for block in response.content:
                if hasattr(block, "type") and block.type == "text":
                    content += block.text

            content = content.strip()
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

            return json.loads(content)

        except Exception as e:
            logger.error(f"File analysis failed: {e}")
            return {
                "categories": {"other": changed_files},
                "primary_change_area": "unknown",
                "complexity_estimate": "MODERATE",
                "requires_db_migration": False,
                "requires_config_update": False,
                "test_files_included": False,
                "summary": f"Analysis of {len(changed_files)} changed files",
            }

    def _default_analysis(
        self,
        diff_text: str,
        lines_added: int,
        lines_removed: int,
    ) -> ChangeAnalysis:
        """Return a conservative default analysis when AI analysis fails."""
        # Try to extract file names from diff headers
        changed_files = []
        for line in diff_text.split("\n"):
            if line.startswith("diff --git"):
                parts = line.split(" b/")
                if len(parts) > 1:
                    changed_files.append(parts[1].strip())

        return ChangeAnalysis(
            changed_files=changed_files or ["unknown"],
            risk_level=RiskLevel.MEDIUM,
            risk_reasons=["Unable to perform automated analysis; manual review recommended"],
            test_scope=["Full regression testing recommended"],
            key_changes_summary=f"Changes across {len(changed_files)} files "
                                f"({lines_added} additions, {lines_removed} deletions)",
            implementation_notes="Automated analysis unavailable; please review diff manually",
            regression_areas=["All affected modules"],
            affected_components=["Unknown - manual review required"],
            lines_added=lines_added,
            lines_removed=lines_removed,
        )
