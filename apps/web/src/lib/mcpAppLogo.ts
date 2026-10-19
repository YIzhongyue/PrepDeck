import type { McpOAuthGrantSummary } from "@prepdeck/shared";

// Presentation only, not identity verification. See public/app-logos/README.md.
// Match the complete published metadata-document ID AND its expected name;
// never infer a brand from a self-asserted display name or a URL substring.
const KNOWN_APPS = new Map([
  ["https://chatgpt.com/oauth/client.json", "ChatGPT"],
  ["https://chatgpt.com/oauth/codex/client.json", "Codex"],
]);

export function mcpAppLogo(client: Pick<McpOAuthGrantSummary, "clientId" | "clientName" | "clientKind">): string | null {
  if (client.clientKind !== "metadata_document" || !client.clientName) return null;
  return KNOWN_APPS.get(client.clientId) === client.clientName ? "/app-logos/openai.png" : null;
}

export function mcpAppInitial(name: string | null): string {
  return name?.trim().charAt(0).toUpperCase() || "?";
}
