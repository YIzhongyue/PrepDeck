// Request body for creating an MCP token (POST /api/mcp-tokens and
// /api/admin/mcp-tokens). See mcp.ts.

import { z } from "zod";
import { MCP_TOKEN_MAX_EXPIRES_IN_DAYS, MCP_TOKEN_NAME_MAX_LENGTH } from "./mcp.ts";

const NAME = `name is required (1-${MCP_TOKEN_NAME_MAX_LENGTH} characters)`;
const EXPIRES = `expiresInDays must be an integer between 1 and ${MCP_TOKEN_MAX_EXPIRES_IN_DAYS}`;

export const createMcpCredentialRequestSchema = z.object({
  // Stored trimmed.
  name: z.string(NAME).trim().min(1, NAME).max(MCP_TOKEN_NAME_MAX_LENGTH, NAME),
  // Days from now until expiry. Omit (or send null) for the finite server default.
  expiresInDays: z.int(EXPIRES).min(1, EXPIRES).max(MCP_TOKEN_MAX_EXPIRES_IN_DAYS, EXPIRES).nullish(),
}, "Invalid JSON body");
