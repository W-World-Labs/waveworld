import type { ReactNode } from 'react';
import { connection } from 'next/server';
import Script from 'next/script';

export const metadata = {
  title: 'WaveWorld Host · L0–L3 entry',
  description:
    'Host control plane: L0 teaching · L1 windtunnel · L2 engineering Lab gateway · L3 batch jobs. Lab remains a preview — not a full-usability claim.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Nonces must be rendered per request, never baked into cached HTML.
  await connection();
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: 24 }}>
        <Script
            async
            src="https://radar.myfastools.com/platform/bootstrap.js?v=1.4.86&release=b0a81fc548ac"
            data-client-kind="waveworld-host"
            data-workspace-id="ws_platform"
            data-project-id="waveworld"
            data-code="W-WAVEWORLD-76B94EFF"
            data-track-behavior="true"
            data-error-capture="true"
            data-track-performance="true"
            strategy="afterInteractive"
        />
        {children}
      </body>
    </html>
  );
}
