"use client";

import { SocialTemplateLab } from "@/components/social-template-lab";

type Character = { id: string; name: string };

export function SocialHub({ characters }: { characters: Character[] }) {
  return <SocialTemplateLab characters={characters} />;
}
