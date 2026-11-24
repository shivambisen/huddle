// Decides who an utterance is for, so that exactly the addressed agent(s) answer.
//
// Order of precedence:
//   1. An explicit target picked in the UI (chat "To:" menu, or a pinned tile).
//   2. "@Name" anywhere, or a name/title near the start ("Hey intern, ...",
//      "Developer and researcher, ..."). Tolerates one-letter speech-to-text slips.
//   3. "Everyone / team / all ..." at the start, which goes to the whole room.
//   4. Otherwise the conversation stays with whoever you last addressed,
//      or the project's lead if you haven't addressed anyone yet.
// Nobody else ever answers a message that wasn't routed to them.

const BROADCAST = /^(?:(?:hey|hi|ok|okay|so|alright|right)[\s,]+)?(?:everyone|everybody|team|all|guys|folks|y'all|you all)\b/i;
const LEAD_IN = new Set(['hey', 'hi', 'hello', 'ok', 'okay', 'so', 'yo', 'and', 'alright', 'right', 'now', 'the', 'our', 'my', 'dear']);

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9@\s]/g, ' ').replace(/\s+/g, ' ').trim();

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function aliasesFor(role) {
  const set = new Set();
  for (const s of [role.name, role.title, ...(role.aliases || [])]) {
    const n = s && norm(s);
    if (n) set.add(n);
  }
  return [...set];
}

const wordMatch = (word, alias) => word === alias || (alias.length >= 5 && lev(word, alias) <= 1);

export function route(text, roles, { to = 'auto', lastAddressed = null, leadId = null } = {}) {
  if (to === 'all') return { targets: roles.map((r) => r.id), reason: 'everyone' };
  if (to && to !== 'auto') return { targets: roles.some((r) => r.id === to) ? [to] : [], reason: 'direct' };

  const n = norm(text);
  const words = n.split(' ');
  const hits = new Set();

  // @mentions anywhere.
  for (const r of roles)
    for (const a of aliasesFor(r))
      if (n.includes('@' + a.replace(/ /g, '')) || n.includes('@' + a)) hits.add(r.id);

  // Names in the opening of the sentence ("hey intern", "developer and researcher, ...").
  if (!hits.size) {
    let i = 0;
    const head = [];
    while (i < words.length && head.length < 6) {
      const w = words[i++];
      if (!LEAD_IN.has(w)) head.push(w);
    }
    for (const r of roles) {
      for (const a of aliasesFor(r)) {
        const aw = a.split(' ');
        for (let k = 0; k + aw.length <= head.length; k++) {
          if (aw.every((x, m) => wordMatch(head[k + m], x))) { hits.add(r.id); break; }
        }
      }
    }
  }
  if (hits.size) return { targets: [...hits], reason: 'named' };
  if (BROADCAST.test(n)) return { targets: roles.map((r) => r.id), reason: 'everyone' };

  const sticky = roles.find((r) => r.id === lastAddressed);
  if (sticky) return { targets: [sticky.id], reason: 'continuing' };
  const lead = roles.find((r) => r.id === leadId) || roles[0];
  return { targets: lead ? [lead.id] : [], reason: 'lead' };
}

// Split an agent reply into the short line spoken aloud and the full text shown in chat.
export function splitReply(text) {
  const t = (text || '').trim();
  const m = t.match(/^\s*SAY:\s*(.+?)(?:\n|$)/im);
  let say = m ? m[1].trim() : '';
  const body = m ? t.replace(m[0], '').trim() : t;
  if (!say) {
    const plain = body.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>|-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const sentences = plain.match(/[^.!?]+[.!?]+/g) || [plain];
    say = sentences.slice(0, 2).join(' ').slice(0, 320);
  }
  return { say, body: body || say };
}
