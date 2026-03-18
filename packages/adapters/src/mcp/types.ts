/**
 * MCP adapter abstraction types.
 *
 * The concrete FastMCP registration lives in apps/mcp-server.
 * This interface ensures tools remain portable across MCP frameworks.
 */

export interface McpToolContext {
  requestId: string;
}

export interface McpTool<TInput, TOutput> {
  name: string;
  description: string;
  execute(input: TInput, context: McpToolContext): Promise<TOutput>;
}

export interface McpServerAdapter {
  registerTool<TInput, TOutput>(tool: McpTool<TInput, TOutput>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
