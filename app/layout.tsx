import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Leonida Field Guide — GTA VI Fan Channel",
    template: "%s · Leonida Field Guide",
  },
  description:
    "Official evidence. Practical guides. Real experiments. Zero fake leaks. An independent GTA VI fan publication.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
