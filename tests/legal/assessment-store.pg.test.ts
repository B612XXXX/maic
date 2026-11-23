import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  nodePostgresTransaction,
  type ConnectableQueryable,
} from '@openmaic/storage/server/reference';
import {
  ensureLegalAssessmentSchema,
  LegalAssessmentStore,
  AssessmentBusyError,
  AssessmentConflictError,
  rekeyLegalAssessments,
} from '@/lib/persistence/legal-assessment';
import { bankQuestionSchema } from '@/lib/legal/questions';

const connectionString = process.env.PG_CONTRACT_URL;
describe.skipIf(!connectionString)('assessment persistence on PostgreSQL', () => {
  let pool: Pool;
  let store: LegalAssessmentStore;
  const entry = bankQuestionSchema.parse({
    topic: '合同履行',
    question: {
      type: 'single',
      question: '题库测试问题',
      options: [
        { value: 'A', label: '甲' },
        { value: 'B', label: '乙' },
      ],
      answer: ['A'],
    },
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    const db = pool as unknown as ConnectableQueryable;
    await ensureLegalAssessmentSchema(db);
    store = new LegalAssessmentStore(db, nodePostgresTransaction(db));
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE legal_questions, legal_assessment_selections');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('starts empty and keeps owner partitions separate', async () => {
    expect(await store.list('owner-a')).toEqual([]);
    expect(await store.import('owner-a', [entry, entry])).toBe(1);
    expect(await store.list('owner-b')).toEqual([]);
    expect(await store.list('owner-a')).toHaveLength(1);
  });

  it('updates a question and refuses stale edits', async () => {
    await store.import('owner-a', [entry]);
    const previous = (await store.list('owner-a'))[0]!;
    await store.update('owner-a', previous.id, previous.updatedAt, { ...entry, enabled: false });
    expect((await store.list('owner-a'))[0]?.enabled).toBe(false);
    await expect(
      store.update('owner-a', previous.id, previous.updatedAt, entry),
    ).rejects.toBeInstanceOf(AssessmentConflictError);
  });

  it('grants only one concurrent generation lease and caches its snapshot', async () => {
    const claims = await Promise.allSettled([
      store.claim('owner-a', 'quiz', 'spec'),
      store.claim('owner-a', 'quiz', 'spec'),
    ]);
    expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = claims.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AssessmentBusyError);
    const granted = claims.find(
      (result) => result.status === 'fulfilled',
    ) as PromiseFulfilledResult<Awaited<ReturnType<typeof store.claim>>>;
    const result = {
      questions: [{ ...entry.question, id: 'q' }],
      bankCount: 1,
      generatedCount: 0,
      missing: 0,
      searchStatus: 'unused' as const,
    };
    await store.save('owner-a', 'quiz', granted.value.token, result, true);
    expect(await store.claim('owner-a', 'quiz', 'spec')).toMatchObject({ complete: true, result });
    await expect(store.claim('owner-a', 'quiz', 'other-spec')).rejects.toBeInstanceOf(
      AssessmentConflictError,
    );
  });

  it('moves bank and in-flight selection data during an owner claim', async () => {
    await store.import('owner-a', [entry]);
    const lease = await store.claim('owner-a', 'quiz', 'spec');
    const db = pool as unknown as ConnectableQueryable;
    await nodePostgresTransaction(db)((tx) => rekeyLegalAssessments(tx, 'owner-a', 'owner-b'));
    expect(await store.list('owner-a')).toHaveLength(0);
    expect(await store.list('owner-b')).toHaveLength(1);
    await store.save(
      'owner-b',
      'quiz',
      lease.token,
      { questions: [], bankCount: 0, generatedCount: 0, missing: 1, searchStatus: 'unused' },
      true,
    );
    expect((await store.claim('owner-b', 'quiz', 'spec')).complete).toBe(false);
  });

  it('serializes selections within a course and refuses an expired generation result', async () => {
    const first = await store.claim('owner-a', 'scene-a', 'spec-a', 'course');
    await expect(store.claim('owner-a', 'scene-b', 'spec-b', 'course')).rejects.toBeInstanceOf(
      AssessmentBusyError,
    );
    await pool.query(
      "UPDATE legal_assessment_selections SET lease_until = now() - interval '1 second' WHERE selection_key = 'scene-a'",
    );
    await expect(
      store.save(
        'owner-a',
        'scene-a',
        first.token,
        { questions: [], bankCount: 0, generatedCount: 0, missing: 1, searchStatus: 'unused' },
        true,
      ),
    ).rejects.toBeInstanceOf(AssessmentConflictError);
    expect(await store.claim('owner-a', 'scene-b', 'spec-b', 'course')).toMatchObject({
      complete: false,
    });
  });
});
