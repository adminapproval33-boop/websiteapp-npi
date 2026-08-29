import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError } from "../../api/client";

function MoleculeMotif() {
  return (
    <svg viewBox="0 0 140 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon
        points="70,10 105,30 105,70 70,90 35,70 35,30"
        stroke="white"
        strokeOpacity="0.22"
        strokeWidth="2"
      />
      <line x1="70" y1="18" x2="70" y2="82" stroke="white" strokeOpacity="0.14" strokeWidth="1.5" />
      <line x1="35" y1="30" x2="10" y2="15" stroke="white" strokeOpacity="0.22" strokeWidth="2" />
      <line x1="105" y1="30" x2="130" y2="15" stroke="white" strokeOpacity="0.22" strokeWidth="2" />
      <line x1="35" y1="70" x2="10" y2="88" stroke="white" strokeOpacity="0.22" strokeWidth="2" />
      <line x1="105" y1="70" x2="118" y2="95" stroke="white" strokeOpacity="0.22" strokeWidth="2" />
      <text x="0" y="12" fill="white" fillOpacity="0.3" fontSize="12" fontFamily="sans-serif">
        OH
      </text>
      <text x="122" y="12" fill="white" fillOpacity="0.3" fontSize="12" fontFamily="sans-serif">
        H
      </text>
      <text x="0" y="98" fill="white" fillOpacity="0.3" fontSize="12" fontFamily="sans-serif">
        OH
      </text>
      <text x="108" y="112" fill="white" fillOpacity="0.3" fontSize="12" fontFamily="sans-serif">
        Cl
      </text>
    </svg>
  );
}

/** Molekul rantai ganda (2 cincin benzena menyatu, ala naftalena) -- varian
 * "lebih ramai" dari MoleculeMotif, dipakai berselang-seling supaya field
 * molekulnya tidak keliatan copy-paste satu bentuk yg sama terus. */
function MoleculeFused() {
  return (
    <svg viewBox="0 0 220 130" fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="70,15 105,35 105,75 70,95 35,75 35,35" stroke="white" strokeOpacity="0.22" strokeWidth="2" />
      <polygon points="105,35 140,15 175,35 175,75 140,95 105,75" stroke="white" strokeOpacity="0.22" strokeWidth="2" />
      <line x1="70" y1="23" x2="70" y2="87" stroke="white" strokeOpacity="0.13" strokeWidth="1.5" />
      <line x1="140" y1="23" x2="140" y2="87" stroke="white" strokeOpacity="0.13" strokeWidth="1.5" />
      <line x1="35" y1="35" x2="10" y2="20" stroke="white" strokeOpacity="0.22" strokeWidth="2" />
      <line x1="35" y1="75" x2="10" y2="92" stroke="white" strokeOpacity="0.22" strokeWidth="2" />
      <line x1="175" y1="35" x2="200" y2="20" stroke="white" strokeOpacity="0.22" strokeWidth="2" />
      <line x1="175" y1="75" x2="200" y2="92" stroke="white" strokeOpacity="0.22" strokeWidth="2" />
      <line x1="70" y1="15" x2="70" y2="0" stroke="white" strokeOpacity="0.22" strokeWidth="2" />
      {[
        [0, 17, "OH"],
        [0, 108, "OH"],
        [196, 17, "N"],
        [200, 112, "Cl"],
        [58, -3, "H"],
        [92, 122, "F"],
      ].map(([x, y, label], i) => (
        <text key={i} x={x as number} y={y as number} fill="white" fillOpacity="0.32" fontSize="13" fontFamily="sans-serif">
          {label}
        </text>
      ))}
    </svg>
  );
}

/** Ikon atom sederhana (inti + 3 orbit elips) -- aksen "science" tambahan,
 * meniru ikon atom kecil di kiri-tengah pada gambar referensi. */
function AtomIcon() {
  return (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="7" fill="white" fillOpacity="0.35" />
      <ellipse cx="50" cy="50" rx="44" ry="18" stroke="white" strokeOpacity="0.25" strokeWidth="1.5" />
      <ellipse
        cx="50"
        cy="50"
        rx="44"
        ry="18"
        stroke="white"
        strokeOpacity="0.25"
        strokeWidth="1.5"
        transform="rotate(60 50 50)"
      />
      <ellipse
        cx="50"
        cy="50"
        rx="44"
        ry="18"
        stroke="white"
        strokeOpacity="0.25"
        strokeWidth="1.5"
        transform="rotate(120 50 50)"
      />
      <circle cx="94" cy="50" r="3.5" fill="white" fillOpacity="0.4" />
      <circle cx="27" cy="18" r="3.5" fill="white" fillOpacity="0.4" />
      <circle cx="27" cy="82" r="3.5" fill="white" fillOpacity="0.4" />
    </svg>
  );
}

