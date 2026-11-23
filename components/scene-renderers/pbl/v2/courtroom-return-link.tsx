import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export function CourtroomReturnLink({ stageId }: { stageId?: string }) {
  if (typeof stageId !== 'string' || !/^[\w-]{1,140}$/.test(stageId)) return null;
  return (
    <Link
      href={`/classroom/${stageId}`}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
    >
      <ArrowLeft className="size-3.5" /> 返回原课堂
    </Link>
  );
}
