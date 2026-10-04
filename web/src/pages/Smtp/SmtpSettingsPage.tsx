import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";

interface SmtpSettingValue {
  enabled: boolean;
  host: string | null;
  port: number;
  user: string | null;
  fromName: string | null;
  fromEmail: string | null;
  hasPassword: boolean;
}

interface SmtpForm {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

function toForm(v: SmtpSettingValue): SmtpForm {
  return {
    enabled: v.enabled,
    host: v.host ?? "",
    port: v.port,
    user: v.user ?? "",
    pass: "",
    fromName: v.fromName ?? "",
    fromEmail: v.fromEmail ?? "",
  };
}

/** Preset "Penyedia" cuma kemudahan isi Host+Port otomatis (TIDAK disimpan
 * sbg field tersendiri di backend) -- pilih "Custom" utk server email
 * sendiri spt punya Nippon Paint (2026-10-02, tampilan disesuaikan dgn
 * saran Pak Ilham/Digitalisasi NPI). */
const PROVIDER_PRESETS: { label: string; host: string; port: number }[] = [
  { label: "Gmail / Google Workspace", host: "smtp.gmail.com", port: 587 },
  { label: "Microsoft 365 / Outlook", host: "smtp.office365.com", port: 587 },
];

function detectProvider(host: string): string {
  const match = PROVIDER_PRESETS.find((p) => p.host === host);
  return match ? match.label : "Custom";
}

/** Pengaturan SMTP (2026-10-02, saran Pak Ilham/Digitalisasi NPI: "minta
 * claude untuk buatkan form config diweb admin, lalu bpk input situ seperti
 * yg saya screenshot") -- supaya admin bisa isi kredensial email kantor
 * lewat form web ini, tidak perlu akses file .env server langsung lagi.
 * Dipakai fitur Notifikasi Order Macet (Settings > Notifikasi) utk kirim
 * email beneran. */
export default function SmtpSettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SmtpForm | null>(null);
  const [provider, setProvider] = useState("Custom");
  const [hasPassword, setHasPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testError, setTestError] = useState("");

