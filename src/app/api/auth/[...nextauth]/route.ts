import NextAuth from "next-auth";
import { authOptions } from "@/auth";
import { createTimedAuthHandler } from "@/lib/auth-route-timing";

const handler = createTimedAuthHandler(NextAuth(authOptions));

export { handler as GET, handler as POST };
