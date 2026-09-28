"use server";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/current-user";
import { callbackURL, validateAuthorization } from "@/lib/mobile/protocol";
import { issueLoginGrant } from "@/lib/mobile/session";

export async function authorizeMobile(form: FormData) {
  const { challenge, state } = validateAuthorization(form.get("challenge"), form.get("state"));
  // Next.js Server Actions enforce POST and same-origin validation.
  const user = await requireCurrentUser();
  let code: string;
  try { code = await issueLoginGrant(user.id, challenge); }
  catch { redirect(`vowbook://oauth/callback?${new URLSearchParams({ error: "unavailable", state })}`); }
  redirect(callbackURL(code, state));
}
