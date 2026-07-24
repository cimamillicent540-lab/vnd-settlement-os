import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { normalizeSupabaseUrl } from "./supabase-url";

export type InternalRole =
  | "admin"
  | "settlement_operator"
  | "approver"
  | "viewer";

export interface AuthorizedRequest {
  db: SupabaseClient;
  userId: string;
  roles: InternalRole[];
}

export async function authorizeInternalRequest(
  request: Request,
  allowedRoles: InternalRole[],
): Promise<AuthorizedRequest | null> {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization");
  if (!url || !key || !authorization) return null;

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const {
    data: { user },
    error: userError,
  } = await db.auth.getUser();
  if (userError || !user) return null;

  const { data: roleRows, error: roleError } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  if (roleError) return null;
  const roles = (roleRows ?? []).map((row) => row.role as InternalRole);
  if (!roles.some((role) => allowedRoles.includes(role))) return null;

  return { db, userId: user.id, roles };
}
