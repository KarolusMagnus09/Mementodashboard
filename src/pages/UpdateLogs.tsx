import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type LogImage = { url: string; area: "portfolio" | "rental"; board?: string };

type Log = {
  id: string;
  user_id: string;
  photographer_name: string | null;
  change_summary: string;
  created_at: string;
  snapshot?: { images?: { added?: LogImage[]; removed?: LogImage[] } } | null;
};

function ImageGrid({ title, images, removed }: { title: string; images: LogImage[]; removed?: boolean }) {
  if (!images.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: removed ? "#b91c1c" : "#047857", marginBottom: 6 }}>
        {title} ({images.length})
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {images.map((img, i) => (
          <a key={`${img.url}-${i}`} href={img.url} target="_blank" rel="noreferrer"
            title={`${img.area === "rental" ? "Thuê & phụ kiện" : "Portfolio"}${img.board ? ` · ${img.board}` : " · ảnh lẻ"}`}
            style={{ width: 92, textDecoration: "none", color: "inherit" }}>
            <img src={img.url} alt="" loading="lazy"
              style={{
                width: 92, height: 92, objectFit: "cover", borderRadius: 8, display: "block",
                border: `2px solid ${removed ? "#fecaca" : "#a7f3d0"}`,
                opacity: removed ? 0.55 : 1,
              }} />
            <div style={{ fontSize: 10, marginTop: 2, color: "var(--muted)", lineHeight: 1.2, wordBreak: "break-word" }}>
              {img.area === "rental" ? "Thuê" : "Portfolio"}
              {img.board ? ` · ${img.board}` : " · lẻ"}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function UpdateLogs() {
  const [rows, setRows] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("photographer_update_logs")
      .select("id, user_id, photographer_name, change_summary, created_at, snapshot")
      .order("created_at", { ascending: false })
      .limit(100);
    if (err) setError(err.message);
    else setRows((data as Log[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = rows.filter((r) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      (r.photographer_name || "").toLowerCase().includes(s) ||
      (r.change_summary || "").toLowerCase().includes(s) ||
      r.user_id.toLowerCase().includes(s)
    );
  });

  return (
    <>
      <div className="topbar">
        <h2>Log cập nhật hồ sơ PTG</h2>
        <button className="btn btn-ghost" onClick={load}>
          Làm mới
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>
        Mỗi lần PTG bấm <strong>Lưu cập nhật</strong> (app) — không qua CCCD — ghi 1 dòng log + email
        support. Nội dung đã áp lên hồ sơ public.
      </div>

      <input
        className="search"
        placeholder="Tìm tên PTG, nội dung…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {error && (
        <div className="card" style={{ borderColor: "#fecaca", color: "#b91c1c" }}>
          <p style={{ fontWeight: 700 }}>Không tải log</p>
          <p style={{ fontSize: 13 }}>{error}</p>
          <p style={{ fontSize: 12 }}>Chạy SQL <code>019_photographer_update_logs.sql</code> + policy admin.</p>
        </div>
      )}

      {loading ? (
        <p className="muted">Đang tải…</p>
      ) : filtered.length === 0 ? (
        <div className="card">Chưa có log cập nhật.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((r) => (
            <div key={r.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <div>
                  <strong>{r.photographer_name || "PTG"}</strong>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {r.user_id}
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  {new Date(r.created_at).toLocaleString("vi-VN")}
                </div>
              </div>
              <pre
                style={{
                  margin: 0,
                  fontFamily: "inherit",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  color: "var(--muted)",
                }}
              >
                {r.change_summary}
              </pre>
              <ImageGrid title="Ảnh mới" images={r.snapshot?.images?.added ?? []} />
              <ImageGrid title="Ảnh đã gỡ" images={r.snapshot?.images?.removed ?? []} removed />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
