// Supabase Edge Function: nhận webhook từ SePay → tự ghi nhận thanh toán + log.
// Deploy:  supabase functions deploy bank-webhook --no-verify-jwt
// Secrets: supabase secrets set WEBHOOK_API_KEY=<khoá tự đặt, dán vào SePay>
//          (SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY được Supabase cấp sẵn)
//          tuỳ chọn: EXPECTED_ACCOUNT=7420808992  (chỉ nhận tiền vào đúng STK này)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ success: false, error: "method" }, 405);

  // SePay gửi:  Authorization: Apikey <KEY>
  const key = Deno.env.get("WEBHOOK_API_KEY");
  if (!key || req.headers.get("authorization") !== `Apikey ${key}`) {
    return json({ success: false, error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ success: false, error: "bad json" }, 400); }

  // Chỉ xử lý tiền VÀO
  if (body.transferType && body.transferType !== "in") return json({ success: true, skipped: "not incoming" });

  const expected = Deno.env.get("EXPECTED_ACCOUNT");
  if (expected && body.accountNumber && String(body.accountNumber) !== expected) {
    return json({ success: true, skipped: "other account" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const content = String(body.content ?? body.description ?? "");
  const txId = body.id != null ? String(body.id) : (body.referenceCode ? String(body.referenceCode) : null);

  const { data, error } = await supabase.rpc("apply_bank_transaction", {
    p_provider: "sepay",
    p_tx_id: txId,
    p_amount: Math.round(Number(body.transferAmount ?? 0)),
    p_content: content,
    p_raw: body,
  });

  if (error) {
    console.error("apply_bank_transaction", error);
    return json({ success: false, error: error.message }, 500); // SePay sẽ tự gửi lại
  }
  return json({ success: true, result: data });
});
