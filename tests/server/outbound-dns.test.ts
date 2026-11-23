import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Address = { address: string; family: number };
type Lookup = (
  hostname: string,
  options: { all: boolean },
  callback: (error: Error | null, addresses?: Address[]) => void,
) => void;

const mocks = vi.hoisted(() => ({
  promisesLookup: vi.fn(),
  callbackLookup: vi.fn(),
  fetch: vi.fn(),
  connectLookup: null as Lookup | null,
}));

vi.mock('node:dns', () => ({
  promises: { lookup: mocks.promisesLookup },
  lookup: mocks.callbackLookup,
}));

vi.mock('undici', () => ({
  Agent: class {
    constructor(options: { connect: { lookup: Lookup } }) {
      mocks.connectLookup = options.connect.lookup;
    }
  },
}));

const SYNTHETIC: Address[] = [
  { address: '198.18.0.147', family: 4 },
  { address: '2001:2::7e', family: 6 },
];
const PUBLIC: Address[] = [{ address: '39.96.213.166', family: 4 }];

function answer(addresses: string[], status = 0) {
  mocks.fetch.mockImplementation(async () =>
    Response.json({
      Status: status,
      Answer: addresses.map((data) => ({ type: 1, data, TTL: 60 })),
    }),
  );
}

async function pinnedLookup() {
  const { createPinnedAgent } = await import('@/lib/server/pinned-dispatcher');
  createPinnedAgent();
  return new Promise<Address[]>((resolve, reject) => {
    mocks.connectLookup!('dashscope.aliyuncs.com', { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses!);
    });
  });
}

