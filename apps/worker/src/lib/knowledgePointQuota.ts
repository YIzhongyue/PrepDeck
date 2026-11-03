export function isKnowledgePointQuotaError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if (current.message.includes("kp_quota_exceeded") || current.message.includes("kp_image_quota_exceeded")) return true;
    current = current.cause;
  }
  return false;
}
