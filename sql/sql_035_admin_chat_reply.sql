-- 035: Admin đọc được hội thoại admin; user được trả lời tin Memento
-- Chạy trong Supabase SQL Editor.

-- Admin đọc mọi conversation + message
drop policy if exists conversations_select_admin on public.conversations;
create policy conversations_select_admin on public.conversations
  for select to authenticated
  using (public.chat_is_admin());

drop policy if exists messages_select_admin on public.messages;
create policy messages_select_admin on public.messages
  for select to authenticated
  using (public.chat_is_admin());

-- Cho user trả lời hội thoại kind = admin
create or replace function public.send_message(p_conversation_id uuid, p_body text)
returns public.messages
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.conversations;
  txt text := btrim(coalesce(p_body, ''));
  rcpt uuid;
  msg public.messages;
begin
  if me is null then raise exception 'Chưa đăng nhập'; end if;
  if txt = '' then raise exception 'Nội dung trống'; end if;
  if char_length(txt) > 2000 then raise exception 'Tối đa 2000 ký tự'; end if;

  select * into c from public.conversations where id = p_conversation_id;
  if not found then raise exception 'Không tìm thấy hội thoại'; end if;

  if c.kind = 'admin' then
    -- User (client_id) được trả lời; recipient = admin gần nhất đã gửi, hoặc 1 admin bất kỳ
    if me <> c.client_id then
      raise exception 'Bạn không thuộc cuộc trò chuyện này';
    end if;
    if exists (select 1 from public.profiles where id = me and banned_at is not null) then
      raise exception 'Tài khoản đang bị hạn chế, không thể nhắn tin';
    end if;
    select m.sender_id into rcpt
    from public.messages m
    where m.conversation_id = c.id and m.sender_is_admin = true
    order by m.created_at desc
    limit 1;
    if rcpt is null then
      select p.id into rcpt from public.profiles p where p.role = 'admin' order by p.created_at limit 1;
    end if;
    if rcpt is null then raise exception 'Không tìm thấy admin để nhận tin'; end if;

    if (select count(*) from public.messages
        where sender_id = me and created_at > now() - interval '10 seconds') >= 8 then
      raise exception 'Bạn gửi quá nhanh, thử lại sau vài giây';
    end if;

    insert into public.messages (conversation_id, sender_id, recipient_id, sender_is_admin, body)
    values (c.id, me, rcpt, false, txt)
    returning * into msg;

    update public.conversations set last_message_at = msg.created_at where id = c.id;
    return msg;
  end if;

  -- booking chat (như cũ)
  if me = c.client_id then rcpt := c.ptg_user_id;
  elsif me = c.ptg_user_id then rcpt := c.client_id;
  else raise exception 'Bạn không thuộc cuộc trò chuyện này';
  end if;

  if exists (select 1 from public.profiles where id in (me, rcpt) and banned_at is not null) then
    raise exception 'Tài khoản đang bị hạn chế, không thể nhắn tin';
  end if;

  if not public.chat_pair_can_send(c.client_id, c.ptg_user_id) then
    raise exception 'Hai bên chưa có đơn hợp lệ (đơn bị từ chối hoặc đã huỷ) nên chỉ xem lại được tin nhắn';
  end if;

  if (select count(*) from public.messages
      where sender_id = me and created_at > now() - interval '10 seconds') >= 8 then
    raise exception 'Bạn gửi quá nhanh, thử lại sau vài giây';
  end if;

  insert into public.messages (conversation_id, sender_id, recipient_id, body)
  values (c.id, me, rcpt, txt)
  returning * into msg;

  update public.conversations set last_message_at = msg.created_at where id = c.id;
  return msg;
end;
$$;

grant execute on function public.send_message(uuid, text) to authenticated;
