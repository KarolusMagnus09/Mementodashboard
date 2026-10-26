// Edge Function: send-push
// Được gọi bởi Database Webhook (INSERT trên bảng public.notifications) → gửi push FCM tới điện thoại của user.
// Deploy:  npx supabase functions deploy send-push --no-verify-jwt
// Secrets: FCM_SERVICE_ACCOUNT  (nội dung file JSON service account của Firebase, dán 1 dòng)
//          PUSH_WEBHOOK_SECRET  (chuỗi ngẫu nhiên, trùng với header trong Database Webhook)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY được Supabase tự cấp.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

function loadServiceAccount(): ServiceAccount | null {
  try {
    const sa = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "");
    if (sa?.project_id && sa?.client_email && sa?.private_key) return sa;
  } catch { /* ignore */ }
  return null;
}

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToBuffer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

let cachedToken: { value: string; exp: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const jwt = `${header}.${claim}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new Error(`oauth: ${res.status} ${JSON.stringify(json)}`);
  cachedToken = { value: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return cachedToken.value;
}

/** So khóa an toàn (thời gian không phụ thuộc nội dung) */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // Chỉ chấp nhận request từ Database Webhook có đúng khóa
  const given = req.headers.get("x-webhook-secret") ?? "";
  if (!WEBHOOK_SECRET || !safeEqual(given, WEBHOOK_SECRET)) {
    return new Response("unauthorized", { status: 401 });
  }

  const sa = loadServiceAccount();
  if (!sa) return new Response("FCM_SERVICE_ACCOUNT chưa cấu hình hoặc sai", { status: 500 });

  let payload: { type?: string; record?: Record<string, unknown> };
  try { payload = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  if (payload.type !== "INSERT" || !payload.record) return new Response("ignored", { status: 200 });

  const n = payload.record as {
    user_id: string; type: string; tab: string; title: string; body: string; booking_id: string | null;
  };

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: tokens, error } = await admin.from("device_tokens").select("token").eq("user_id", n.user_id);
  if (error) return new Response(`db: ${error.message}`, { status: 500 });
  if (!tokens?.length) return new Response("no devices", { status: 200 });

  let accessToken: string;
  try { accessToken = await getAccessToken(sa); }
  catch (e) { return new Response(`auth: ${(e as Error).message}`, { status: 500 }); }

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  let sent = 0;
  const dead: string[] = [];

  await Promise.all(tokens.map(async ({ token }) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: n.title, body: n.body },
          data: { tab: n.tab ?? "messages", type: n.type ?? "", booking_id: n.booking_id ?? "" },
          android: { priority: "HIGH", notification: { sound: "default" } },
        },
      }),
    });
    if (res.ok) { sent++; return; }
    const txt = await res.text();
    // Token hết hạn / app đã gỡ → xóa để khỏi gửi lại
    if (res.status === 404 || txt.includes("UNREGISTERED") || txt.includes("INVALID_ARGUMENT")) dead.push(token);
    else console.warn("fcm error", res.status, txt);
  }));

  if (dead.length) await admin.from("device_tokens").delete().in("token", dead);
  return new Response(JSON.stringify({ sent, removed: dead.length }), { headers: { "Content-Type": "application/json" } });
});