/** Siluet gedung kota kecil di pojok kanan-bawah -- sentuhan "kota/industri"
 * spt di gambar referensi, dibuat sesederhana mungkin (kotak-kotak). */
function CitySkyline() {
  const buildings: Array<[number, number, number, number]> = [
    [0, 40, 22, 60],
    [26, 20, 20, 80],
    [50, 55, 18, 45],
    [72, 5, 24, 95],
    [100, 35, 20, 65],
    [124, 48, 16, 52],
  ];
  return (
    <svg viewBox="0 0 150 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      {buildings.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill="white" fillOpacity="0.14" />
      ))}
      {buildings.map(([x, y, w], i) =>
        [0, 1, 2].map((row) => (
          <rect key={`${i}-${row}`} x={x + w / 2 - 2} y={y + 10 + row * 16} width="4" height="4" fill="white" fillOpacity="0.28" />
        )),
      )}
    </svg>
  );
}

/** Titik-titik "jaringan" merah menyala + garis penghubung, ditambah lengkung
 * sinyal wifi -- unsur "digital" spt di kanan-bawah gambar referensi. */
function NetworkNodes() {
  const nodes: Array<[number, number, number]> = [
    [10, 60, 3],
    [55, 20, 4],
    [95, 45, 3],
    [130, 15, 5],
    [150, 70, 3],
    [70, 85, 3],
  ];
  return (
    <svg viewBox="0 0 160 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#fecaca" strokeOpacity="0.35" strokeWidth="1">
        <line x1="10" y1="60" x2="55" y2="20" />
        <line x1="55" y1="20" x2="95" y2="45" />
        <line x1="95" y1="45" x2="130" y2="15" />
        <line x1="95" y1="45" x2="70" y2="85" />
        <line x1="130" y1="15" x2="150" y2="70" />
      </g>
      {nodes.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#fca5a5" fillOpacity="0.55" />
      ))}
      <g stroke="white" strokeOpacity="0.3" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M120,60 a14,14 0 0 1 20,0" />
        <path d="M124,64 a8,8 0 0 1 12,0" />
      </g>
    </svg>
  );
}

/** Garis "bintang jatuh" tipis -- aksen dekoratif kecil yang tersebar di
 * bagian atas layar, meniru guratan comet di gambar referensi. */
function ShootingStar() {
  return (
    <svg viewBox="0 0 90 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="0" y1="18" x2="80" y2="2" stroke="white" strokeOpacity="0.35" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="84" cy="1" r="2.5" fill="white" fillOpacity="0.55" />
    </svg>
  );
}

/** Kepulan asap putih lembut di belakang kaleng semprot -- dibuat dari
 * beberapa goresan melengkung transparan supaya terkesan "berasap", bukan
 * cuma garis lurus spt versi SprayCan sebelumnya. */
function SmokeSwirl() {
  return (
    <svg viewBox="0 0 220 140" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10,110 C60,120 90,90 80,60 C72,36 40,34 40,14"
        stroke="white"
        strokeOpacity="0.16"
        strokeWidth="16"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M30,120 C90,130 130,95 115,60 C104,34 150,40 170,20"
        stroke="white"
        strokeOpacity="0.11"
        strokeWidth="22"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M60 6C30 6 8 26 8 52c0 16 12 26 26 26 6 0 8-4 8-8s-2-6-2-10c0-6 5-10 12-10h20c14 0 24-11 24-24C96 15 80 6 60 6z"
        fill="white"
        fillOpacity="0.92"
      />
      <circle cx="30" cy="60" r="7" fill="#7f1d1d" fillOpacity="0.28" />
      <circle cx="34" cy="26" r="6" fill="#ef4444" />
      <circle cx="54" cy="17" r="6" fill="#3b82f6" />
      <circle cx="75" cy="24" r="6" fill="#1e293b" />
      <circle cx="19" cy="43" r="6" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />
      <rect x="88" y="8" width="11" height="42" rx="5.5" fill="white" stroke="#cbd5e1" strokeWidth="1" />
      <rect x="90" y="32" width="7" height="15" rx="3.5" fill="#3b82f6" />
      <rect
        x="102"
        y="2"
        width="11"
        height="42"
        rx="5.5"
        fill="white"
        stroke="#cbd5e1"
        strokeWidth="1"
        transform="rotate(14 107.5 23)"
      />
      <rect x="104" y="24" width="7" height="15" rx="3.5" fill="#ef4444" transform="rotate(14 107.5 31.5)" />
    </svg>
  );
}

