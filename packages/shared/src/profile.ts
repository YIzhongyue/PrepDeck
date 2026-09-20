// DTOs for the User Profile API (docs/requirements/authentication-and-users.md), shared between the Worker's
// responses and the web client's fetch calls.

import type { Role } from "./types";

export interface UserProfile {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface UpdateProfileRequest {
  displayName: string;
}

export interface ProfileResponse {
  user: UserProfile;
}

export interface AvatarUploadResponse {
  avatarUrl: string;
}
