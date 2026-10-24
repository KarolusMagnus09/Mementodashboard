import { useEffect, useMemo, useState } from "react";
import {
  BANK_SOURCE_LABEL,
  buildPayoutQrUrls,
  formatVnd,
  type BankInfo,
} from "../lib/payout";

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    } catch {
      window.prompt("Sao chép:", text);
    }
  }
  return (
    <button
      type="button"
      className="btn btn-ghost"
      style={{ padding: "2px 8px", fontSize: 11, marginLeft: 6 }}
      onClick={copy}
      aria-label={`Sao chép ${label}`}
    >
      {done ? "Đã chép ✓" : "Chép"}
    </button>
  );
}

/**
 * Khối "chuyển tiền cho photographer": QR + thông tin tài khoản để admin quét và chuyển.
 * Nút xác nhận (sang bước kế tiếp) nằm ở Bookings.tsx, ngay dưới khối này.
 */
export default function PayoutCard({
  title,
  amount,
  content,
  ptgName,
  candidates,
  problem,
}: {
  title: string;
  amount: number;
  /** Nội dung chuyển khoản (không dấu, ≤ 25 ký tự) */
  content: string;
  ptgName: string;
  candidates: BankInfo[];
  /** Lý do không có thông tin ngân hàng (hiện khi candidates rỗng) */
  problem?: string | null;
}) {
  const conflict = candidates.length > 1;
  const [picked, setPicked] = useState<number | null>(candidates.length === 1 ? 0 : null);
  const [qrTry, setQrTry] = useState(0);

  // Dữ liệu đổi (làm mới, chọn tài khoản khác) → chọn lại và thử QR từ đầu
  const sig = candidates.map((c) => `${c.source}:${c.bank_account}`).join("|");
  useEffect(() => {
    setPicked(candidates.length === 1 ? 0 : null);
    setQrTry(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const bank = picked != null ? candidates[picked] : null;
  const urls = useMemo(() => (bank ? buildPayoutQrUrls(bank, amount, content) : []), [bank, amount, content]);

  const box: React.CSSProperties = {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    background: "#fffbeb",
    border: "1px solid #fde68a",
    fontSize: 12,
    lineHeight: 1.6,
  };

  if (candidates.length === 0) {
    return (
      <div style={{ ...box, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b" }}>
        <strong>Chưa có thông tin tài khoản của {ptgName} — chưa nên bấm xác nhận.</strong>
        <div style={{ marginTop: 4 }}>{problem || "Photographer chưa nhập số tài khoản ngân hàng."}</div>
      </div>
    );
  }

  const row = (k: string, v: string, copy?: boolean) => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
      <span className="muted" style={{ width: 86, flexShrink: 0 }}>{k}</span>
      <strong style={{ wordBreak: "break-all" }}>{v}</strong>
      {copy && <CopyBtn text={v} label={k} />}
    </div>
  );

  return (
    <div style={box}>
      <strong>{title}</strong>

      {conflict && (
        <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: "#fee2e2", color: "#991b1b" }}>
          <strong>Hai nguồn đang có số tài khoản KHÁC nhau.</strong> Hãy hỏi lại {ptgName} trước khi chuyển, rồi chọn
          tài khoản đúng:
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            {candidates.map((c, i) => (
              <button
                key={`${c.source}-${c.bank_account}`}
                type="button"
                className={picked === i ? "btn btn-primary" : "btn btn-ghost"}
                style={{ fontSize: 12 }}
                onClick={() => { setPicked(i); setQrTry(0); }}
              >
                {c.bank_name || c.bank_code} · {c.bank_account} ({BANK_SOURCE_LABEL[c.source]})
              </button>
            ))}
          </div>
        </div>
      )}

      {bank && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, alignItems: "flex-start" }}>
          <div
            style={{
              width: 190,
              minHeight: 190,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 6,
              textAlign: "center",
            }}
          >
            {qrTry < urls.length ? (
              <img
                key={urls[qrTry]}
                src={urls[qrTry]}
                alt={`QR chuyển ${formatVnd(amount)} cho ${ptgName}`}
                style={{ width: "100%", height: "auto", display: "block" }}
                onError={() => setQrTry((i) => i + 1)}
              />
            ) : (
              <span className="muted" style={{ fontSize: 12 }}>
                Không tải được ảnh QR.
                <br />
                Hãy chuyển thủ công theo thông tin bên cạnh.
              </span>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 220 }}>
            {row("Ngân hàng", bank.bank_name || bank.bank_code || "—")}
            {row("Số tài khoản", bank.bank_account, true)}
            {row("Chủ tài khoản", bank.bank_account_name || "—", !!bank.bank_account_name)}
            {row("Số tiền", String(Math.round(amount)), true)}
            <div className="muted" style={{ marginLeft: 94, fontSize: 11 }}>{formatVnd(amount)}</div>
            {row("Nội dung", content, true)}
            <div className="muted" style={{ marginTop: 8, fontSize: 11 }}>
              Dữ liệu lấy từ {BANK_SOURCE_LABEL[bank.source]}. Quét QR bằng app ngân hàng, kiểm tra tên chủ tài khoản
              hiện ra khớp với "{bank.bank_account_name || ptgName}" rồi mới chuyển.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
