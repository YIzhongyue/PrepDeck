// DTOs for the Admin Console (docs/requirements/question-bank-management.md): Authorized Users management
// (FR-1.2/FR-1.4, surfaced under /admin/users) and the usage overview panel
// (FR-13.4, surfaced under /admin/overview). Admin-only on the Worker side.

import type { Role, User, UserStatus } from "./types";

export interface AdminUsersListResponse {
  users: User[];
}

export interface InviteUserRequest {
  email: string;
  role: Role;
  // Optional initial password, meaningful only while the Worker's
  // explicit development password-login bindings are enabled (see
  // apps/worker/src/routes/auth.ts) — lets an
  // invited account sign in locally before Cloudflare Access is wired up.
  // Ignored in production and whenever the fail-closed feature flag is off.
  password?: string;
}

export interface InviteUserResponse {
  user: User;
}

export interface UpdateUserRequest {
  role?: Role;
  status?: Extract<UserStatus, "active" | "revoked">;
}

export interface UpdateUserResponse {
  user: User;
}

export interface AdminOverviewResponse {
  users: { invited: number; active: number; revoked: number; total: number };
  exams: { total: number; archived: number };
  questions: { total: number; byExam: { examId: string; examName: string; questionCount: number }[] };
  attempts: { total: number };
}
