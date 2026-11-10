// RFC 9309 robots.txt parsing and matching.
//  * groups: consecutive User-agent lines share the following rules
//  * we obey the group naming our product token, else the `*` group
//  * Allow/Disallow with `*` wildcards and `$` end anchor; longest match wins,
//    Allow wins ties

export function parseRobots(text, productToken) {
  const groups = []; // { agents: string[], rules: {allow:boolean, path:string}[] }
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (current && value) current.rules.push({ allow: field === 'allow', path: value });
    } else {
      lastWasAgent = false;
    }
  }
  const token = productToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.startsWith(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function toRegex(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/** @returns {boolean} true if `path` (pathname + search) may be fetched. */
export function isAllowed(rules, path) {
  let best = null;
  for (const r of rules) {
    if (!toRegex(r.path).test(path)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}
