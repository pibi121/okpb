export const STORY_GENRES = [
  { id: "chase", label: "Погоня / ужас" },
  { id: "delivery", label: "Доставка / дверь" },
  { id: "talk", label: "Разговор" },
  { id: "undress", label: "Раздевание" },
  { id: "sex", label: "Секс" },
  { id: "aftercare", label: "После" },
  { id: "other", label: "Другое" },
] as const;

export type PublicStoryBeat = {
  id: string;
  index: number;
  title: string;
  beat: string;
  never: string;
  isSex: boolean;
  poseId: string | null;
  stillPrompt: string;
  videoPrompt: string;
  stillItemId: string | null;
  clipItemId: string | null;
  stillStatus: string;
  videoStatus: string;
  stillFailNote: string;
  videoFailNote: string;
  stillUrl: string | null;
  clipUrl: string | null;
  stillError: string | null;
  clipError: string | null;
};

export type PublicStoryPack = {
  id: string;
  title: string;
  idea: string;
  genre: string;
  characterIds: string[];
  locationNote: string;
  styleId: string | null;
  status: string;
  error: string | null;
  currentBeatIndex: number;
  approvedBeats: number;
  beatCount: number;
  beats: PublicStoryBeat[];
  createdAt: string;
  updatedAt: string;
};
