# Chỉnh app Non_F cho khớp admin

## Tương thích bản zip mới
- App đã có `admin_note`, policy admin, delete own (sql/012).
- Marketplace chỉ đọc `photographers` → duyệt phải publish (RPC sql/014).
- Cột rental: admin web đã đọc `skill_rental`, `rental_boards`, `rental_pins`.

## Supabase
1. Chạy `sql/014_admin_approve_and_publish.sql`
2. Chạy `sql/015_create_admin_account.sql` (sau Add user trong Auth)

## Sau khi duyệt
- RLS: user không UPDATE application khi status=approved
- Chỉ xóa qua Cài đặt → RPC `delete_own_ptg_profile()`
- ProfileScreen: ẩn "Trở thành PTG" / edit form khi approved

## Search
Không đổi SearchScreen — row publish có name, specialty, tags, location, price.
