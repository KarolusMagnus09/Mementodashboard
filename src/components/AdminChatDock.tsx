import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export type ChatTarget = {
  userId: string;
  name: string;
  avatar?: string | null;
};

type Msg = {
  id: string;
  body: string;
  sender_id: string;
  sender_is_admin?: boolean;
  created_at: string;
};

const MAX_BOXES = 2;

/**
 * Dock chat kiểu Messenger — tối đa 2 box.
 * Mở box thứ 3 → đóng box cũ nhất.
 */
export function AdminChatDock({
  openTargets,
  onClose,
}: {
  openTargets: ChatTarget[];
  onClose: (userId: string) => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 0,
        zIndex: 1000,
        display: "flex",
        flexDirection: "row-reverse",
        alignItems: "flex-end",
        gap: 12,
        pointerEvents: "none",
      }}
    >
      {openTargets.slice(0, MAX_BOXES).map((t) => (
        <div key={t.userId} style={{ pointerEvents: "auto" }}>
          <ChatBox target={t} onClose={() => onClose(t.userId)} />
        </div>
      ))}
    </div>
  );
}

function ChatBox({ target, onClose }: { target: ChatTarget; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    // 1) Tìm conversation admin với user
    let cid: string | null = null;
    const { data: convs } = await supabase
      .from("conversations")
      .select("id")
      .eq("kind", "admin")
      .eq("client_id", target.userId)
      .maybeSingle();
    cid = (convs?.id as string) || null;

    // 2) Fallback: tin gần nhất admin gửi cho user (nếu RLS conv chưa mở)
    if (!cid) {
      const { data: last } = await supabase
        .from("messages")
        .select("conversation_id")
        .eq("recipient_id", target.userId)
        .eq("sender_is_admin", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      cid = (last?.conversation_id as string) || null;
    }

    if (!cid) {
      setConvId(null);
      return; // không xóa msgs đang có sau khi vừa gửi
    }
    setConvId(cid);
    const { data } = await supabase
      .from("messages")
      .select("id, body, sender_id, sender_is_admin, created_at")
      .eq("conversation_id", cid)
      .order("created_at", { ascending: true })
      .limit(200);
    if (data) setMsgs(data as Msg[]);
  }, [target.userId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length, minimized]);

  async function send(body: string) {
    const txt = body.trim();
    if (!txt) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc("admin_send_message", {
      p_user_id: target.userId,
      p_body: txt.slice(0, 2000),
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setText("");
    if (data) {
      const m = data as Msg & { conversation_id?: string };
      setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (m.conversation_id) setConvId(m.conversation_id);
    }
    // load lại sau 300ms (đợi RLS/policy nếu vừa chạy SQL)
    setTimeout(() => { void load(); }, 300);
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setErr("File tối đa 15MB");
      return;
    }
    setBusy(true);
    setErr(null);
    const path = `admin-chat/${target.userId}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("chat-attachments").upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
    });
    if (upErr) {
      // Fallback: bucket chưa có → báo user
      setBusy(false);
      setErr(
        upErr.message.includes("not found") || upErr.message.includes("Bucket")
          ? "Chưa có storage bucket «chat-attachments». Chạy SQL tạo bucket hoặc gửi link file trong tin nhắn."
          : upErr.message
      );
      return;
    }
    const { data: pub } = supabase.storage.from("chat-attachments").getPublicUrl(path);
    const url = pub?.publicUrl || path;
    const label = file.type.startsWith("image/") ? `[Ảnh] ${file.name}` : `[File] ${file.name}`;
    await send(`${label}\n${url}`);
    setBusy(false);
  }

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        style={{
          width: 260,
          background: "#0f3d34",
          color: "white",
          border: "none",
          borderRadius: "12px 12px 0 0",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          boxShadow: "0 -2px 12px rgba(0,0,0,0.15)",
        }}
      >
        {target.avatar ? (
          <img src={target.avatar} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "#1a8c76",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {(target.name || "?").slice(0, 1).toUpperCase()}
          </span>
        )}
        <span style={{ flex: 1, textAlign: "left", fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {target.name}
        </span>
        <span
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{ opacity: 0.8, fontSize: 16, lineHeight: 1 }}
        >
          ×
        </span>
      </button>
    );
  }

  return (
    <div
      style={{
        width: 320,
        height: 420,
        background: "white",
        borderRadius: "12px 12px 0 0",
        boxShadow: "0 -4px 24px rgba(0,0,0,0.18)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: "1px solid #e5e7eb",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: "#0f3d34",
          color: "white",
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        {target.avatar ? (
          <img src={target.avatar} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "#1a8c76",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {(target.name || "?").slice(0, 1).toUpperCase()}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {target.name}
          </div>
          <div style={{ fontSize: 11, opacity: 0.75 }}>Tin nhắn admin → app</div>
        </div>
        <button type="button" onClick={() => setMinimized(true)} style={iconBtn} title="Thu nhỏ">
          −
        </button>
        <button type="button" onClick={onClose} style={iconBtn} title="Đóng">
          ×
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12, background: "#f3f4f6" }}>
        {msgs.length === 0 && (
          <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 12, marginTop: 40 }}>
            Chưa có tin nhắn. Gửi tin đầu tiên cho user.
          </p>
        )}
        {msgs.map((m) => {
          const isAdmin = !!m.sender_is_admin;
          return (
            <div
              key={m.id}
              style={{
                display: "flex",
                justifyContent: isAdmin ? "flex-end" : "flex-start",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  maxWidth: "80%",
                  padding: "8px 12px",
                  borderRadius: 16,
                  background: isAdmin ? "#0f766e" : "white",
                  color: isAdmin ? "white" : "#111",
                  fontSize: 13,
                  lineHeight: 1.4,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {renderBody(m.body, isAdmin)}
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, textAlign: "right" }}>
                  {new Date(m.created_at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {err && (
        <div style={{ padding: "6px 12px", background: "#fef2f2", color: "#b91c1c", fontSize: 11 }}>{err}</div>
      )}

      {/* Composer */}
      <div style={{ padding: 10, borderTop: "1px solid #e5e7eb", background: "white", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="Gửi ảnh / file"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            📎
          </button>
          <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx,.zip" hidden onChange={onPickFile} />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            placeholder="Nhập tin nhắn..."
            rows={2}
            style={{
              flex: 1,
              resize: "none",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: "8px 10px",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => send(text)}
            style={{
              width: 40,
              height: 36,
              borderRadius: 10,
              border: "none",
              background: text.trim() ? "#0f766e" : "#d1d5db",
              color: "white",
              fontWeight: 700,
              cursor: text.trim() ? "pointer" : "default",
            }}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

function renderBody(body: string, isAdmin: boolean) {
  // Detect URL lines for files/images
  const lines = body.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const urlMatch = line.match(/https?:\/\/\S+/);
        if (urlMatch) {
          const url = urlMatch[0];
          const isImg = /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url) || line.startsWith("[Ảnh]");
          if (isImg) {
            return (
              <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: i ? 4 : 0 }}>
                <img src={url} alt="" style={{ maxWidth: "100%", borderRadius: 8, display: "block" }} />
              </a>
            );
          }
          return (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noreferrer"
              style={{ color: isAdmin ? "#ccfbf1" : "#0f766e", textDecoration: "underline", display: "block" }}
            >
              {line.replace(url, "").trim() || "Tải file"}
            </a>
          );
        }
        return (
          <span key={i}>
            {i > 0 && <br />}
            {line}
          </span>
        );
      })}
    </>
  );
}

const iconBtn: import('react').CSSProperties = {
  background: "transparent",
  border: "none",
  color: "white",
  fontSize: 18,
  cursor: "pointer",
  lineHeight: 1,
  padding: "0 4px",
  opacity: 0.9,
};

/** Hook quản lý tối đa 2 box chat */
export function useAdminChatBoxes() {
  const [targets, setTargets] = useState<ChatTarget[]>([]);

  function openChat(t: ChatTarget) {
    setTargets((prev) => {
      const without = prev.filter((x) => x.userId !== t.userId);
      const next = [...without, t];
      // Giữ tối đa 2: bỏ cái cũ nhất (đầu mảng)
      if (next.length > MAX_BOXES) return next.slice(next.length - MAX_BOXES);
      return next;
    });
  }

  function closeChat(userId: string) {
    setTargets((prev) => prev.filter((x) => x.userId !== userId));
  }

  return { targets, openChat, closeChat };
}
