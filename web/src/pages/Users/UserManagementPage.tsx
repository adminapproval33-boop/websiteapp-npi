import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";

interface UserRow {
  nik: string;
  name: string;
  department: string;
  access: "INPUT" | "VIEW" | "FULL_ACCESS";
}

const ACCESS_OPTIONS: UserRow["access"][] = ["INPUT", "VIEW", "FULL_ACCESS"];

const emptyForm = { nik: "", name: "", department: "", password: "", access: "INPUT" as UserRow["access"] };

export default function UserManagementPage() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingNik, setEditingNik] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
      api.put(`/users/${editingNik}`, {
        name: form.name.trim(),
        department: form.department.trim(),
        access: form.access,
        password: form.password || undefined,
      }),
    onSuccess: () => {
      setMessage("User berhasil diperbarui.");
      setForm(emptyForm);
      setEditingNik(null);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal memperbarui user."),
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
    setEditingNik(row.nik);
    setForm({ nik: row.nik, name: row.name, department: row.department, password: "", access: row.access });
    setMessage("");
    setError("");
  }

  function cancelEdit() {
    setEditingNik(null);
    setForm(emptyForm);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (editingNik) updateMutation.mutate();
    else createMutation.mutate();
  }

  const filteredUsers = (usersQuery.data ?? []).filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return u.nik.toLowerCase().includes(q) || u.name.toLowerCase().includes(q) || u.department.toLowerCase().includes(q);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="panel">
        <div className="panel-header">{editingNik ? `Edit User — NIK ${editingNik}` : "Buat User Baru"}</div>
        <form className="panel-body" onSubmit={handleSubmit}>
          <div className="field-grid">
            <div className="field">
              <label>NIK</label>
              <input value={form.nik} onChange={(e) => setForm({ ...form, nik: e.target.value })} disabled={!!editingNik} required />
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
              <label>{editingNik ? "Password Baru (kosongkan jika tidak diubah)" : "Password"}</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required={!editingNik}
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

          {error && <p className="error-text">{error}</p>}
          {message && <p className="status-text">{message}</p>}

          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <button className="btn btn-success" type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
              {editingNik ? "Simpan Perubahan" : "Buat User"}
            </button>
            {editingNik && (
              <button className="btn btn-outline" type="button" onClick={cancelEdit}>
                Batal
              </button>
            )}
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
            <table className="data-table">
              <thead>
                <tr>
                  <th>NIK</th>
                  <th>Nama</th>
                  <th>Departemen</th>
                  <th>Akses</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((row) => (
                  <tr key={row.nik}>
                    <td>{row.nik}</td>
                    <td>{row.name}</td>
                    <td>{row.department}</td>
                    <td>
                      <span className={`tag-${row.access.toLowerCase().replace("_", "-")}`}>{row.access}</span>
                    </td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-outline" onClick={() => startEdit(row)}>
                        Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        disabled={row.nik === me?.nik}
                        onClick={() => {
                          if (confirm(`Hapus user ${row.name} (${row.nik})?`)) deleteMutation.mutate(row.nik);
                        }}
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={5}>Tidak ada data.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
