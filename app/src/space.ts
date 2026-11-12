// `space [folder]`: what takes up the disk there.
export function humanSize(n: number): string {
  for (const unit of ["B", "KB", "MB", "GB", "TB"]) {
    if (n < 1024 || unit === "TB") return unit === "B" ? `${Math.round(n)} B` : `${n.toFixed(1)} ${unit}`;
    n /= 1024;
  }
  return "";
}
