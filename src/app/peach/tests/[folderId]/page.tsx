import { requireUser } from "@/lib/auth";
import { notFound } from "next/navigation";
import { TestGalleryFolderView } from "@/components/test-gallery-folder";
import {
  getTestGalleryFolder,
  summarizePoseRatings,
} from "@/lib/test-gallery";

export default async function PeachTestFolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const user = await requireUser();
  if (!user) return null;
  const { folderId } = await params;
  const folder = await getTestGalleryFolder(user.id, folderId);
  if (!folder) notFound();

  return (
    <TestGalleryFolderView
      initialFolder={folder}
      initialSummary={summarizePoseRatings(folder.shots)}
    />
  );
}