function SprayCan() {
  return (
    <svg viewBox="0 0 70 130" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="30" width="40" height="90" rx="10" fill="white" fillOpacity="0.28" />
      <rect x="24" y="14" width="22" height="18" rx="4" fill="white" fillOpacity="0.32" />
      <rect x="30" y="4" width="10" height="12" rx="2" fill="white" fillOpacity="0.35" />
      <g stroke="white" strokeOpacity="0.28" strokeWidth="2.5" strokeLinecap="round">
        <line x1="46" y1="8" x2="62" y2="-4" />
        <line x1="49" y1="16" x2="68" y2="10" />
        <line x1="43" y1="2" x2="52" y2="-12" />
      </g>
    </svg>
  );
}

/** Titik-titik cipratan cat kecil (splatter), ukuran acak, buat mengisi area
 * kosong di sekitar splash besar spy lebih terasa "kena percik cat". */
function PaintSplatter() {
  const dots: Array<[number, number, number, number]> = [
    [0, 10, 7, 0.5],
    [18, 0, 4, 0.4],
    [30, 18, 5, 0.35],
    [10, 30, 3, 0.4],
    [40, 6, 3, 0.3],
  ];
  return (
    <svg viewBox="0 0 60 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      {dots.map(([x, y, r, o], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#fecaca" fillOpacity={o} />
      ))}
    </svg>
  );
}

