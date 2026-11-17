"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the page from the server every few seconds (workshop board, wall screen). */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), Math.max(5, seconds) * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
