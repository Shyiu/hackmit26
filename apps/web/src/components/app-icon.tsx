// The app mark: a location ring on black. Drawn with ImageResponse so every
// size comes from one source and no binary icons live in the repo.
export function AppIcon({ size, padding = 0 }: { size: number; padding?: number }) {
  const inner = size - padding * 2;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000000",
      }}
    >
      <div
        style={{
          width: inner * 0.56,
          height: inner * 0.56,
          borderRadius: "50%",
          border: `${inner * 0.07}px solid #fde047`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: inner * 0.16, height: inner * 0.16, borderRadius: "50%", background: "#ffffff" }} />
      </div>
    </div>
  );
}
