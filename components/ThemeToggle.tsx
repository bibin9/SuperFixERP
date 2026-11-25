"use client";
import { useState } from "react";

type Mode = "light" | "dark" | "auto";
const NEXT: Record<Mode, Mode> = { light: "dark", dark: "auto", auto: "light" };
const ICON: Record<Mode, string> = { light: "☀", dark: "☾", auto: "◐" };
const NAME: Record<Mode, string> = { light: "Day mode", dark: "Night mode", auto: "Automatic (follows this device)" };

/** Day, night or automatic for this device only. Remembered for a year. */
export function ThemeToggle({ initial }: { initial: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const change = () => {
    const m = NEXT[mode];
    setMode(m);
    document.documentElement.dataset.theme = m;
    document.cookie = `theme=${m}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <button type="button" className="themebtn" onClick={change} title={`${NAME[mode]}. Click to change.`} aria-label={`${NAME[mode]}. Click to switch to ${NAME[NEXT[mode]].toLowerCase()}.`}>
      <span aria-hidden>{ICON[mode]}</span>
    </button>
  );
}
