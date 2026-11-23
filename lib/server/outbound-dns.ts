import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

type DnsAnswer = { type?: number; data?: string; TTL?: number };
type CachedAnswer = { addresses: LookupAddress[]; expiresAt: number };

const cache = new Map<string, CachedAnswer>();

/** Clash can synthesize both IPv4 and IPv6 answers in the benchmark ranges. */
function isSyntheticAddress({ address }: LookupAddress): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  return parsed.kind() === 'ipv4'
    ? (parsed as ipaddr.IPv4).match(ipaddr.IPv4.parse('198.18.0.0'), 15)
    : (parsed as ipaddr.IPv6).match(ipaddr.IPv6.parse('2001:2::'), 48);
}

/**
 * Optional recovery from a fake-IP DNS answer using an operator-configured
 * HTTPS JSON resolver. Callers still validate every returned address and pin
 * the approved answers to the connection; synthetic IPs are never allowed.
 * Ordinary DNS answers, mixed answers and IP literals keep their old policy.
 */
export async function resolveSyntheticDnsAnswers(
  hostname: string,
  addresses: LookupAddress[],
): Promise<LookupAddress[]> {
  const endpoint = process.env.OPENMAIC_DNS_OVER_HTTPS_URL?.trim();
  if (
    !endpoint ||
    isIP(hostname) ||
    addresses.length === 0 ||
    !addresses.every(isSyntheticAddress)
  ) {
    return addresses;
  }

  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('OPENMAIC_DNS_OVER_HTTPS_URL must be an HTTPS resolver without credentials');
  }
  url.searchParams.set('name', hostname);
  url.searchParams.set('type', 'A');
  const key = url.href;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.addresses;

  // Bootstrap the configured resolver through the system transport. This
  // request carries only a hostname; provider credentials are never attached.
  const response = await fetch(url, {
    headers: { Accept: 'application/dns-json' },
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('The configured DNS resolver request failed');
  const result = (await response.json()) as { Status?: number; Answer?: DnsAnswer[] };
  if (result.Status !== 0 || !Array.isArray(result.Answer)) {
    throw new Error('The configured DNS resolver returned no addresses');
  }
  const answers = result.Answer.filter(
    (answer) => answer.type === 1 && typeof answer.data === 'string' && isIP(answer.data) === 4,
  );
  if (answers.length === 0)
    throw new Error('The configured DNS resolver returned no IPv4 addresses');

  const resolved = answers.map((answer) => ({ address: answer.data!, family: 4 }));
  const ttl = Math.min(
    60,
    ...answers.map((answer) =>
      typeof answer.TTL === 'number' && Number.isFinite(answer.TTL) && answer.TTL > 0
        ? answer.TTL
        : 0,
    ),
  );
  if (ttl > 0) {
    if (cache.size >= 128) cache.clear();
    cache.set(key, { addresses: resolved, expiresAt: Date.now() + ttl * 1_000 });
  }
  return resolved;
}
