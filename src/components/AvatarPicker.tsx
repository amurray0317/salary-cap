"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { uploadAvatarAction } from "@/server/actions/profileActions";

const SIZE = 256;

/** Center-crops and resizes to 256×256 in the browser, so only a small image is uploaded. */
async function resize(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.88));
  if (!blob) throw new Error("Could not encode the image");
  return blob;
}

export function AvatarPicker({ hasPhoto }: { hasPhoto: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) return setError("Choose an image file");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("avatar", await resize(file), "avatar.jpg");
      const res = await uploadAvatarAction(fd);
      if (res.error) setError(res.error);
      else router.refresh();
    } catch {
      setError("That image could not be read. Try a PNG or JPEG.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div>
      <input ref={input} type="file" accept="image/*" className="sr-only" id="avatar-file" onChange={(e) => onPick(e.target.files?.[0])} />
      <label
        htmlFor="avatar-file"
        className={`inline-block cursor-pointer rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        {busy ? "Uploading…" : hasPhoto ? "Change photo" : "Upload photo"}
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-critical">
          {error}
        </p>
      )}
    </div>
  );
}
