"use client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
const client = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html><body><ConvexProvider client={client}>{children}</ConvexProvider></body></html>;
}
