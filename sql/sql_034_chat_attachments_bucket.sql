-- Bucket lưu file/ảnh chat admin (public read)
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', true)
on conflict (id) do nothing;

-- Policy: admin (authenticated) upload; public read
drop policy if exists chat_attachments_upload on storage.objects;
create policy chat_attachments_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-attachments');

drop policy if exists chat_attachments_read on storage.objects;
create policy chat_attachments_read on storage.objects
  for select to public
  using (bucket_id = 'chat-attachments');
