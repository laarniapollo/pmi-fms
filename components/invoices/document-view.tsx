"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

/**
 * The uploaded document, shown in place beneath the scan band.
 *
 * This is the control that replaced the mandatory review screen. That screen
 * listed what had been read with no way to correct any of it, which invited
 * rubber-stamping; the document itself, one toggle away from the fields it
 * filled, is the thing a person can actually check a figure against.
 *
 * The object URL is created in an effect and revoked when it changes or the
 * component unmounts. The flow this replaces created object URLs in two places
 * and revoked neither, leaking a blob per scan for the life of the tab. That
 * bug went away with the code that held it; do not reintroduce it here.
 */
export function DocumentView({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!url) return null;

  if (file.type === "application/pdf") {
    return (
      /*
       * `<object>` rather than `<iframe>`: its children render as a fallback
       * when the browser has no PDF viewer, where an iframe would show an empty
       * box. Adding `sandbox` to an iframe also breaks Chrome's built-in
       * viewer outright, so there is no safer variant of the other option.
       */
      <object
        data={url}
        type="application/pdf"
        aria-label={`Uploaded document: ${file.name}`}
        className="h-[65vh] w-full rounded border border-line bg-surface-sunken"
      >
        <div className="flex flex-col items-center gap-2 p-8 text-center">
          <p className="text-sm text-ink-muted">This browser cannot display the PDF here.</p>
          <a
            href={url}
            download={file.name}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Open {file.name}
          </a>
        </div>
      </object>
    );
  }

  return (
    <div className="max-h-[65vh] overflow-auto rounded border border-line bg-surface-sunken">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`Uploaded document: ${file.name}`} className="w-full" />
    </div>
  );
}
