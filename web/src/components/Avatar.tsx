import { fileUrl } from "../api/client";

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function Avatar({
  name,
  avatarPath,
  size = 36,
}: {
  name: string;
  avatarPath: string | null;
  size?: number;
}) {
  if (avatarPath) {
    return (
      <img
        src={fileUrl(avatarPath)}
        alt={name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#ffe4e6",
        color: "#9f1239",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: Math.round(size * 0.4),
        flexShrink: 0,
      }}
    >
      {initialsOf(name || "?")}
    </div>
  );
}
