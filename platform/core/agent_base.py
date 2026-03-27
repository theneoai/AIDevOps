"""
Base Agent - Abstract base class for all AI agents in the workflow platform.

Each agent is a Claude-powered entity with its own system prompt and MCP
tool access, capable of performing complex tasks using tool calls.
"""

import asyncio
import json
import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Sequence

import anthropic

from .context import WorkflowContext

logger = logging.getLogger(__name__)

# Maximum number of tool call rounds before giving up
MAX_TOOL_ROUNDS = 10


class AgentResult:
    """Result from an agent task execution."""

    def __init__(
        self,
        success: bool,
        output: str,
        data: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
    ):
        self.success = success
        self.output = output
        self.data = data or {}
        self.error = error

    def __repr__(self) -> str:
        status = "SUCCESS" if self.success else "FAILED"
        return f"AgentResult({status}, output={self.output[:80]!r})"


class BaseAgent(ABC):
    """
    Abstract base class for all workflow agents.

    Subclasses define:
      - role: agent identifier string
      - system_prompt: the Claude system prompt for this agent
      - mcp_server_names: list of MCP server names this agent connects to

    The execute() method handles the full Claude conversation loop including
    tool_use blocks, calling MCP tools, and returning the final result.
    """

    def __init__(
        self,
        role: str,
        system_prompt: str,
        mcp_server_configs: Optional[List[Dict[str, Any]]] = None,
    ):
        """
        Initialize the agent.

        Args:
            role: Agent role identifier (e.g., "dev_agent", "qa_agent")
            system_prompt: Claude system prompt for this agent
            mcp_server_configs: List of MCP server config dicts with keys:
                - name: server name
                - command: executable command (e.g., "python")
                - args: list of args (e.g., ["server.py"])
                - env: optional env vars dict
        """
        self.role = role
        self.system_prompt = system_prompt
        self.mcp_server_configs = mcp_server_configs or []
        self._client = anthropic.Anthropic()
        self._model = "claude-sonnet-4-6"
        logger.debug(f"Initialized {role} agent")

    async def execute(
        self,
        task: str,
        context: Optional[WorkflowContext] = None,
        extra_context: Optional[Dict[str, Any]] = None,
    ) -> AgentResult:
        """
        Execute a task using Claude with MCP tool access.

        Runs the full agentic loop:
        1. Send task to Claude with available tools
        2. Execute any tool_use blocks via MCP
        3. Send tool results back to Claude
        4. Repeat until Claude returns a text response

        Args:
            task: The task description / user message
            context: Shared workflow context
            extra_context: Additional context data to include in the prompt

        Returns:
            AgentResult with the final response
        """
        ctx = context or WorkflowContext()

        # Build the initial user message
        user_message = task
        if extra_context:
            ctx_str = json.dumps(extra_context, indent=2, default=str)
            user_message = f"{task}\n\n<context>\n{ctx_str}\n</context>"

        messages: List[Dict[str, Any]] = [
            {"role": "user", "content": user_message}
        ]

        await ctx.add_agent_note(self.role, f"Starting task: {task[:120]}")

        # Use MCP client context manager if we have servers configured
        if self.mcp_server_configs:
            return await self._execute_with_mcp(messages, ctx)
        else:
            return await self._execute_without_mcp(messages, ctx)

    async def _execute_without_mcp(
        self,
        messages: List[Dict[str, Any]],
        ctx: WorkflowContext,
    ) -> AgentResult:
        """Execute task using Claude without MCP tools."""
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=4096,
                system=self.system_prompt,
                messages=messages,
            )

            output = self._extract_text(response.content)
            await ctx.add_agent_note(self.role, f"Completed: {output[:120]}")
            return AgentResult(success=True, output=output)

        except Exception as e:
            logger.error(f"{self.role} execute error: {e}")
            return AgentResult(success=False, output="", error=str(e))

    async def _execute_with_mcp(
        self,
        messages: List[Dict[str, Any]],
        ctx: WorkflowContext,
    ) -> AgentResult:
        """Execute task using Claude with MCP tools via subprocess transport."""
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        # Collect tools from all MCP servers
        all_tools: List[Dict[str, Any]] = []
        server_sessions: Dict[str, Any] = {}

        # We'll run with the first available MCP server for simplicity
        # In production, you'd multiplex across all servers
        if not self.mcp_server_configs:
            return await self._execute_without_mcp(messages, ctx)

        # Use the first server config
        server_cfg = self.mcp_server_configs[0]
        server_params = StdioServerParameters(
            command=server_cfg.get("command", "python"),
            args=server_cfg.get("args", []),
            env=server_cfg.get("env"),
        )

        try:
            async with stdio_client(server_params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()

                    # Get available tools from this MCP server
                    tools_result = await session.list_tools()
                    mcp_tools = tools_result.tools

                    # Convert MCP tools to Anthropic tool format
                    anthropic_tools = [
                        {
                            "name": tool.name,
                            "description": tool.description or "",
                            "input_schema": tool.inputSchema,
                        }
                        for tool in mcp_tools
                    ]

                    # Run the agentic loop
                    result = await self._run_agent_loop(
                        messages=messages,
                        tools=anthropic_tools,
                        mcp_session=session,
                        ctx=ctx,
                    )
                    return result

        except Exception as e:
            logger.warning(
                f"{self.role}: MCP connection failed ({e}), "
                "falling back to no-tools execution"
            )
            return await self._execute_without_mcp(messages, ctx)

    async def _run_agent_loop(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        mcp_session: Any,
        ctx: WorkflowContext,
    ) -> AgentResult:
        """
        Core agentic loop: call Claude, execute tools, repeat.
        """
        current_messages = list(messages)
        rounds = 0

        while rounds < MAX_TOOL_ROUNDS:
            rounds += 1
            logger.debug(f"{self.role}: Agent loop round {rounds}")

            # Call Claude
            response = self._client.messages.create(
                model=self._model,
                max_tokens=4096,
                system=self.system_prompt,
                messages=current_messages,
                tools=tools if tools else anthropic.NOT_GIVEN,
            )

            # Check stop reason
            if response.stop_reason == "end_turn":
                # Claude is done - extract final text
                output = self._extract_text(response.content)
                await ctx.add_agent_note(
                    self.role, f"Task complete: {output[:120]}"
                )
                return AgentResult(success=True, output=output)

            if response.stop_reason != "tool_use":
                # Unexpected stop reason
                output = self._extract_text(response.content)
                return AgentResult(success=True, output=output)

            # Process tool use blocks
            tool_results = []
            assistant_content = []

            for block in response.content:
                assistant_content.append(block)

                if block.type == "tool_use":
                    tool_name = block.name
                    tool_input = block.input
                    tool_use_id = block.id

                    logger.info(
                        f"{self.role}: Calling tool '{tool_name}' "
                        f"with input: {json.dumps(tool_input)[:200]}"
                    )

                    # Call the tool via MCP
                    try:
                        tool_response = await mcp_session.call_tool(
                            tool_name, tool_input
                        )
                        tool_result_content = self._extract_tool_content(
                            tool_response
                        )
                        is_error = False
                        logger.debug(
                            f"{self.role}: Tool '{tool_name}' result: "
                            f"{tool_result_content[:200]}"
                        )
                    except Exception as e:
                        tool_result_content = f"Tool error: {str(e)}"
                        is_error = True
                        logger.error(
                            f"{self.role}: Tool '{tool_name}' error: {e}"
                        )

                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": tool_result_content,
                            "is_error": is_error,
                        }
                    )

            # Add assistant message with tool use blocks
            current_messages.append(
                {"role": "assistant", "content": assistant_content}
            )

            # Add tool results
            if tool_results:
                current_messages.append(
                    {"role": "user", "content": tool_results}
                )

        # Exceeded max rounds
        logger.warning(f"{self.role}: Exceeded max tool rounds ({MAX_TOOL_ROUNDS})")
        return AgentResult(
            success=False,
            output="Exceeded maximum tool call rounds",
            error="max_rounds_exceeded",
        )

    def _extract_text(self, content: List[Any]) -> str:
        """Extract text from Claude response content blocks."""
        texts = []
        for block in content:
            if hasattr(block, "type") and block.type == "text":
                texts.append(block.text)
            elif isinstance(block, dict) and block.get("type") == "text":
                texts.append(block.get("text", ""))
        return "\n".join(texts).strip()

    def _extract_tool_content(self, tool_response: Any) -> str:
        """Extract string content from MCP tool response."""
        if hasattr(tool_response, "content"):
            content = tool_response.content
            if isinstance(content, list):
                parts = []
                for item in content:
                    if hasattr(item, "text"):
                        parts.append(item.text)
                    elif isinstance(item, dict) and "text" in item:
                        parts.append(item["text"])
                    else:
                        parts.append(str(item))
                return "\n".join(parts)
            elif isinstance(content, str):
                return content
        return str(tool_response)

    @abstractmethod
    def get_capabilities(self) -> List[str]:
        """Return list of capability descriptions for this agent."""
        ...