describe('outbound DNS behind a fake-IP proxy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.connectLookup = null;
    vi.stubEnv('OPENMAIC_DNS_OVER_HTTPS_URL', 'https://dns.alidns.com/resolve');
    vi.stubEnv('ALLOW_LOCAL_NETWORKS', 'false');
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.promisesLookup.mockResolvedValue(SYNTHETIC);
    mocks.callbackLookup.mockImplementation((_host, _options, callback) =>
      callback(null, SYNTHETIC),
    );
    answer(PUBLIC.map(({ address }) => address));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses real public answers for both URL validation and the pinned connection', async () => {
    const { validatePublicUrlForSSRF } = await import('@/lib/server/ssrf-guard');
    await expect(validatePublicUrlForSSRF('https://dashscope.aliyuncs.com')).resolves.toBeNull();
    await expect(pinnedLookup()).resolves.toEqual(PUBLIC);
    const url = new URL(String(mocks.fetch.mock.calls[0]![0]));
    expect(url.origin).toBe('https://dns.alidns.com');
    expect(url.searchParams.get('name')).toBe('dashscope.aliyuncs.com');
    expect(url.searchParams.get('type')).toBe('A');
  });

  it('still rejects synthetic addresses when the resolver is not configured', async () => {
    vi.stubEnv('OPENMAIC_DNS_OVER_HTTPS_URL', '');
    const { validatePublicUrlForSSRF } = await import('@/lib/server/ssrf-guard');
    expect(await validatePublicUrlForSSRF('https://dashscope.aliyuncs.com')).toContain(
      'not allowed',
    );
    await expect(pinnedLookup()).rejects.toThrow('not allowed');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('leaves ordinary DNS answers alone', async () => {
    mocks.promisesLookup.mockResolvedValue(PUBLIC);
    mocks.callbackLookup.mockImplementation((_host, _options, callback) => callback(null, PUBLIC));
    const { validatePublicUrlForSSRF } = await import('@/lib/server/ssrf-guard');
    await expect(validatePublicUrlForSSRF('https://dashscope.aliyuncs.com')).resolves.toBeNull();
    await expect(pinnedLookup()).resolves.toEqual(PUBLIC);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('recovers synthetic DNS on the server-configured LLM transport', async () => {
    const { serverConfiguredLlmFetch } = await import('@/lib/server/llm-provider-fetch');
    await serverConfiguredLlmFetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      dispatcher: { timeoutOnly: true },
    } as RequestInit);
    expect(mocks.fetch.mock.calls[0]![1].dispatcher).toBeDefined();
    expect(mocks.fetch.mock.calls[0]![1].dispatcher).not.toEqual({ timeoutOnly: true });
    const addresses = await new Promise<Address[]>((resolve, reject) => {
      mocks.connectLookup!('api.deepseek.com', { all: true }, (error, resolved) => {
        if (error) reject(error);
        else resolve(resolved!);
      });
    });
    expect(addresses).toEqual(PUBLIC);
    const resolver = new URL(String(mocks.fetch.mock.calls[1]![0]));
    expect(resolver.searchParams.get('name')).toBe('api.deepseek.com');
  });

  it('keeps the existing LLM transport when DNS recovery is not configured', async () => {
    vi.stubEnv('OPENMAIC_DNS_OVER_HTTPS_URL', '');
    const { serverConfiguredLlmFetch } = await import('@/lib/server/llm-provider-fetch');
    const dispatcher = { timeoutOnly: true };
    await serverConfiguredLlmFetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      dispatcher,
    } as RequestInit);
    expect(mocks.fetch.mock.calls[0]![1].dispatcher).toBe(dispatcher);
  });

  it('preserves operator-configured local LLM endpoints', async () => {
    const local = [{ address: '127.0.0.1', family: 4 }];
    mocks.callbackLookup.mockImplementation((_host, _options, callback) => callback(null, local));
    const { serverConfiguredLlmFetch } = await import('@/lib/server/llm-provider-fetch');
    await serverConfiguredLlmFetch('http://model.local/v1/chat/completions');
    const addresses = await new Promise<Address[]>((resolve, reject) => {
      mocks.connectLookup!('model.local', { all: true }, (error, resolved) => {
        if (error) reject(error);
        else resolve(resolved!);
      });
    });
    expect(addresses).toEqual(local);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '198.18.0.99'])(
    'keeps rejecting unsafe resolver answers: %s',
    async (address) => {
      answer([address]);
      const { validatePublicUrlForSSRF } = await import('@/lib/server/ssrf-guard');
      expect(await validatePublicUrlForSSRF('https://dashscope.aliyuncs.com')).toMatch(
        /not allowed|never allowed/,
      );
      await expect(pinnedLookup()).rejects.toThrow(/not allowed|never allowed/);
    },
  );

  it('rejects the entire result when one resolver answer is private', async () => {
    answer([PUBLIC[0]!.address, '10.0.0.1']);
    const { validatePublicUrlForSSRF } = await import('@/lib/server/ssrf-guard');
    expect(await validatePublicUrlForSSRF('https://dashscope.aliyuncs.com')).toContain(
      'not allowed',
    );
    await expect(pinnedLookup()).rejects.toThrow('not allowed');
  });

  it('fails closed when the resolver has no valid answers', async () => {
    answer([], 3);
    const { validatePublicUrlForSSRF } = await import('@/lib/server/ssrf-guard');
    await expect(validatePublicUrlForSSRF('https://dashscope.aliyuncs.com')).resolves.toBe(
      'Unable to verify hostname safety',
    );
    await expect(pinnedLookup()).rejects.toThrow();
  });

  it('does not replace a mixed synthetic and private system answer', async () => {
    mocks.promisesLookup.mockResolvedValue([...SYNTHETIC, { address: '10.0.0.1', family: 4 }]);
    const { validatePublicUrlForSSRF } = await import('@/lib/server/ssrf-guard');
    expect(await validatePublicUrlForSSRF('https://dashscope.aliyuncs.com')).toContain(
      'not allowed',
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('refuses a plaintext resolver without sending a request', async () => {
    vi.stubEnv('OPENMAIC_DNS_OVER_HTTPS_URL', 'http://dns.alidns.com/resolve');
    const { validatePublicUrlForSSRF } = await import('@/lib/server/ssrf-guard');
    await expect(validatePublicUrlForSSRF('https://dashscope.aliyuncs.com')).resolves.toBe(
      'Unable to verify hostname safety',
    );
    await expect(pinnedLookup()).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
