import { useState } from "react";
import type { McpOAuthGrantSummary } from "@prepdeck/shared";
import { mcpAppInitial, mcpAppLogo } from "../lib/mcpAppLogo";

export default function McpAppIcon({ grant }: { grant: McpOAuthGrantSummary }) {
  const src = mcpAppLogo(grant);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showLogo = src !== null && src !== failedSrc;
  return (
    <span className={`mcp-token-icon${showLogo ? " mcp-app-logo" : ""}`} aria-hidden="true">
      {showLogo
        ? <img src={src} width={24} height={24} alt="" onError={() => setFailedSrc(src)} />
        : mcpAppInitial(grant.clientName)}
    </span>
  );
}