function LoginDecor() {
  return (
    <div className="login-decor" aria-hidden="true">
      <div className="decor-splatter" style={{ left: "22%", top: "4%", width: 90, transform: "rotate(20deg)" }}>
        <PaintSplatter />
      </div>
      <div className="decor-splatter" style={{ right: "20%", top: "12%", width: 70, transform: "rotate(-30deg)" }}>
        <PaintSplatter />
      </div>
      <div className="decor-splatter" style={{ left: "18%", bottom: "14%", width: 80, transform: "rotate(-15deg)" }}>
        <PaintSplatter />
      </div>
      <div className="decor-splatter" style={{ right: "24%", bottom: "6%", width: 100, transform: "rotate(40deg)" }}>
        <PaintSplatter />
      </div>

      <div className="decor-molecule" style={{ left: "1%", top: "3%", width: 220 }}>
        <MoleculeFused />
      </div>
      <div className="decor-molecule" style={{ left: "0%", top: "40%", width: 160, transform: "rotate(-8deg)" }}>
        <MoleculeMotif />
      </div>
      <div className="decor-molecule" style={{ left: "6%", top: "62%", width: 150, transform: "rotate(6deg)" }}>
        <MoleculeFused />
      </div>
      <div className="decor-molecule" style={{ right: "2%", top: "4%", width: 190, transform: "rotate(8deg)" }}>
        <MoleculeMotif />
      </div>
      <div className="decor-molecule" style={{ right: "0%", top: "30%", width: 170, transform: "rotate(-10deg)" }}>
        <MoleculeFused />
      </div>
      <div className="decor-molecule" style={{ right: "3%", bottom: "6%", width: 210, transform: "rotate(-6deg)" }}>
        <MoleculeMotif />
      </div>
      <div className="decor-molecule" style={{ left: "24%", bottom: "2%", width: 150, transform: "rotate(5deg)" }}>
        <MoleculeMotif />
      </div>

      <div className="decor-atom" style={{ left: "12%", top: "38%", width: 90 }}>
        <AtomIcon />
      </div>

      <div className="decor-city" style={{ right: "2%", bottom: "0%", width: 220 }}>
        <CitySkyline />
      </div>

      <div className="decor-network" style={{ right: "4%", bottom: "14%", width: 220 }}>
        <NetworkNodes />
      </div>

      <div className="decor-star" style={{ left: "20%", top: "10%", width: 90, transform: "rotate(10deg)" }}>
        <ShootingStar />
      </div>
      <div className="decor-star" style={{ left: "42%", top: "3%", width: 70, transform: "rotate(6deg)" }}>
        <ShootingStar />
      </div>

      <div className="decor-smoke" style={{ right: "5%", top: "2%", width: 260 }}>
        <SmokeSwirl />
      </div>

      <div className="decor-spray" style={{ right: "9%", top: "9%", width: 70, transform: "rotate(14deg)" }}>
        <SprayCan />
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { user, login, forcedLogoutMessage, clearForcedLogoutMessage } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [nik, setNik] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  /** Terisi kalau NIK ini masih py sesi aktif di perangkat/browser lain (409
   * dari POST /auth/login) -- ganti tombol Login biasa dgn konfirmasi
   * Lanjutkan/Batal (2026-08-08, instruksi eksplisit user: 1 NIK cuma 1 sesi
   * aktif, spt SAP, tapi user KEDUA harus diberi tahu dulu supaya bisa
   * koordinasi, bukan langsung nendang diam-diam). */
  const [conflictMessage, setConflictMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** Pesan sekali-tampil kalau SESI INI SENDIRI baru saja ke-logout otomatis
   * (mis. ada yg login pakai NIK yg sama di tempat lain) -- disalin dari
   * AuthContext.forcedLogoutMessage lalu context-nya langsung dikosongkan
   * (consume-once), supaya banner ini tidak muncul lagi di kunjungan berikutnya. */
  const [loggedOutNotice, setLoggedOutNotice] = useState("");

  useEffect(() => {
    if (forcedLogoutMessage) {
      setLoggedOutNotice(forcedLogoutMessage);
      clearForcedLogoutMessage();
    }
  }, [forcedLogoutMessage, clearForcedLogoutMessage]);

  useEffect(() => {
    if (user) {
      const redirectTo = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(redirectTo, { replace: true });
    }
  }, [user, navigate, location.state]);

  useEffect(() => {
    const nikTrimmed = nik.trim();
    if (!nikTrimmed) {
      setName("");
      return;
    }
    const timeout = setTimeout(() => {
      api
        .get<{ success: boolean; name?: string }>(`/auth/lookup/${encodeURIComponent(nikTrimmed)}`)
        .then((res) => setName(res.success ? res.name ?? "" : ""))
        .catch(() => setName(""));
    }, 350);
    return () => clearTimeout(timeout);
  }, [nik]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setConflictMessage("");
    setSubmitting(true);
    try {
      await login(nik.trim(), password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictMessage(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Login gagal.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForceLogin() {
    setError("");
    setSubmitting(true);
    try {
      await login(nik.trim(), password, true);
      setConflictMessage("");
    } catch (err) {
      setConflictMessage("");
      setError(err instanceof ApiError ? err.message : "Login gagal.");
    } finally {
      setSubmitting(false);
    }
  }

  const bgVideoRef = useRef<HTMLVideoElement>(null);

  /** Ganti `key` div logo tiap 15 menit (2026-08-29, permintaan eksplisit
   * user) supaya React unmount+remount elemennya -- ini yang bikin animasi
   * CSS logoIconReveal/logoTextReveal (yg didesain sekali-jalan pas mount,
   * lihat app.css) terputar ulang secara berkala, bukan cuma sekali pas
   * halaman login pertama dibuka. */
  const [logoAnimKey, setLogoAnimKey] = useState(0);
  useEffect(() => {
    const REPLAY_INTERVAL_MS = 15 * 60 * 1000;
    const id = setInterval(() => setLogoAnimKey((k) => k + 1), REPLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  /** Video sengaja TIDAK loop terus-menerus (2026-08-29, permintaan
   * eksplisit user: disamakan spt animasi logo di atas -- main sekali lalu
   * diam, baru diulang tiap 15 menit, drpd looping non-stop tiap 5 detik
   * yg dirasa "berlebihan" kalau halaman login dibiarkan terbuka lama).
   * Video main sekali di awal (attribute `loop` DICABUT dari <video>).
   * Beda dari versi awal (yg cuma diam di frame terakhir sampai replay
   * berikutnya): user minta videonya "pelan-pelan terhapus" balik ke
   * background merah polos begitu selesai, BUKAN nyangkut nampilin frame
   * terakhir terus -- jadi begitu event `ended` nembak, opacity di-fade ke
   * 0 (pelan, FADE_MS lumayan lama) sampai background merah `.login-page`
   * di bawahnya kelihatan lagi. Pas REPLAY_INTERVAL_MS nembak, currentTime
   * direset ke 0 + play() lagi SAMBIL opacity di-fade balik ke 1 (video
   * "pelan-pelan muncul kembali" berbarengan sama animasinya mulai jalan
   * lagi dari awal). */
  useEffect(() => {
    const video = bgVideoRef.current;
    if (!video) return;
    // Video aslinya kerasa cepat (2026-08-29, keluhan eksplisit user) --
    // diperlambat murni lewat playbackRate (bukan render ulang videonya).
    // Di-set ulang tiap "loadedmetadata" krn beberapa browser reset
    // playbackRate ke 1 pas source baru dimuat.
    const PLAYBACK_RATE = 0.4;
    const REPLAY_INTERVAL_MS = 15 * 60 * 1000;
    const FADE_MS = 2000;

    const applyPlaybackRate = () => {
      video.playbackRate = PLAYBACK_RATE;
    };
    applyPlaybackRate();
    video.addEventListener("loadedmetadata", applyPlaybackRate);

    video.style.transition = `opacity ${FADE_MS}ms ease`;

    const handleEnded = () => {
      video.style.opacity = "0";
    };
    video.addEventListener("ended", handleEnded);

    const replay = () => {
      video.currentTime = 0;
      void video.play();
      video.style.opacity = "1";
    };

    const id = setInterval(replay, REPLAY_INTERVAL_MS);
    return () => {
      clearInterval(id);
      video.removeEventListener("loadedmetadata", applyPlaybackRate);
      video.removeEventListener("ended", handleEnded);
    };
  }, []);

  return (
    <div className="login-page">
      {/* Video animasi tetesan cat merah-biru (2026-08-29, file dikirim user)
          -- muted+autoPlay+playsInline wajib supaya autoplay diizinkan
          browser tanpa interaksi user dulu. TANPA attribute `loop` (lihat
          useEffect di atas) -- main sekali lalu diam, diulang tiap 15 menit
          lewat JS, bukan looping non-stop. */}
      <video ref={bgVideoRef} className="login-bg-video" src="/login-bg.mp4" autoPlay muted playsInline />

      <LoginDecor />

      <div className="login-card-wrap">
        <div className="login-card-palette login-card-palette-top">
          <PaletteIcon />
        </div>
        <div className="login-card-palette login-card-palette-bottom">
          <PaletteIcon />
        </div>

        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-card-header">
            <div className="login-logo" key={logoAnimKey}>
              <img src="/brand-logo-icon.png" alt="" aria-hidden="true" className="login-logo-icon" />
              <img src="/brand-logo-text.png" alt="Websiteapp Npi" className="login-logo-text" />
            </div>
            <p className="welcome">Selamat Datang</p>
            <p className="subtitle">Silakan Masuk ke Akun Anda</p>
          </div>

          <div className="login-card-body">
            {loggedOutNotice && <p className="status-text">{loggedOutNotice}</p>}

            <div className="field">
              <div className="login-field">
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M10 2a4 4 0 100 8 4 4 0 000-8zM3 17a7 7 0 0114 0v.5a.5.5 0 01-.5.5h-13a.5.5 0 01-.5-.5V17z" />
                </svg>
                <label htmlFor="nik" className="sr-only">
                  NIK
                </label>
                <input
                  id="nik"
                  placeholder="NIK :"
                  value={nik}
                  onChange={(e) => {
                    setNik(e.target.value);
                    setConflictMessage("");
                  }}
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className="field">
              <div className="login-field">
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M10 2a4 4 0 100 8 4 4 0 000-8zM3 17a7 7 0 0114 0v.5a.5.5 0 01-.5.5h-13a.5.5 0 01-.5-.5V17z" />
                </svg>
                <label className="sr-only">Nama Karyawan</label>
                <input value={name} readOnly placeholder="NAMA KARYAWAN :" />
              </div>
            </div>

            <div className="field">
              <div className="login-field">
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M5 8V6a5 5 0 0110 0v2h.5a1.5 1.5 0 011.5 1.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 16.5v-7A1.5 1.5 0 014.5 8H5zm2 0h6V6a3 3 0 00-6 0v2z"
                    clipRule="evenodd"
                  />
                </svg>
                <label htmlFor="password" className="sr-only">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  placeholder="PASSWORD :"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setConflictMessage("");
                  }}
                  required
                />
              </div>
            </div>

            <a className="login-forgot" href="mailto:teguh.agri@nipseapaint.com?subject=Lupa%20Kata%20Sandi">
              Lupa Kata Sandi?
            </a>

            {error && <p className="error-text">{error}</p>}

            {conflictMessage ? (
              <div className="field" style={{ gap: 8, display: "flex", flexDirection: "column" }}>
                <p className="error-text" style={{ margin: 0 }}>
                  {conflictMessage}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" type="button" disabled={submitting} onClick={handleForceLogin}>
                    {submitting ? "Memproses..." : "Lanjutkan Login"}
                  </button>
                  <button
                    className="btn btn-outline"
                    type="button"
                    disabled={submitting}
                    onClick={() => setConflictMessage("")}
                  >
                    Batal
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn" type="submit" disabled={submitting}>
                {submitting ? "Memproses..." : "MASUK"}
              </button>
            )}

            <p className="login-contact">
              Untuk permintaan akses silahkan hubungi email{" "}
              <a href="mailto:teguh.agri@nipseapaint.com">teguh.agri@nipseapaint.com</a>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
