import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import { MENU_KEYS, MENU_LABELS, MenuKey, MenuLevel } from "../../lib/menuAccess";

interface MenuAccessValue {
  hiddenMenus: string[];
  viewOnlyMenus: string[];
}

function levelOf(key: MenuKey, value: MenuAccessValue): MenuLevel {
  if (value.hiddenMenus.includes(key)) return "HIDE";
  if (value.viewOnlyMenus.includes(key)) return "VIEW";
  return "INPUT";
}

/** Grid dropdown "Akses per Menu" -- dipakai di form Buat User Baru DAN di
 * pop-up Edit (2026-08-03, instruksi eksplisit user: 3 level View/Input/Hide
 * per menu, bukan cuma centang blokir/tidak; pop-up Edit spy tidak perlu
 * scroll ke atas ke form Buat User Baru lagi). Diekstrak jadi 1 komponen
 * supaya JSX-nya tidak dobel di 2 tempat. */
function MenuAccessGrid({ value, onChange }: { value: MenuAccessValue; onChange: (next: MenuAccessValue) => void }) {
  function setLevel(key: MenuKey, level: MenuLevel) {
    const hiddenMenus = value.hiddenMenus.filter((k) => k !== key);
    const viewOnlyMenus = value.viewOnlyMenus.filter((k) => k !== key);
    if (level === "HIDE") hiddenMenus.push(key);
    if (level === "VIEW") viewOnlyMenus.push(key);
    onChange({ hiddenMenus, viewOnlyMenus });
  }

  return (
    <div className="field" style={{ marginTop: 14 }}>
      <label>Akses per Menu</label>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "6px 12px",
          marginTop: 4,
          padding: 10,
          border: "1px solid var(--border)",
          borderRadius: 6,
        }}
      >
        {MENU_KEYS.map((key) => (
          <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: "0.85rem" }}>{MENU_LABELS[key]}</span>
            <select
              value={levelOf(key, value)}
              onChange={(e) => setLevel(key, e.target.value as MenuLevel)}
              style={{ fontSize: "0.8rem", padding: "2px 4px" }}
            >
              <option value="INPUT">Input</option>
              <option value="VIEW">View</option>
              <option value="HIDE">Hide</option>
            </select>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 6, marginBottom: 0, fontSize: "0.75rem", color: "var(--text-muted)" }}>
        Input = akses penuh. View = cuma bisa lihat History/Queue, tidak bisa Save. Hide = menu hilang dari sidebar,
        tidak bisa diakses sama sekali. Tidak berlaku utk akses Full Access.
      </p>
    </div>
  );
}

interface UserRow {
  nik: string;
  name: string;
  department: string;
  access: "INPUT" | "VIEW" | "FULL_ACCESS";
  /** Key menu (lihat lib/menuAccess.ts) yg user ini TIDAK PUNYA akses sama
   * sekali (2026-08-03, instruksi eksplisit user). Tidak berlaku utk FULL_ACCESS. */
  hiddenMenus: string[];
  /** Key menu yg user ini cuma bisa lihat (History/Queue), tidak bisa input. */
  viewOnlyMenus: string[];
}

const ACCESS_OPTIONS: UserRow["access"][] = ["INPUT", "VIEW", "FULL_ACCESS"];

const emptyForm = {
  nik: "",
  name: "",
  department: "",
  password: "",
  access: "INPUT" as UserRow["access"],
  hiddenMenus: [] as string[],
  viewOnlyMenus: [] as string[],
};

type EditForm = Omit<typeof emptyForm, "nik">;

