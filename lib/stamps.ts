export interface StampPreset {
  id: string;
  label: string;
  text: string;
}

export const stampPresets: StampPreset[] = [
  {
    id: "true-copy",
    label: "與正本相符",
    text: "本影本與正本相符，如有不實願負法律責任",
  },
  {
    id: "application-only",
    label: "僅供申辦",
    text: "僅供申辦 XXX 使用",
  },
  {
    id: "archive-only",
    label: "僅供存查",
    text: "僅供存查",
  },
  {
    id: "void",
    label: "作廢",
    text: "作廢",
  },
];
