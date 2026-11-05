import { IdeWorkspace } from "@/components/ide/ide-workspace";

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <IdeWorkspace sessionId={sessionId} />;
}
