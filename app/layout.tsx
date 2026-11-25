import "./globals.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getStyle, modeFrom } from "@/lib/services/style";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getStyle();
  return { title: `${s.app_name} ${s.app_tagline}`.trim(), description: "Superfix garage ERP" };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = await getStyle();
  const mode = modeFrom((await cookies()).get("theme")?.value, s);
  const vars = { "--brand": s.brand_color, "--menu": s.menu_color, "--link-day": s.link_color } as React.CSSProperties;
  return (
    <html lang="en" data-theme={mode} data-size={s.text_size} data-density={s.density} style={vars} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
