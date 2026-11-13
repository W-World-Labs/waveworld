import type { Metadata } from "next";
import { connection } from "next/server";
import Script from "next/script";
import { Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/components/providers/query-provider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Web Wind Tunnel Lab - 风洞实验室",
  description: "基于 WebGPU 的交互式计算流体力学风洞实验室",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Next applies this request's CSP nonce to its own startup scripts.
  await connection();
  return (
    <html lang="zh-CN" className="dark">
      <body className={inter.className}>
        {process.env.WAVEWORLD_E2E !== "1" && (
          <Script
            async
            src="https://radar.myfastools.com/platform/bootstrap.js?v=1.4.86&release=b0a81fc548ac"
            data-client-kind="waveworld-lab"
            data-workspace-id="ws_platform"
            data-project-id="waveworld"
            data-code="W-WAVEWORLD-76B94EFF"
            data-track-behavior="true"
            data-error-capture="true"
            data-track-performance="true"
            strategy="afterInteractive"
          />
        )}
        <QueryProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
