import { randomUUID, createHash } from 'node:crypto';
import type { Queryable, WithTransaction } from '@openmaic/storage/document/pg';
import { applySchemaMigrations } from '@openmaic/storage/pg-migrations';
import { fenceOwnerWrite, ensureOwnerMergeSchema } from './owner-merges';
import type { AssessmentResult, BankQuestion, BankQuestionInput } from '@/lib/legal/questions';
import type { QuizQuestion } from '@/lib/types/stage';

export async function ensureLegalAssessmentSchema(db: Queryable): Promise<void> {
  await applySchemaMigrations(db, {
    store: 'legal-assessment',
    migrations: [
      {
        version: 1,
        name: 'baseline',
        transaction: false,
        up: `
      CREATE TABLE IF NOT EXISTS legal_questions (
        owner_id TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL,
        fingerprint TEXT NOT NULL, updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY (owner_id, id), UNIQUE (owner_id, fingerprint)
      );
      CREATE TABLE IF NOT EXISTS legal_assessment_selections (
        owner_id TEXT NOT NULL, selection_key TEXT NOT NULL, spec_hash TEXT NOT NULL, scope_key TEXT NOT NULL,
        result JSONB, complete BOOLEAN NOT NULL DEFAULT false,
        lease_token TEXT, lease_until TIMESTAMPTZ,
        PRIMARY KEY (owner_id, selection_key)
      );
    `,
      },
    ],
  });
  await ensureOwnerMergeSchema(db);
}

export function questionFingerprint(question: Pick<QuizQuestion, 'type' | 'question'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        type: question.type,
        question: question.question.replace(/\s+/g, '').toLowerCase(),
      }),
    )
    .digest('hex');
}

export class AssessmentBusyError extends Error {}
export class AssessmentConflictError extends Error {}

interface QuestionRow extends Record<string, unknown> {
  id: string;
  data: BankQuestionInput;
  updated_at: Date | string;
}

export class LegalAssessmentStore {
  constructor(
    private db: Queryable,
    private transaction: WithTransaction,
  ) {}

