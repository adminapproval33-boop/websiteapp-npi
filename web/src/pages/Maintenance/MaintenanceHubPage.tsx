import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MaintenanceFormPage from "./MaintenanceFormPage";
import MaintenanceListPage from "./MaintenanceListPage";
import MaintenanceSchedulePage from "./MaintenanceSchedulePage";

/**
 * "Maintenance" (2026-09-22, instruksi eksplisit user) -- gabung 3 sub-menu
 * sidebar yg SEBELUMNYA terpisah (Form Input Maintenance/List Job
 * Maintenance/Jadwal Pengerjaan, 2026-08-06) jadi TAB di 1 halaman yg sama,
 * pola SAMA PERSIS dgn Dashboard Quality (QualityCheckReviewPage.tsx) --
 * tombol tab di atas, `useState` lokal, render kondisional (tab yg tidak
 * aktif di-unmount, bukan cuma disembunyikan). Ketiga komponen di bawah
 * TIDAK diubah struktur internalnya sama sekali, cuma dibungkus tab bar ini.
 */
export default function MaintenanceHubPage() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<"form" | "list" | "schedule">("form");

  // Tombol "Edit" di tab List (MaintenanceListPage.tsx) TETAP navigate ke
  // /maintenance/form?editId=X (base path SAMA, tidak berubah) -- begitu
  // param editId muncul/berubah, tab di sini ikut lompat ke "form" supaya
  // form edit-nya KELIHATAN (bukan cuma ke-load di background krn tab List
  // yg masih aktif).
  useEffect(() => {
    if (searchParams.get("editId")) setTab("form");
  }, [searchParams]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className={`btn ${tab === "form" ? "" : "btn-outline"}`} onClick={() => setTab("form")}>
          Form Input Maintenance
        </button>
        <button className={`btn ${tab === "list" ? "" : "btn-outline"}`} onClick={() => setTab("list")}>
          List Job Maintenance
        </button>
        <button className={`btn ${tab === "schedule" ? "" : "btn-outline"}`} onClick={() => setTab("schedule")}>
          Jadwal Pengerjaan
        </button>
      </div>

      {tab === "form" && <MaintenanceFormPage />}
      {tab === "list" && <MaintenanceListPage />}
      {tab === "schedule" && <MaintenanceSchedulePage />}
    </div>
  );
}
