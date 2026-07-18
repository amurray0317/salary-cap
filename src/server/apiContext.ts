/**
 * Route-handler variant of the app context: same resolution as
 * resolveAppContext but returns null instead of redirecting, so API routes
 * can answer 401/404 properly.
 */
import "server-only";
import type { AppContext } from "./appContext";

export async function resolveApiContext(): Promise<AppContext | null> {
  try {
    const { resolveAppContext } = await import("./appContext");
    return await resolveAppContext();
  } catch {
    // next/navigation redirect() throws — treat as unauthenticated.
    return null;
  }
}
