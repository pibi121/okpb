export type PlayStep = "characters" | "stills" | "animate" | "done";

export type PublicPlayFrame = {
  id: string;
  templateFrameId: string;
  index: number;
  title: string;
  beat: string;
  never: string;
  scenePrompt: string;
  durationSec: number;
  poseId: string | null;
  /** 0 = first character only, 1 = second only, null = all */
  soloCharacterIndex: number | null;
  /** Characters are clothed in this frame */
  clothed: boolean;
  stillItemId: string | null;
  clipItemId: string | null;
  videoNote: string;
  dialogue: string;
  videoPrompt: string;
  stillUrl: string | null;
  clipUrl: string | null;
  stillError: string | null;
  clipError: string | null;
  stillStatus: "none" | "pending" | "ready" | "error";
  clipStatus: "none" | "pending" | "ready" | "error";
};

export type PublicPlayRun = {
  id: string;
  packId: string;
  packTitle: string;
  packIdea: string;
  packCover: string | null;
  step: PlayStep;
  characterIds: string[];
  suggestedCount: number;
  /** Template role names: slot 1 / slot 2 */
  characterSlots: Array<{ id: string; name: string; gender: string }>;
  frames: PublicPlayFrame[];
  createdAt: string;
  updatedAt: string;
};

export type PlayablePackSummary = {
  id: string;
  title: string;
  status: string;
  frameCount: number;
  coverStillUrl: string | null;
  idea: string;
};
