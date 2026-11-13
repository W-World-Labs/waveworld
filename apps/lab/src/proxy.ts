import { NextResponse, type NextRequest } from "next/server";
import {
  CONTENT_SECURITY_POLICY,
  documentRequestHeaders,
} from "../../host/src/lib/security-headers";

export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const res = NextResponse.next();
    res.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    // API JSON is request-specific. Document routes already set no-store;
    // without this, /api/* leaves the edge with no Cache-Control at all.
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
  const headers = documentRequestHeaders(
    req.headers,
    process.env.NODE_ENV === "development",
    process.env.WAVEWORLD_LAB_FRAME_ANCESTOR,
  );
  // Draco runs WASM in a worker; GLTFLoader fetches embedded images as blob URLs.
  // Keep these capabilities local to Lab documents, including their nonce policy.
  headers.set(
    "Content-Security-Policy",
    headers.get("Content-Security-Policy")!
      .replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'")
      .replace("connect-src 'self'", "connect-src 'self' blob:"),
  );
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", headers.get("Content-Security-Policy")!);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|models/|draco/|favicon.ico).*)",
};
