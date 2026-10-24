# Tự động xác nhận thanh toán (SePay) — hướng dẫn cài

1. Supabase → SQL Editor: chạy `sql/022_payments_auto.sql`.
2. Deploy hàm webhook:
   ```bash
   supabase functions deploy bank-webhook --no-verify-jwt
   supabase secrets set WEBHOOK_API_KEY=<chuỗi bí mật bạn tự đặt>
   supabase secrets set EXPECTED_ACCOUNT=7420808992   # tuỳ chọn
   ```
3. SePay → Tích hợp Webhooks → thêm webhook:
   - URL: `https://<project-ref>.supabase.co/functions/v1/bank-webhook`
   - Chứng thực: **API Key** = chuỗi ở bước 2
   - Sự kiện: tiền vào
4. Test: tạo lịch hẹn, PTG đồng ý, chuyển khoản số tiền nhỏ với nội dung `MMT-XXXXXXXXC` → vào admin → **Log giao dịch**.

Kết quả log: `matched` (tự xác nhận), `unmatched` (không thấy mã), `underpaid` (thiếu tiền), `ignored` (đơn đã trả / đã hủy — cần hoàn tiền tay).
