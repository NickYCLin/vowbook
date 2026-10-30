import { validateLinkNonce } from "@/lib/mobile/account-links";
import { GoogleLinkButton } from "./link-button";

export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" as const };

export default async function GoogleLinkPage({ searchParams }: { searchParams: Promise<{ nonce?: string | string[] }> }) {
  const { nonce } = await searchParams;
  try { validateLinkNonce(nonce); }
  catch { return <main className="p-8"><h1>無效的帳號連結要求</h1><p>請關閉視窗並從 App 設定重新開始。</p></main>; }
  return <main className="mx-auto max-w-lg p-8">
    <h1 className="text-2xl">連結 Google 登入</h1>
    <p className="mt-5">只有你剛才從誓約簿 App 設定開始連結時，才請繼續。若是別人傳來的網址，請直接關閉。</p>
    <p className="mt-3">完成 Google 驗證後，仍需回到 App 確認。這不會建立新帳號，也不會合併其他帳號的婚宴。</p>
    <GoogleLinkButton nonce={nonce} />
  </main>;
}