  const settingsQuery = useQuery({
    queryKey: ["smtp-settings"],
    queryFn: () => api.get<{ success: boolean; data: SmtpSettingValue }>("/smtp/settings").then((r) => r.data),
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setForm(toForm(settingsQuery.data));
      setHasPassword(settingsQuery.data.hasPassword);
      setProvider(detectProvider(settingsQuery.data.host ?? ""));
    }
  }, [settingsQuery.data]);

  function handleProviderChange(label: string) {
    setProvider(label);
    const preset = PROVIDER_PRESETS.find((p) => p.label === label);
    if (preset && form) setForm({ ...form, host: preset.host, port: preset.port });
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("no form");
      const { pass, ...rest } = form;
      return api.put<{ success: boolean; data: { hasPassword: boolean } }>("/smtp/settings", {
        ...rest,
        ...(pass ? { pass } : {}),
      });
    },
    onSuccess: (res) => {
      setMessage("Pengaturan SMTP berhasil disimpan.");
      setError("");
      setHasPassword(res.data.hasPassword);
      setForm((f) => (f ? { ...f, pass: "" } : f));
      queryClient.invalidateQueries({ queryKey: ["smtp-settings"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan pengaturan."),
  });

  const testMutation = useMutation({
    mutationFn: () => api.post<{ success: boolean; message: string }>("/smtp/test-send", {}),
    onSuccess: (res) => {
      setTestMessage(res.message);
      setTestError("");
    },
    onError: (err) => {
      setTestError(err instanceof ApiError ? err.message : "Gagal mengirim email uji.");
      setTestMessage("");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    saveMutation.mutate();
  }

  function handleTest() {
    setTestMessage("");
    setTestError("");
    testMutation.mutate();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="panel">
        <div className="panel-header">Server SMTP</div>
        <div className="panel-body">
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: 16 }}>
            Dipakai untuk email Notifikasi Order Macet (lihat Settings &gt; Notifikasi).
          </p>
          {settingsQuery.isLoading || !form ? (
            <p>Memuat...</p>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="field" style={{ marginBottom: 14 }}>
                <label>Penyedia</label>
                <select value={provider} onChange={(e) => handleProviderChange(e.target.value)}>
                  <option value="Custom">Custom</option>
                  {PROVIDER_PRESETS.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div className="field">
                  <label>Host SMTP</label>
                  <input
                    type="text"
                    placeholder="mail.namadomain.com"
                    value={form.host}
                    onChange={(e) => {
                      setForm({ ...form, host: e.target.value });
                      setProvider(detectProvider(e.target.value));
                    }}
                    required
                  />
                </div>
                <div className="field">
                  <label>Port</label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                  />
                  <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: 0 }}>
                    587 untuk STARTTLS, 465 untuk SSL.
                  </p>
                </div>
              </div>

              <div className="field" style={{ marginBottom: 14 }}>
                <label>Nama Pengguna</label>
                <input
                  type="text"
                  placeholder="nama@namadomain.com"
                  value={form.user}
                  onChange={(e) => setForm({ ...form, user: e.target.value })}
                  autoComplete="off"
                  required
                />
              </div>

              <div className="field" style={{ marginBottom: 14 }}>
                <label>Kata Sandi / App Password</label>
                <input
                  type="password"
                  placeholder={hasPassword ? "•••••••• (tidak berubah)" : "Masukkan kata sandi aplikasi"}
                  value={form.pass}
                  onChange={(e) => setForm({ ...form, pass: e.target.value })}
                  autoComplete="new-password"
                />
                <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: 0 }}>
                  {hasPassword
                    ? "Kata sandi sudah tersimpan. Biarkan kosong untuk mempertahankannya, atau ketik yang baru untuk menggantinya."
                    : "Belum ada kata sandi tersimpan."}
                </p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div className="field">
                  <label>Nama Pengirim</label>
                  <input
                    type="text"
                    placeholder="MES NPI"
                    value={form.fromName}
                    onChange={(e) => setForm({ ...form, fromName: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Alamat Pengirim</label>
                  <input
                    type="email"
                    placeholder="nama@namadomain.com"
                    value={form.fromEmail}
                    onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
                  />
                  <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: 0 }}>
                    Kosongkan untuk memakai Nama Pengguna. Sebagian penyedia hanya mengizinkan alamat terverifikasi.
                  </p>
                </div>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", marginBottom: 14 }}>
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                />
                Gunakan server ini untuk email keluar
              </label>

              {error && <p className="error-text">{error}</p>}
              {message && <p className="status-text">{message}</p>}
              <div style={{ marginTop: 12, marginBottom: 14 }}>
                <button className="btn btn-success" type="submit" disabled={saveMutation.isPending}>
                  Simpan Pengaturan
                </button>
              </div>

              <div
                style={{
                  background: "var(--success-bg, #e3f6ed)",
                  color: "var(--success, #1e9e68)",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: "0.8rem",
                }}
              >
                Kata sandi dienkripsi sebelum disimpan dan tidak pernah dikirim kembali ke halaman ini.
              </div>
            </form>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Kirim Email Uji</div>
        <div className="panel-body">
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: 12 }}>
            Simpan pengaturan di atas dulu, lalu klik tombol ini untuk memastikan kredensial SMTP benar-benar bisa
            mengirim email -- akan dikirim ke Alamat Pengirim di atas.
          </p>
          {testError && <p className="error-text">{testError}</p>}
          {testMessage && <p className="status-text">{testMessage}</p>}
          <button className="btn btn-info" type="button" onClick={handleTest} disabled={testMutation.isPending}>
            {testMutation.isPending ? "Mengirim..." : "Kirim Email Uji"}
          </button>
        </div>
      </div>
    </div>
  );
}
