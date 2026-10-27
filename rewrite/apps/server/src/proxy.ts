import { BlockList, isIP } from 'node:net';

/**
 * The proxies whose `X-Forwarded-For` the server believes (README, "Behind a
 * reverse proxy"): addresses and CIDR blocks, IPv4 or IPv6. Throws on an entry
 * that is neither, so a typo stops the server rather than trusting nobody.
 */
export function trustedProxies(entries: string[]): BlockList {
  const list = new BlockList();
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    const [address, bits, ...rest] = entry.split('/');
    const family = isIP(address ?? '');
    const prefix = Number(bits);
    if (!family || rest.length || (bits !== undefined && !(/^\d+$/.test(bits) && prefix <= (family === 4 ? 32 : 128)))) {
      throw new Error(`GP_TRUSTED_PROXIES: "${entry}" is not an address or a CIDR block`);
    }
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (bits === undefined) list.addAddress(address!, type);
    else list.addSubnet(address!, prefix, type);
  }
  return list;
}

/** An address as a socket or a proxy gives it: `::ffff:` dropped from an IPv4 one, brackets and a port dropped. Null when it is none. */
export function plainAddress(value: string): string | null {
  let a = value.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(a);
  if (bracketed) a = bracketed[1]!;
  else if (/^[\d.]+:\d+$/.test(a)) a = a.slice(0, a.lastIndexOf(':'));
  const mapped = /^::ffff:([\d.]+)$/i.exec(a);
  if (mapped && isIP(mapped[1]!) === 4) a = mapped[1]!;
  return isIP(a) ? a : null;
}

function trusted(list: BlockList, address: string): boolean {
  return list.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
}

/**
 * The client behind the proxies: the socket's own address unless it is a
 * trusted proxy. Then `X-Forwarded-For` is read from the right, skipping
 * trusted proxies; the first address that is not one is the client. A client
 * can put anything at the left of the header, but never past a trusted proxy,
 * which appends the address it saw. An entry that is no address stops the
 * walk at the hop before it.
 */
export function forwardedClient(socketAddress: string, forwardedFor: string | undefined, list: BlockList): string {
  let client = plainAddress(socketAddress) ?? socketAddress;
  if (!isIP(client) || !trusted(list, client) || !forwardedFor) return client;
  for (const hop of forwardedFor.split(',').toReversed()) {
    const address = plainAddress(hop);
    if (!address) break;
    client = address;
    if (!trusted(list, address)) break;
  }
  return client;
}
