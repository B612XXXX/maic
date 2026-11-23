'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import { BookOpen, FileText, Scale } from 'lucide-react';
import type { PBLProjectV2 } from '@/lib/pbl/v2/types';
import { PBL_SIMULATOR_AGENT_ID } from '@/lib/pbl/v2/operations/kernel/progress';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { stripEvaluationTail } from '@/lib/pbl/v2/operations/runtime/eval-tail-parser';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import background from '@/courtroom-scene/assets/courtroom-background-flat.png';
import { courtroomDocuments, courtroomSide, displayedMilestone } from './courtroom-state';
import { MarkdownText } from './markdown-text';
import { PBL_THEME } from './theme';
import styles from './courtroom.module.css';

export function Courtroom({
  project,
  busy,
  onBriefing,
}: {
  project: PBLProjectV2;
  busy: boolean;
  onBriefing: () => void;
}) {
  const avatar = useUserProfileStore((state) => state.avatar);
  const nickname = useUserProfileStore((state) => state.nickname);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const courtRef = useCallback((element: HTMLElement | null) => {
    if (element) setPortalHost(element.closest<HTMLElement>('[data-pbl-workspace="true"]'));
  }, []);
  const documents = courtroomDocuments(project);
  const selectedDocument = documents.find((document) => document.id === documentId);
  const side = courtroomSide(project);
  const character = project.scenario?.characters[0];
  const milestone = displayedMilestone(project);
  const messages =
    project.threads.find((thread) => thread.agentId === PBL_SIMULATOR_AGENT_ID)?.messages ?? [];
  const lastMessage = messages.findLast(
    (message) =>
      (message.roleType === 'user' || message.roleType === 'simulator') && message.content.trim(),
  );
  const handover = !!project.pendingHandover && !project.pendingHandover.consumed;
  const short = !!project.courtroomPractice;
  const userLabel =
    project.scenario?.learnerRole || (side === 'defendant' ? '被告代理人' : '原告代理人');
  const opponentLabel = short ? '模拟对手' : side === 'defendant' ? '原告代理人' : '被告代理人';
  const userX = side === 'defendant' ? 87 : 24;
  const opponentX = side === 'defendant' ? 24 : 87;
  const active = handover ? null : busy ? 'opponent' : 'user';
  const safeAvatar = (value: string | undefined, fallback: string) =>
    value && /^(\/|https?:\/\/|data:image\/|blob:)/i.test(value) ? value : fallback;

  return (
    <section
      ref={courtRef}
      className={styles.courtroom}
      aria-label="模拟法庭"
      data-testid="courtroom-workspace"
    >
      <div className={styles.heading}>
        <div className={styles.headingText}>
          <Scale size={16} />
          <span>模拟法庭</span>
          <span className={styles.separator}>/</span>
          <strong>{milestone?.title}</strong>
          {short && <small>教学短练 · 一名模拟对手</small>}
        </div>
        <span className={styles.speaker} aria-live="polite">
          {handover
            ? '本阶段已结束'
            : busy
              ? `${character?.name ?? opponentLabel} · 正在回应`
              : `轮到你 · ${userLabel}`}
        </span>
      </div>
      <div className={styles.viewport}>
        <div className={styles.canvas}>
          <Image
            src={background}
            alt="木质审判席、双方席位与旁听席"
            fill
            sizes="80vw"
            preload
            placeholder="blur"
            className={styles.background}
          />
          {!short && (
            <>
              <Seat label="审判员" x={40} y={12} />
              <Seat label="审判长" x={50} y={12} />
              <Seat label="人民陪审员" x={60} y={12} />
              <Seat label="书记员" x={83} y={22} />
              <Seat label="原告" x={13} y={43} />
              <Seat label="被告" x={76} y={43} />
            </>
          )}
          <Seat
            label={userLabel}
            name={nickname || '你'}
            avatar={safeAvatar(avatar, '/avatars/user.png')}
            x={userX}
            y={43}
            active={active === 'user'}
          />
          <Seat
            label={opponentLabel}
            name={character?.name ?? '模拟学生'}
            avatar={safeAvatar(character?.avatar, '/avatars/curious-2.png')}
            x={opponentX}
            y={43}
            active={active === 'opponent'}
          />
          <span className={styles.judgeLabel}>审判席</span>
          <span className={styles.leftLabel}>
            {short ? (side === 'defendant' ? '对手席' : '学习者席') : '原告席'}
          </span>
          <span className={styles.rightLabel}>
            {short ? (side === 'defendant' ? '学习者席' : '对手席') : '被告席'}
          </span>
          <span className={styles.witnessLabel}>证人席</span>
          <span className={styles.audienceLabel}>旁听席</span>
          <div className={styles.materials}>
            <div className={styles.materialHeading}>
              <span>案件材料</span>
              <small>共同阅读</small>
            </div>
            <div className={styles.materialList}>
              {documents.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  onClick={() => setDocumentId(document.id)}
                  title={document.title}
                >
                  <FileText />
                  <span>{document.title}</span>
                </button>
              ))}
              {documents.length === 0 && (
                <button type="button" onClick={onBriefing}>
                  <BookOpen />
                  <span>查看案情与角色</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {lastMessage && (
        <div className={styles.lastStatement} aria-label="最近发言">
          <span>
            {lastMessage.roleType === 'user'
              ? nickname || '你'
              : (character?.name ?? opponentLabel)}
          </span>
          <div>
            <MarkdownText content={stripEvaluationTail(lastMessage.content)} />
          </div>
        </div>
      )}
      <Dialog
        open={!!selectedDocument}
        onOpenChange={(open) => {
          if (!open) setDocumentId(null);
        }}
      >
        <DialogContent
          className="z-[80] max-h-[85dvh] max-w-3xl overflow-y-auto border border-border bg-background text-foreground"
          portalContainer={portalHost}
          overlayClassName="z-[70] bg-[#453526]/30"
          style={PBL_THEME}
        >
          <DialogHeader>
            <DialogTitle>{selectedDocument?.title}</DialogTitle>
          </DialogHeader>
          {selectedDocument && <MarkdownText content={selectedDocument.content} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Seat({
  label,
  name,
  avatar,
  x,
  y,
  active = false,
}: {
  label: string;
  name?: string;
  avatar?: string;
  x: number;
  y: number;
  active?: boolean;
}) {
  return (
    <div
      className={`${styles.seat} ${active ? styles.active : ''}`}
      style={{ left: `${x}%`, top: `${y}%` }}
      data-active={active}
    >
      <div className={styles.figure}>
        {avatar ? (
          <Image src={avatar} alt={name ?? label} fill sizes="8vw" unoptimized />
        ) : (
          <svg viewBox="0 0 100 130" aria-hidden="true">
            <ellipse cx="50" cy="28" rx="21" ry="25" />
            <path d="M36 49h28l4 11c19 4 28 20 29 40l2 27H1l2-27c1-20 10-36 29-40z" />
          </svg>
        )}
      </div>
      <div className={styles.nameplate}>
        {label}
        {name && <small>{name}</small>}
      </div>
    </div>
  );
}
