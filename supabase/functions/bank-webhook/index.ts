// Supabase Edge Function: nhận webhook từ SePay → tự ghi nhận thanh toán + log.
// Đường dẫn file: memento-admin\supabase\functions\bank-webhook\index.ts  (GHI ĐÈ file cũ)
// Deploy:  supabase functions deploy bank-webhook --no-verify-jwt
// Secrets: WEBHOOK_API_KEY  = khoá bạn tự đặt, dán y hệt vào SePay (ô API Key)
//          EXPECTED_ACCOUNT = số VA SePay của bạn, vd 96247JEFYF (tuỳ chọn; nhiều số thì cách nhau dấu phẩy).
//                             BIDV trên SePay chỉ nhận qua VA nên KHÔNG đặt số tài khoản BIDV cũ ở đây.
//          SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY do Supabase cấp sẵn, KHÔNG cần tự đặt.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// So sánh chuỗi không lộ độ dài/vị trí khác biệt (chống dò khoá bằng thời gian phản hồi)
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ success: false, error: "method" }, 405);

  // SePay gửi:  Authorization: Apikey <KEY>
  const key = Deno.env.get("WEBHOOK_API_KEY");
  const auth = req.headers.get("authorization") ?? "";
  if (!key || !safeEqual(auth, `Apikey ${key}`)) {
    return json({ success: false, error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ success: false, error: "bad json" }, 400); }

  // Chỉ xử lý tiền VÀO
  if (body.transferType && body.transferType !== "in") return json({ success: true, skipped: "not incoming" });

  // Chỉ nhận tiền vào đúng tài khoản/VA của bạn. SePay có thể đặt số VA ở accountNumber hoặc
  // subAccount tuỳ ngân hàng, nên khớp 1 trong 2 là đủ.
  const expected = (Deno.env.get("EXPECTED_ACCOUNT") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const seen = [body.accountNumber, body.subAccount]
    .filter((v) => v != null && String(v) !== "")
    .map((v) => String(v));
  if (expected.length && seen.length && !seen.some((a) => expected.includes(a))) {
    console.warn("bank-webhook: bỏ qua giao dịch tài khoản khác", seen);
    return json({ success: true, skipped: "other account" });
  }

  const amount = Math.round(Number(body.transferAmount ?? 0));
  if (!Number.isFinite(amount) || amount <= 0) return json({ success: true, skipped: "no amount" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const content = String(body.content ?? body.description ?? "");
  const txId = body.id != null ? String(body.id) : (body.referenceCode ? String(body.referenceCode) : null);

  const { data, error } = await supabase.rpc("apply_bank_transaction", {
    p_provider: "sepay",
    p_tx_id: txId,
    p_amount: amount,
    p_content: content,
    p_raw: body,
  });

  if (error) {
    console.error("apply_bank_transaction", error);
    return json({ success: false, error: error.message }, 500); // SePay sẽ tự gửi lại
  }
  return json({ success: true, result: data });
});
