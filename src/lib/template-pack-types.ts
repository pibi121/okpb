export type PublicTemplateFrame = {
  id: string;
  index: number;
  title: string;
  beat: string;
  never: string;
  stillPrompt: string;
  videoPrompt: string;
  dialogue: string;
  durationSec: number;
  poseId: string | null;
  stillItemId: string | null;
  clipItemId: string | null;
  status: string;
  stillFailNote: string;
  videoFailNote: string;
  /** 0 = first character only, 1 = second only, null = all */
  soloCharacterIndex: number | null;
  /** Characters are clothed in this frame */
  clothed: boolean;
  stillUrl: string | null;
  clipUrl: string | null;
  stillError: string | null;
  clipError: string | null;
  stillStatus: "none" | "pending" | "ready" | "error";
  clipStatus: "none" | "pending" | "ready" | "error";
};

export type PublicTemplatePack = {
  id: string;
  title: string;
  idea: string;
  tags: string[];
  characterIds: string[];
  /** Names for slot 1 / slot 2 — order is the order people pick when using the template */
  characterSlots: Array<{ id: string; name: string; gender: string }>;
  locationNote: string;
  status: "assembling" | "published";
  searchText: string;
  coverStillUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  frames: PublicTemplateFrame[];
  frameCount: number;
  approvedCount: number;
  stitchItemId: string | null;
  stitchUrl: string | null;
  stitchStatus: "none" | "pending" | "ready" | "error";
  stitchError: string | null;
};

export type TemplatePackSummary = {
  id: string;
  title: string;
  status: string;
  frameCount: number;
  approvedCount: number;
  coverStillUrl: string | null;
  updatedAt: string;
  characterSlots: Array<{ id: string; name: string; gender: string }>;
};
