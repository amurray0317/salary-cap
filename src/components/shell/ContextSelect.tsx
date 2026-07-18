"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";

/** Auto-submitting select bound to the setContext server action. */
export function ContextSelect({
  name,
  label,
  value,
  options,
  action,
}: {
  name: string;
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  action: (formData: FormData) => Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const pathname = usePathname();
  return (
    <form ref={formRef} action={action} className="inline-block">
      <input type="hidden" name="back" value={pathname} />
      <label className="sr-only" htmlFor={`ctx-${name}`}>
        {label}
      </label>
      <select
        id={`ctx-${name}`}
        name={name}
        defaultValue={value}
        onChange={() => formRef.current?.requestSubmit()}
        className="max-w-44 truncate rounded-md border border-line bg-navy-900 px-2 py-1.5 text-sm text-ink-secondary hover:text-ink focus:border-accent focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}
