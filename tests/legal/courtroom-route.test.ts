import { PGlite } from '@electric-sql/pglite';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_DELIVERY_CASE } from '@/lib/legal/courtroom';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';

const mocks = vi.hoisted(() => ({ aiCall: vi.fn() }));

vi.mock('@/lib/server/agent-runtime/generation-ai-call', () => ({
  createGenerationAiCallFactory: () => () => mocks.aiCall,
}));

import { POST } from '@/app/api/pbl/v2/courtroom-practice/route';
import { withCourtroomRuntimeProject } from '@/lib/server/legal/courtroom-runtime';

const owner = '11111111-1111-4111-8111-111111111111';
const learner = '22222222-2222-4222-8222-222222222222';

function request(payload: unknown, visitor = learner) {
  return new NextRequest('http://localhost/api/pbl/v2/courtroom-practice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `anonymous_id=${visitor}` },
    body: JSON.stringify(payload),
  });
}

const offer = {
  caseId: CONTRACT_DELIVERY_CASE,
  topic: '合同解除',
  sourceStageId: 'existing-stage',
};

describe('courtroom launch and runtime archive', () => {
  let db: PGlite;
  let store: Awaited<ReturnType<typeof getOwnerScopedDocumentStore>>;
  beforeEach(async () => {
    mocks.aiCall.mockReset();
    const databaseUrl = `postgres://isolated-courtroom-${crypto.randomUUID()}`;
    vi.stubEnv('DATABASE_URL', databaseUrl);
    vi.stubEnv('ASSET_S3_BUCKET', '');
    vi.stubEnv('PERSISTENCE_SHARED_OWNER_ID', '');
    vi.stubEnv('OWNER_SINGLE_USER', 'false');
    db = new PGlite();
    await db.waitReady;
    const query = (statement: string, params?: unknown[]) => db.query(statement, params);
    await getServerPersistenceProvider(
      databaseUrl,
      () =>
        ({
          query,
          connect: async () => ({ query, release() {} }),
          end: async () => db.close(),
        }) as never,
    );
    const sourceStore = await getOwnerScopedDocumentStore(`anon:${owner}`);
    await sourceStore.createDocument({
      stage: { id: offer.sourceStageId, name: '合同课堂', createdAt: 1, updatedAt: 1 },
      scenes: [],
    });
    store = await getOwnerScopedDocumentStore(`anon:${learner}`);
  }, 15_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (db && !db.closed) await db.close();
  });

  it('creates a separate learner classroom, leaves the source intact, and reuses the new course', async () => {
    const response = await POST(request(offer));
    expect(response.status).toBe(200);
    const result = await response.json();
    const stageId = result.classroomUrl.split('/').at(-1);
    const persisted = await store.loadDocument(stageId);
    if (!persisted) throw new Error('expected persisted practice');
    expect(persisted.stage.id).not.toBe(offer.sourceStageId);
    expect(result.classroomUrl).toBe(`/classroom/${persisted.stage.id}`);
    const content = persisted.scenes[0]?.content;
    if (content?.type !== 'pbl' || !content.projectV2) throw new Error('expected persisted case');
    expect(content.projectV2.courtroomPractice).toEqual({
      caseId: offer.caseId,
      returnStageId: offer.sourceStageId,
    });
    expect(await (await POST(request(offer))).json()).toEqual(result);
    expect(await store.loadDocument(stageId)).toEqual(persisted);
    expect((await store.loadDocument(offer.sourceStageId))?.scenes).toEqual([]);
    expect(mocks.aiCall).not.toHaveBeenCalled();
  });

  it('does not create a practice that cannot return to a source classroom', async () => {
    expect((await POST(request({ ...offer, sourceStageId: 'missing' }))).status).toBe(404);
    expect(mocks.aiCall).not.toHaveBeenCalled();
  });

  it('rejects out-of-date or tampered views before invoking the simulator or evaluator', async () => {
    const response = await POST(request(offer));
    expect(response.status).toBe(200);
    const { classroomUrl } = await response.json();
    const saved = (await store.loadDocument(classroomUrl.split('/').at(-1)))?.scenes[0];
    if (saved?.content.type !== 'pbl' || !saved.content.projectV2)
      throw new Error('expected persisted case');
    const project = structuredClone(saved.content.projectV2);
    const run = vi.fn(async () => new Response('ok'));
    const scope = { stageId: saved.stageId, sceneId: saved.id, project };
    expect((await withCourtroomRuntimeProject(request({}), scope, run)).status).toBe(200);
    expect(run).toHaveBeenCalledOnce();
    const renamed = structuredClone(project);
    renamed.milestones[0].id = 'unrecognized-prep';
    expect(
      (await withCourtroomRuntimeProject(request({}), { ...scope, project: renamed }, run)).status,
    ).toBe(409);
    project.milestones[0].documents![0].content = 'different case facts';
    expect((await withCourtroomRuntimeProject(request({}), scope, run)).status).toBe(409);
    expect(run).toHaveBeenCalledOnce();
  });
});
