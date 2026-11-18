"use client";
import { useEffect } from "react";

const MAX = 5 * 1024 * 1024;

/**
 * FILE-01: a file over 5 MB is refused as soon as it is chosen, with a message under the field,
 * instead of the upload failing on the server. The server checks the same limit again.
 */
export function FileSizeGuard() {
  useEffect(() => {
    const onChange = (ev: Event) => {
      const input = ev.target as HTMLInputElement;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const big = [...(input.files ?? [])].find((f) => f.size > MAX);
      let note = input.parentElement?.querySelector<HTMLElement>(".file-too-big");
      if (!big) { note?.remove(); input.setCustomValidity(""); return; }
      input.value = "";
      if (!note) {
        note = document.createElement("div");
        note.className = "file-too-big small";
        note.style.color = "var(--late)";
        note.setAttribute("role", "alert");
        input.insertAdjacentElement("afterend", note);
      }
      note.textContent = `${big.name} is ${(big.size / 1024 / 1024).toFixed(1)} MB. Files can be up to 5 MB: choose a smaller file or a lower-resolution photo.`;
    };
    document.addEventListener("change", onChange, true);
    return () => document.removeEventListener("change", onChange, true);
  }, []);
  return null;
}