export default function UserManagementPage() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Pop-up Edit (2026-08-03, instruksi eksplisit user) -- TERPISAH dari form
  // "Buat User Baru" di atas (state & mutation sendiri-sendiri) supaya Edit
  // tidak perlu scroll ke atas: klik "Edit" di baris tabel langsung buka
  // pop-up di tempat, isi & Simpan/Batal semua di situ.
  const [editNik, setEditNik] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    name: "",
    department: "",
    password: "",
    access: "INPUT",
    hiddenMenus: [],
    viewOnlyMenus: [],
  });
  const [editError, setEditError] = useState("");

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ success: boolean; data: UserRow[] }>("/users").then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/users", {
        nik: form.nik.trim(),
        name: form.name.trim(),
        department: form.department.trim(),
        password: form.password,
        access: form.access,
        hiddenMenus: form.hiddenMenus,
        viewOnlyMenus: form.viewOnlyMenus,
      }),
    onSuccess: () => {
      setMessage("User berhasil dibuat.");
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal membuat user."),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      api.put(`/users/${editNik}`, {
        name: editForm.name.trim(),
        department: editForm.department.trim(),
        access: editForm.access,
        password: editForm.password || undefined,
        hiddenMenus: editForm.hiddenMenus,
        viewOnlyMenus: editForm.viewOnlyMenus,
      }),
    onSuccess: () => {
      setMessage("User berhasil diperbarui.");
      setEditNik(null);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => setEditError(err instanceof ApiError ? err.message : "Gagal memperbarui user."),
  });

  const deleteMutation = useMutation({
    mutationFn: (nik: string) => api.delete(`/users/${nik}`),
    onSuccess: () => {
      setMessage("User berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menghapus user."),
  });

  function startEdit(row: UserRow) {
    setEditNik(row.nik);
    setEditForm({
      name: row.name,
      department: row.department,
      password: "",
      access: row.access,
      hiddenMenus: row.hiddenMenus,
      viewOnlyMenus: row.viewOnlyMenus,
    });
    setEditError("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    createMutation.mutate();
  }

  function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    setEditError("");
    updateMutation.mutate();
  }

  const filteredUsers = (usersQuery.data ?? []).filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return u.nik.toLowerCase().includes(q) || u.name.toLowerCase().includes(q) || u.department.toLowerCase().includes(q);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="panel">
        <div className="panel-header">Buat User Baru</div>
        <form className="panel-body" onSubmit={handleSubmit}>
          <div className="field-grid">
            <div className="field">
              <label>NIK</label>
              <input value={form.nik} onChange={(e) => setForm({ ...form, nik: e.target.value })} required />
            </div>
            <div className="field">
              <label>Nama</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="field">
              <label>Departemen</label>
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} required />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={6}
              />
            </div>
            <div className="field">
              <label>Akses</label>
              <select value={form.access} onChange={(e) => setForm({ ...form, access: e.target.value as UserRow["access"] })}>
                {ACCESS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <MenuAccessGrid
            value={{ hiddenMenus: form.hiddenMenus, viewOnlyMenus: form.viewOnlyMenus }}
            onChange={(next) => setForm({ ...form, ...next })}
          />

          {error && <p className="error-text">{error}</p>}
          {message && <p className="status-text">{message}</p>}

          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <button className="btn btn-success" type="submit" disabled={createMutation.isPending}>
              Buat User
            </button>
          </div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-header">Daftar User</div>
        <div className="panel-body">
          <input
            placeholder="Cari NIK / Nama / Departemen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
          />
          {usersQuery.isLoading ? (
            <p>Memuat...</p>
          ) : (
            <DataTable
              rowKey={(r: UserRow) => r.nik}
              exportFileName="daftar-user"
              storageKey="user-management"
              rows={filteredUsers}
              freezeFirstColumn
              columns={[
                { key: "nik", label: "NIK", render: (r) => r.nik },
                { key: "name", label: "Nama", render: (r) => r.name },
                { key: "department", label: "Departemen", render: (r) => r.department },
                {
                  key: "access",
                  label: "Akses",
                  render: (r) => <span className={`tag-${r.access.toLowerCase().replace("_", "-")}`}>{r.access}</span>,
                  csvValue: (r) => r.access,
                },
                {
                  key: "menuAccess",
                  label: "Akses Menu",
                  render: (r) => {
                    if (r.hiddenMenus.length === 0 && r.viewOnlyMenus.length === 0) {
                      return <span style={{ color: "var(--text-muted)" }}>-</span>;
                    }
                    const title = [
                      ...r.hiddenMenus.map((k) => `${MENU_LABELS[k as MenuKey] ?? k} (Hide)`),
                      ...r.viewOnlyMenus.map((k) => `${MENU_LABELS[k as MenuKey] ?? k} (View)`),
                    ].join(", ");
                    return (
                      <span className="error-text" title={title}>
                        {r.hiddenMenus.length > 0 && `${r.hiddenMenus.length} Hide`}
                        {r.hiddenMenus.length > 0 && r.viewOnlyMenus.length > 0 && ", "}
                        {r.viewOnlyMenus.length > 0 && `${r.viewOnlyMenus.length} View`}
                      </span>
                    );
                  },
                  csvValue: (r) =>
                    [
                      ...r.hiddenMenus.map((k) => `${MENU_LABELS[k as MenuKey] ?? k} (Hide)`),
                      ...r.viewOnlyMenus.map((k) => `${MENU_LABELS[k as MenuKey] ?? k} (View)`),
                    ].join(", "),
                },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-outline" onClick={() => startEdit(r)}>
                        Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        disabled={r.nik === me?.nik}
                        onClick={() => {
                          if (confirm(`Hapus user ${r.name} (${r.nik})?`)) deleteMutation.mutate(r.nik);
                        }}
                      >
                        Hapus
                      </button>
                    </div>
                  ),
                  csvValue: () => "",
                },
              ]}
            />
          )}
        </div>
      </div>

      {editNik && (
        <Modal title={`Edit User — NIK ${editNik}`} onClose={() => setEditNik(null)} width={640}>
          <form onSubmit={handleEditSubmit}>
            <div className="field-grid">
              <div className="field">
                <label>Nama</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
              </div>
              <div className="field">
                <label>Departemen</label>
                <input value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} required />
              </div>
              <div className="field">
                <label>Password Baru (kosongkan jika tidak diubah)</label>
                <input
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  minLength={6}
                />
              </div>
              <div className="field">
                <label>Akses</label>
                <select
                  value={editForm.access}
                  onChange={(e) => setEditForm({ ...editForm, access: e.target.value as UserRow["access"] })}
                >
                  {ACCESS_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <MenuAccessGrid
              value={{ hiddenMenus: editForm.hiddenMenus, viewOnlyMenus: editForm.viewOnlyMenus }}
              onChange={(next) => setEditForm({ ...editForm, ...next })}
            />

            {editError && <p className="error-text">{editError}</p>}

            <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
              <button className="btn btn-success" type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Menyimpan..." : "Simpan Perubahan"}
              </button>
              <button className="btn btn-outline" type="button" onClick={() => setEditNik(null)}>
                Batal
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
