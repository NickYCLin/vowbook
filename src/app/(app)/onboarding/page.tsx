import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CreateWorkspaceForm } from "@/components/workspaces/create-workspace-form";
import { requireCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "建立婚宴工作區",
};

export default async function OnboardingPage() {
  const currentUser = await requireCurrentUser();
  const membershipCount = await prisma.membership.count({
    where: { userId: currentUser.id },
  });

  if (membershipCount > 0) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      <div className="grid gap-10 md:grid-cols-[0.8fr_1.2fr] md:gap-16">
        <div>
          <p className="text-sm font-semibold tracking-[0.16em] text-clay">
            第一步
          </p>
          <h1 className="mt-3 font-serif text-4xl leading-tight font-semibold text-ink">
            為你們的婚宴，留下一頁。
          </h1>
          <p className="mt-5 leading-8 text-ink-soft">
            工作區會成為婚宴資料的安全邊界。建立後，你會以擁有者身分加入，再從這裡邀請共同籌備的人。
          </p>
        </div>
        <section className="border-y border-line bg-surface/80 px-1 py-8 sm:px-8">
          <h2 className="font-serif text-2xl font-semibold">建立婚宴工作區</h2>
          <CreateWorkspaceForm />
        </section>
      </div>
    </main>
  );
}
