/** A member's photo, or their initials on the brand gradient when there is none. */
export function avatarUrl(user: { id: string; avatarUpdatedAt: Date | null }): string | null {
  return user.avatarUpdatedAt ? `/api/avatar/${user.id}?v=${user.avatarUpdatedAt.getTime()}` : null;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function Avatar({ name, src, size = 32, className = "" }: { name: string; src: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- small authenticated image; next/image adds nothing here
    <img src={src} alt="" width={size} height={size} style={style} className={`shrink-0 rounded-full object-cover ring-2 ring-white ${className}`} />
  ) : (
    <span
      aria-hidden
      style={style}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-accent to-accent-2 font-display font-extrabold text-white ring-2 ring-white ${className}`}
    >
      {initials(name)}
    </span>
  );
}
