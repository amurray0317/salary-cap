import { getSessionUser } from "@/lib/auth/session";
import { readAvatar } from "@/server/services/profileService";

/** A member's profile photo; visible to the member and to people who share an organization with them. */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }): Promise<Response> {
  const viewer = await getSessionUser();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return new Response("Not found", { status: 404 });
  const avatar = await readAvatar(viewer.id, userId);
  if (!avatar) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(avatar.bytes), {
    headers: {
      "Content-Type": avatar.mime,
      // The URL carries ?v=<updated time>, so a new photo gets a new URL.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
