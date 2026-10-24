# Memento Admin

Web duyệt hồ sơ PTG + xem data. Khớp app Non_F (bản có rental, admin_note, sql/012).

## Setup Supabase (theo thứ tự)

1. `sql/011_photographer_applications_storage.sql` (nếu chưa) — bucket ảnh  
2. `sql/012_delete_photographer_application.sql` (nếu chưa) — admin read + user delete  
3. **`sql/014_admin_approve_and_publish.sql`** — RPC duyệt → publish marketplace  
4. **`sql/015_create_admin_account.sql`** — gán role admin  

### Tạo acc admin
1. Dashboard → **Authentication → Users → Add user**  
   - Email + password, Auto Confirm  
2. Chạy 015 (đổi email trong file)  
3. Đăng nhập admin web bằng email/password đó  

## Chạy admin web

```bash
cd memento-admin
npm install
npm run dev
```
→ http://localhost:5174  

## Luồng duyệt
- **Chấp nhận** → `admin_set_application_status(..., 'approved')`  
  - `photographer_applications.status = approved`  
  - `profiles.role = photographer`  
  - **UPSERT `photographers`** (user khác thấy + Search filter)  
- **Từ chối** → status rejected, gỡ marketplace nếu từng duyệt  

## 1 acc = 1 profile
- `photographer_applications.user_id` PK  
- `photographers.user_id` UNIQUE  
- Sau approved: RLS **chặn UPDATE** application; chỉ DELETE (qua Cài đặt)  

## Xóa profile (app)
Xem `app-patches/SettingsScreen-delete-ptg.tsx` + `NOTES_APP.md`.  
RPC: `delete_own_ptg_profile()`.
