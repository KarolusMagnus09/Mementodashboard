/**
 * Gợi ý patch SettingsScreen: xóa hồ sơ PTG (password + optional captcha).
 * Gọi: await supabase.rpc('delete_own_ptg_profile')
 * Chỉ hiện khi profile.role === 'photographer'
 */
// Xem README + NOTES_APP.md — tích hợp vào SettingsScreen.tsx của app.
