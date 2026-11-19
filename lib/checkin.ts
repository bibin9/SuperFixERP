/** Car diagram zones and damage kinds for the check-in record (shared by the page and the server). */
export const ZONES: [id: string, label: string, path: string][] = [
  ["front", "Front bumper", "M80 14 h160 v40 h-160z"],
  ["bonnet", "Bonnet", "M90 60 h140 v70 h-140z"],
  ["lf", "Left front door and wing", "M36 70 h48 v88 h-48z"],
  ["rf", "Right front door and wing", "M236 70 h48 v88 h-48z"],
  ["windscreen", "Windscreen", "M96 134 h128 v18 h-128z"],
  ["roof", "Roof", "M90 156 h140 v84 h-140z"],
  ["lr", "Left rear door and wing", "M36 164 h48 v88 h-48z"],
  ["rr", "Right rear door and wing", "M236 164 h48 v88 h-48z"],
  ["boot", "Boot", "M90 244 h140 v48 h-140z"],
  ["rear", "Rear bumper", "M80 296 h160 v38 h-160z"],
];
export const KINDS: [id: string, label: string][] = [["scratch", "Scratch"], ["dent", "Dent"], ["broken", "Broken or cracked"]];
export const PHOTO_LABELS = ["Front", "Rear", "Left side", "Right side", "Odometer", "Damage", "Interior", "Other"];
export type Mark = { z: string; k: string };
