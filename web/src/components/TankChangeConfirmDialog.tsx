import Modal from "./Modal";

/** Popup konfirmasi "pindah tanki" (2026-09-29, instruksi eksplisit user) --
 * lihat lib/useTankChangeGuard.ts utk logika kapan popup ini dipicu. */
export default function TankChangeConfirmDialog({
  previousTank,
  newTanks,
  onCancel,
  onConfirm,
}: {
  previousTank: string;
  newTanks: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title="Konfirmasi Pindah Tanki" onClose={onCancel} width={440} closeOnBackdropClick={false}>
      <p style={{ margin: "0 0 12px" }}>
        Tanki yang Anda input (<strong>{newTanks.join(", ")}</strong>) berbeda dengan tanki proses sebelumnya (
        <strong>{previousTank}</strong>) untuk Order ini.
      </p>
      <p style={{ margin: "0 0 20px" }}>
        Apakah Anda yakin mau memindahkan datanya ke tanki baru ini? Jika sudah Anda cek ulang dan memang sudah benar,
        Anda bisa tekan Save sekarang.
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-outline" type="button" onClick={onCancel}>
          Batal
        </button>
        <button className="btn" type="button" onClick={onConfirm}>
          Ya, Save Sekarang
        </button>
      </div>
    </Modal>
  );
}
