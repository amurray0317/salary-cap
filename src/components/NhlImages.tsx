"use client";

import { useState } from "react";
import { headshotUrl, teamLogoUrl } from "@/lib/nhlImages";
import { initials } from "@/components/Avatar";

/** Team logo; falls back to the tri-code if the image is missing (e.g. a defunct club). */
export function TeamLogo({ team, size = 24, className = "" }: { team: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = teamLogoUrl(team);
  if (!src || failed)
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.34)) }}
        className={`inline-flex shrink-0 items-center justify-center rounded-md bg-track font-bold text-ink-secondary ${className}`}
      >
        {team.slice(0, 3)}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external SVG from the NHL CDN
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`inline-block shrink-0 ${className}`}
    />
  );
}

/** Player headshot in a circle; initials when there is no NHL photo. */
export function PlayerPhoto({
  playerId,
  name,
  size = 40,
  className = "",
}: {
  playerId: string | number | null | undefined;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = headshotUrl(playerId);
  if (!src || failed)
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-accent-soft to-track font-display font-bold text-accent-text ${className}`}
      >
        {initials(name)}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external PNG from the NHL CDN
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-full bg-subtle object-cover object-top ring-1 ring-line ${className}`}
    />
  );
}