  async list(ownerId: string): Promise<BankQuestion[]> {
    const result = await this.db.query<QuestionRow>(
      'SELECT id, data, updated_at FROM legal_questions WHERE owner_id = $1 ORDER BY updated_at DESC, id',
      [ownerId],
    );
    return result.rows.map((row) => ({
      ...row.data,
      id: row.id,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async import(ownerId: string, entries: BankQuestionInput[]): Promise<number> {
    return this.transaction(async (tx) => {
      await fenceOwnerWrite(tx, ownerId);
      let inserted = 0;
      for (const entry of entries) {
        const id = `question-${randomUUID()}`;
        const data = { ...entry, question: { ...entry.question, id } };
        const result = await tx.query(
          `INSERT INTO legal_questions (owner_id, id, data, fingerprint) VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (owner_id, fingerprint) DO NOTHING RETURNING id`,
          [ownerId, id, JSON.stringify(data), questionFingerprint(entry.question)],
        );
        inserted += result.rows.length;
      }
      return inserted;
    });
  }

  async update(
    ownerId: string,
    id: string,
    updatedAt: string,
    entry: BankQuestionInput,
  ): Promise<void> {
    await this.transaction(async (tx) => {
      await fenceOwnerWrite(tx, ownerId);
      const result = await tx.query(
        `UPDATE legal_questions SET data = $4::jsonb, fingerprint = $5,
           updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
         WHERE owner_id = $1 AND id = $2 AND updated_at = $3::timestamptz RETURNING id`,
        [
          ownerId,
          id,
          updatedAt,
          JSON.stringify({ ...entry, question: { ...entry.question, id } }),
          questionFingerprint(entry.question),
        ],
      );
      if (!result.rows.length) throw new AssessmentConflictError('题目已更新，请刷新后重试');
    });
  }

  async claim(
    ownerId: string,
    key: string,
    specHash: string,
    scopeKey = key,
  ): Promise<{
    result: AssessmentResult | null;
    complete: boolean;
    token: string;
  }> {
    return this.transaction(async (tx) => {
      await fenceOwnerWrite(tx, ownerId);
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        JSON.stringify([ownerId, scopeKey]),
      ]);
      await tx.query(
        `INSERT INTO legal_assessment_selections (owner_id, selection_key, spec_hash, scope_key)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [ownerId, key, specHash, scopeKey],
      );
      const { rows } = await tx.query<
        {
          spec_hash: string;
          result: AssessmentResult | null;
          complete: boolean;
          busy: boolean;
        } & Record<string, unknown>
      >(
        `SELECT spec_hash, result, complete, lease_until > now() AS busy
         FROM legal_assessment_selections WHERE owner_id = $1 AND selection_key = $2 FOR UPDATE`,
        [ownerId, key],
      );
      const row = rows[0]!;
      if (row.spec_hash !== specHash)
        throw new AssessmentConflictError('练习设置已改变，请重新生成');
      if (row.complete) return { result: row.result, complete: true, token: '' };
      if (row.busy) throw new AssessmentBusyError('练习正在生成，请稍后重试');
      const active = await tx.query(
        `SELECT selection_key FROM legal_assessment_selections
         WHERE owner_id = $1 AND scope_key = $2 AND selection_key <> $3 AND lease_until > now()`,
        [ownerId, scopeKey, key],
      );
      if (active.rows.length) throw new AssessmentBusyError('本课程正在准备另一组题目');
      const token = randomUUID();
      await tx.query(
        `UPDATE legal_assessment_selections SET lease_token = $3, lease_until = now() + interval '6 minutes'
         WHERE owner_id = $1 AND selection_key = $2`,
        [ownerId, key, token],
      );
      return { result: row.result, complete: false, token };
    });
  }

  async save(
    ownerId: string,
    key: string,
    token: string,
    result: AssessmentResult,
    release: boolean,
  ): Promise<void> {
    await this.transaction(async (tx) => {
      await fenceOwnerWrite(tx, ownerId);
      const written = await tx.query(
        `UPDATE legal_assessment_selections SET result = $4::jsonb, complete = $5,
           lease_until = CASE WHEN $6 THEN NULL ELSE lease_until END,
           lease_token = CASE WHEN $6 THEN NULL ELSE lease_token END
         WHERE owner_id = $1 AND selection_key = $2 AND lease_token = $3 AND lease_until > now()
         RETURNING selection_key`,
        [ownerId, key, token, JSON.stringify(result), result.missing === 0, release],
      );
      if (!written.rows.length) throw new AssessmentConflictError('生成状态已更新，请重试');
    });
  }

  async usedQuestions(ownerId: string, scopeKey: string, key: string): Promise<QuizQuestion[]> {
    const { rows } = await this.db.query<
      { result: AssessmentResult | null } & Record<string, unknown>
    >(
      `SELECT result FROM legal_assessment_selections
       WHERE owner_id = $1 AND scope_key = $2 AND selection_key <> $3`,
      [ownerId, scopeKey, key],
    );
    return rows.flatMap((row) => row.result?.questions ?? []);
  }

  async release(ownerId: string, key: string, token: string): Promise<void> {
    await this.transaction(async (tx) => {
      await fenceOwnerWrite(tx, ownerId);
      await tx.query(
        `UPDATE legal_assessment_selections SET lease_token = NULL, lease_until = NULL
         WHERE owner_id = $1 AND selection_key = $2 AND lease_token = $3`,
        [ownerId, key, token],
      );
    });
  }
}

export async function rekeyLegalAssessments(
  tx: Queryable,
  from: string,
  to: string,
): Promise<number> {
  const result = await tx.query(
    `INSERT INTO legal_questions (owner_id, id, data, fingerprint, updated_at)
     SELECT $2, id, data, fingerprint, updated_at FROM legal_questions WHERE owner_id = $1
     ON CONFLICT DO NOTHING RETURNING id`,
    [from, to],
  );
  await tx.query('DELETE FROM legal_questions WHERE owner_id = $1', [from]);
  await tx.query(
    `INSERT INTO legal_assessment_selections
     SELECT $2, selection_key, spec_hash, scope_key, result, complete, lease_token, lease_until
     FROM legal_assessment_selections WHERE owner_id = $1 ON CONFLICT DO NOTHING`,
    [from, to],
  );
  await tx.query('DELETE FROM legal_assessment_selections WHERE owner_id = $1', [from]);
  return result.rows.length;
}
