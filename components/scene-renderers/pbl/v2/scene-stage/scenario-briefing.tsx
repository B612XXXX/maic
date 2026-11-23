'use client';

/**
 * PBL v2 — Scenario briefing panel (SCENARIO ONLY).
 *
 * Right-column companion to the submission panel, surfaced as a tab once the
 * learner has ENTERED the scenario (prep stage completed). During roleplay the
 * concrete premise the Instructor laid out in prep — the setting, the cast and
 * who they are, the learner's own role, the rules, and the goal — scrolls out
 * of reach in the chat. This panel keeps that briefing one click away for the
 * whole run (roleplay → wrapup → and after returning from the completion page).
 *
 * Data source: the design-time, frozen `project.scenario` (NOT the prep chat
 * transcript) — stable, structured, and independent of LLM wording. Every
 * section is guarded so an older / partial package (missing rules / goal /
 * learnerRole) simply omits that section. Renders nothing for non-scenario
 * projects, so it has zero footprint on ordinary projects.
 */

import { useMemo, type ReactNode } from 'react';
import Image from 'next/image';
import { BookOpen, Film, Target, User, Users } from 'lucide-react';
import type { PBLProjectV2, PBLScenarioCharacter } from '@/lib/pbl/v2/types';
import { trimmedPBLText } from '@/lib/pbl/v2/readers';
import { useI18n } from '@/lib/hooks/use-i18n';
import { sanitizeSceneVisual } from './scene-types';
import { getScenarioDocuments, hasCourtroomEvidence } from '@/lib/legal/courtroom';
import { MarkdownText } from '../markdown-text';

interface Props {
  readonly project: PBLProjectV2;
}

export function ScenarioBriefing({ project }: Props) {
  const { t } = useI18n();
  const scenario = project.scenario;
  const accent = useMemo(() => sanitizeSceneVisual(scenario?.sceneVisual).accent, [scenario]);

  if (!scenario) return null;

  const setting = trimmedPBLText(scenario.setting);
  const learnerRole = trimmedPBLText(scenario.learnerRole);
  const goal = trimmedPBLText(scenario.goal);
  const rules = trimmedPBLText(scenario.rules);
  const characters = scenario.characters ?? [];
  const documents = hasCourtroomEvidence(project) ? getScenarioDocuments(project) : [];

  return (
    <aside className="pbl-v2-scroll-fade h-full space-y-4 overflow-y-auto p-4">
      <div className="px-0.5">
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t('pbl.v2.briefing.intro')}
        </p>
      </div>

      {setting && (
        <BriefingSection
          emoji="🎬"
          icon={<Film className="h-3 w-3" />}
          label={t('pbl.v2.briefing.setting')}
        >
          <BriefingText text={setting} />
        </BriefingSection>
      )}

      {learnerRole && (
        <BriefingSection
          emoji="🎭"
          icon={<User className="h-3 w-3" />}
          label={t('pbl.v2.briefing.learnerRole')}
        >
          <BriefingText text={learnerRole} />
        </BriefingSection>
      )}

      {goal && (
        <BriefingSection
          emoji="🎯"
          icon={<Target className="h-3 w-3" />}
          label={t('pbl.v2.briefing.goal')}
        >
          <BriefingText text={goal} />
        </BriefingSection>
      )}

      {documents.length > 0 && (
        <BriefingSection emoji="" icon={<BookOpen className="h-3 w-3" />} label="共同案卷">
          <div className="space-y-3">
            {documents.map((document) => (
              <div key={document.id}>
                <p className="text-xs font-medium">{document.title}</p>
                <MarkdownText content={document.content} />
              </div>
            ))}
          </div>
        </BriefingSection>
      )}

      {rules && (
        <BriefingSection
          emoji="📜"
          icon={<BookOpen className="h-3 w-3" />}
          label={t('pbl.v2.briefing.rules')}
        >
          <BriefingText text={rules} />
        </BriefingSection>
      )}

      {characters.length > 0 && (
        <BriefingSection
          emoji="👥"
          icon={<Users className="h-3 w-3" />}
          label={t('pbl.v2.briefing.cast')}
        >
          <ul className="space-y-2.5">
            {characters.map((character) => (
              <CharacterCard key={character.id} character={character} accent={accent} />
            ))}
          </ul>
        </BriefingSection>
      )}
    </aside>
  );
}

function BriefingSection({
  emoji,
  icon,
  label,
  children,
}: {
  readonly emoji: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-[0_12px_30px_rgba(104,67,25,0.20)]">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary">
        <span aria-hidden className="text-xs leading-none">
          {emoji}
        </span>
        {icon}
        <span>{label}</span>
      </div>
      {children}
    </section>
  );
}

function BriefingText({ text }: { readonly text: string }) {
  return <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">{text}</p>;
}

function CharacterCard({
  character,
  accent,
}: {
  readonly character: PBLScenarioCharacter;
  readonly accent: string;
}) {
  const { t } = useI18n();
  const persona = trimmedPBLText(character.persona);
  const situation = trimmedPBLText(character.situation);
  return (
    <li className="rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-center gap-2.5">
        <BriefingAvatar name={character.name} avatar={character.avatar} accent={accent} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {character.name}
        </span>
      </div>
      {persona && (
        <div className="mt-2 flex gap-1.5 text-[11px] leading-snug">
          <span className="shrink-0 font-medium text-primary">{t('pbl.v2.briefing.identity')}</span>
          <span className="min-w-0 whitespace-pre-wrap text-foreground/80">{persona}</span>
        </div>
      )}
      {situation && (
        <div className="mt-1 flex gap-1.5 text-[11px] leading-snug">
          <span className="shrink-0 font-medium text-primary">
            {t('pbl.v2.briefing.situation')}
          </span>
          <span className="min-w-0 whitespace-pre-wrap text-foreground/80">{situation}</span>
        </div>
      )}
    </li>
  );
}

/** Avatar with graceful degradation: only LOCAL paths go through next/image
 *  (external URLs need pre-registered domains); anything else falls back to the
 *  name's initial on the scene accent — mirrors the ScenarioStage avatar. */
function BriefingAvatar({
  name,
  avatar,
  accent,
}: {
  readonly name: string;
  readonly avatar?: string;
  readonly accent: string;
}) {
  const initial = (trimmedPBLText(name)[0] ?? '·').toUpperCase();
  const isImg = typeof avatar === 'string' && avatar.startsWith('/');
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-foreground shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
      style={{ background: accent }}
      aria-hidden
    >
      {isImg ? (
        <Image src={avatar} alt="" width={32} height={32} className="h-8 w-8 object-cover" />
      ) : (
        initial
      )}
    </span>
  );
}
