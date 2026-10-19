import type { McpOAuthGrantSummary } from "@prepdeck/shared";

// Presentation only, not identity verification. See public/app-logos/README.md.
// Match the complete published metadata-document ID AND its expected name;
// never infer a brand from a self-asserted display name or a URL substring.
const KNOWN_APPS = new Map([
  ["https://chatgpt.com/oauth/client.json", { name: "ChatGPT", logo: "/app-logos/openai.png" }],
  ["https://chatgpt.com/oauth/codex/client.json", { name: "Codex", logo: "/app-logos/openai.png" }],
  ["https://claude.ai/oauth/mcp-oauth-client-metadata", { name: "Claude", logo: "/app-logos/claude.svg" }],
  ["https://claude.ai/oauth/claude-code-client-metadata", { name: "Claude Code", logo: "/app-logos/claude.svg" }],
  ["https://vscode.dev/oauth/client-metadata.json", { name: "Visual Studio Code", logo: "/app-logos/vscode.png" }],
  ["https://insiders.vscode.dev/oauth/client-metadata.json", { name: "Visual Studio Code", logo: "/app-logos/vscode.png" }],
  ["https://github.com/copilot/cli/client-metadata.json", { name: "GitHub Copilot CLI", logo: "/app-logos/github-copilot.svg" }],
]);

export function mcpAppLogo(client: Pick<McpOAuthGrantSummary, "clientId" | "clientName" | "clientKind">): string | null {
  if (client.clientKind !== "metadata_document" || !client.clientName) return null;
  const app = KNOWN_APPS.get(client.clientId);
  return app?.name === client.clientName ? app.logo : null;
}

export function mcpAppInitial(name: string | null): string {
  return name?.trim().charAt(0).toUpperCase() || "?";
}
