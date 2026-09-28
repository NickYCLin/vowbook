export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installResilientDns } = await import("@/lib/resilient-dns");
  installResilientDns();
  console.log("resilient_dns ready");
}
