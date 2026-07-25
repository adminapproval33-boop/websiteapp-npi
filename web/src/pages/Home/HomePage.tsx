import { useAuth } from "../../auth/AuthContext";

export default function HomePage() {
  const { user } = useAuth();
  return (
    <div className="panel">
      <div className="panel-header">Welcome to Websiteapp NPI</div>
      <div className="panel-body">
        <p>
          Halo, <strong>{user?.name}</strong> ({user?.department}). Sistem ini adalah versi website mandiri dari
          Websiteapp NPI, menggantikan versi Google Apps Script agar input data dan pembacaan informasi berjalan
          jauh lebih cepat.
        </p>
        <p>Gunakan menu di sebelah kiri untuk mengakses modul yang tersedia.</p>
        <p className="mt-4 text-xs text-slate-400">
          Developed by teguh.agri@nipseapaint.com
        </p>
      </div>
    </div>
  );
}
