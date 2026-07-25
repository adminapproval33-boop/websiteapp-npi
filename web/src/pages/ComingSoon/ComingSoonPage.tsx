export default function ComingSoonPage({ label, note }: { label: string; note?: string }) {
  return (
    <div className="panel">
      <div className="panel-header">{label}</div>
      <div className="coming-soon">
        <h2>🚧 Segera Hadir</h2>
        <p>Halaman "{label}" belum tersedia di versi ini.</p>
        {note && <p style={{ maxWidth: 480 }}>{note}</p>}
      </div>
    </div>
  );
}
