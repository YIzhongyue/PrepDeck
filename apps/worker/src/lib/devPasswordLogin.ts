import type { Env } from "../bindings";

type DevPasswordLoginConfig = Pick<Env, "ENVIRONMENT" | "ENABLE_DEV_PASSWORD_LOGIN">;

/** Fail closed unless both trusted deployment bindings explicitly opt in. */
export function isDevPasswordLoginEnabled(env: Partial<DevPasswordLoginConfig>): boolean {
  return env.ENVIRONMENT === "development" && env.ENABLE_DEV_PASSWORD_LOGIN === "true";
}
