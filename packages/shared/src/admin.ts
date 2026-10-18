// DTOs for the Admin Console (docs/requirements/question-bank-management.md): Authorized Users management
// (FR-1.2/FR-1.4, surfaced under /admin/users) and the usage overview panel
// (FR-13.4, surfaced under /admin/overview). Admin-only on the Worker side.

import type { User } from "./types";
import type { z } from "zod";
import type { inviteUserRequestSchema, updateUserRequestSchema } from "./admin.schema.ts";

export interface AdminUsersListResponse {
  users: User[];
}

export type InviteUserRequest = z.input<typeof inviteUserRequestSchema>;

export interface InviteUserResponse {
  user: User;
}

export type UpdateUserRequest = z.input<typeof updateUserRequestSchema>;

export interface UpdateUserResponse {
  user: User;
}

export interface AdminOverviewResponse {
  users: { invited: number; active: number; revoked: number; total: number };
  exams: { total: number; archived: number };
  questions: { total: number; byExam: { examId: string; examName: string; questionCount: number }[] };
  attempts: { total: number };
}
