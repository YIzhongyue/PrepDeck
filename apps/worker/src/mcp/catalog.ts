import { Server, ProtocolError, type CallToolResult, type Tool } from "@modelcontextprotocol/server";
import { z } from "zod";
import { errorEnvelope, McpApplicationError } from "./errors";
import { toolResult } from "./conventions";
import type { McpObservation } from "./observability";

export interface McpTool {
  readonly definition: Tool;
  invoke(input: unknown): Promise<CallToolResult>;
}

/** Strict schemas and fixed errors prevent caller-supplied keys/values or
 * service exception messages from being echoed in validation errors.
 */
export function defineMcpTool<S extends z.ZodRawShape, R>(
  name: string,
  description: string,
  schema: z.ZodObject<S>,
  operation: (input: z.infer<typeof schema>) => R | Promise<R>,
  formatResult: (data: R) => CallToolResult = (data) => toolResult({ ok: true, data }),
): McpTool {
  const strictSchema = schema.strict();
  return {
    definition: {
      name, description,
      inputSchema: z.toJSONSchema(strictSchema) as Tool["inputSchema"],
    },
    async invoke(input) {
      try {
        const parsed = strictSchema.safeParse(input ?? {});
        if (!parsed.success) throw new McpApplicationError("invalid_input");
        return formatResult(await operation(parsed.data));
      } catch (error) {
        return toolResult(errorEnvelope(error), true);
      }
    },
  };
}

export function createCatalogServer(name: string, tools: readonly McpTool[], observation?: McpObservation, instructions?: string) {
  const server = new Server({ name, version: "0.1.0" }, { capabilities: { tools: {} }, instructions });
  server.setRequestHandler("tools/list", async (request) => {
    if (request.params?.cursor) throw new ProtocolError(-32602, "Invalid request input.");
    return { tools: tools.map((tool) => tool.definition) };
  });
  server.setRequestHandler("tools/call", async (request) => {
    const start = performance.now();
    const tool = tools.find((candidate) => candidate.definition.name === request.params.name);
    try {
      const result = tool ? await tool.invoke(request.params.arguments)
        : toolResult(errorEnvelope(new McpApplicationError("not_found")), true);
      observation?.tool(tool?.definition.name, result, start);
      return result;
    } catch (error) {
      observation?.tool(tool?.definition.name, toolResult(errorEnvelope(error), true), start);
      throw error;
    }
  });
  return server;
}
