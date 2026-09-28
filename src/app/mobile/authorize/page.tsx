import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { resolveCurrentUser, AuthenticationRequiredError } from "@/lib/current-user";
import { getSignInPath } from "@/lib/base-path";
import { validateAuthorization } from "@/lib/mobile/protocol";
import { authorizeMobile } from "./actions";

export const dynamic = "force-dynamic";
export default async function MobileAuthorizePage({ searchParams }: {
  searchParams: Promise<{ challenge?: string | string[]; state?: string | string[] }>;
}) {
  const params = await searchParams;
  let request: { challenge: string; state: string };
  try { request = validateAuthorization(params.challenge, params.state); }
  catch { return <main className="mx-auto max-w-lg p-8"><h1>無效的 App 登入要求</h1><p>請關閉此視窗，從誓約簿 App 重新登入。</p></main>; }
  let user;
  try { user = await resolveCurrentUser(await getServerSession(authOptions)); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect(getSignInPath(`/mobile/authorize?${new URLSearchParams(request)}`, { autoStart: true }));
    }
    return <main className="mx-auto max-w-lg p-8"><h1>目前無法登入</h1><p>請確認帳號狀態，或稍後從 App 重試。</p></main>;
  }
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <section className="w-full max-w-md rounded-3xl border border-line bg-surface p-8 text-center">
        <p className="text-sm tracking-widest text-clay">誓約簿 VowBook · iOS 測試版</p>
        <h1 className="my-5 text-3xl font-semibold text-ink">在 App 繼續準備婚宴</h1>
        <p className="break-words text-ink-soft">以 {user.email} 登入。App 將使用此帳號可存取的婚宴工作區。</p>
        <p className="my-5 text-sm text-ink-soft">只有你剛才從誓約簿 App 開始登入時，才請繼續。這次登入於 12 小時後到期。</p>
        <form action={authorizeMobile}>
          <input type="hidden" name="challenge" value={request.challenge} />
          <input type="hidden" name="state" value={request.state} />
          <button className="min-h-12 w-full rounded-xl bg-clay px-5 py-3 text-white" type="submit">確認並返回 App</button>
        </form>
        <p className="mt-5 text-sm text-ink-soft">若不繼續，請點選系統視窗的取消。</p>
      </section>
    </main>
  );
}
