/** Saved / error banner driven by ?saved= and ?error= after a form redirect. */
export function Notice({ saved, error }: { saved?: string; error?: string }) {
  if (error)
    return (
      <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
        {error}
      </p>
    );
  if (saved)
    return (
      <p role="status" className="rounded-md border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
        {saved}
      </p>
    );
  return null;
}
