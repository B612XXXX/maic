'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Gavel, Loader2 } from 'lucide-react';
import { useStageStore } from '@/lib/store';
import { isCourtroomPracticeId, type CourtroomOffer } from '@/lib/legal/courtroom';

export function CourtroomOfferCard({ offer }: { offer: CourtroomOffer }) {
  const router = useRouter();
  const stageId = useStageStore((state) => state.stage?.id);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!stageId || !isCourtroomPracticeId(offer.caseId)) return null;
  const openPractice = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch('/api/pbl/v2/courtroom-practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...offer, sourceStageId: stageId }),
      });
      const { classroomUrl } = await response.json();
      if (
        !response.ok ||
        typeof classroomUrl !== 'string' ||
        !/^\/classroom\/stage-courtroom-[a-f0-9]{24}$/.test(classroomUrl)
      )
        throw new Error('Invalid practice response');
      router.push(classroomUrl);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <div className="mt-1.5 max-w-xs self-start rounded-lg border border-violet-300/35 bg-violet-500/5 px-3 py-2 text-xs">
      <p className="font-medium">{offer.topic} · 模拟法庭短练</p>
      <p className="mt-0.5 text-muted-foreground">一个争点，约 2–5 分钟。可以继续当前问答。</p>
      <button
        type="button"
        onClick={() => void openPractice()}
        disabled={pending}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium hover:bg-muted disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Gavel className="size-3.5" />}
        {pending ? '正在打开…' : failed ? '重试短练' : '开始短练'}
      </button>
      {failed && (
        <p className="mt-1 text-destructive" role="status">
          短练暂未打开，原问答可以继续。
        </p>
      )}
    </div>
  );
}
