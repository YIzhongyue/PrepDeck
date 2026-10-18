// DTOs for the User Profile API (docs/requirements/authentication-and-users.md), shared between the Worker's
// responses and the web client's fetch calls.

import type { Role } from "./types";
import type { z } from "zod";
import type { updateProfileRequestSchema } from "./profile.schema.ts";

export interface UserProfile {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
  avatarUrl: string | null;
}

export const MAX_DISPLAY_NAME_LENGTH = 100;

export type UpdateProfileRequest = z.input<typeof updateProfileRequestSchema>;

export interface ProfileResponse {
  user: UserProfile;
}

export interface AvatarUploadResponse {
  avatarUrl: string;
}
