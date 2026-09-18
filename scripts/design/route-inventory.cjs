const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);

// A small lexer, not evaluation of application code. Comments/strings/regex bodies
// are skipped; angle-bracket type arguments can contain nested records and arrows.
function tokens(source) {
  const out = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (source.startsWith('//', i)) { i = source.indexOf('\n', i + 2); if (i < 0) break; continue; }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2); if (end < 0) throw new Error('unterminated comment');
      i = end + 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c; let value = ''; const start = i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') { value += source.slice(i, i + 2); i += 2; }
        else value += source[i++];
      }
      if (i >= source.length) throw new Error('unterminated string');
      i++; out.push({ value, kind: quote === '`' ? 'template' : 'string', start }); continue;
    }
    if (c === '/' && ['(', '=', ':', ',', '!', '?', 'return', '=>', '[', '{', ';'].includes(out.at(-1)?.value)) {
      let j = i + 1, bracket = false, closed = false;
      for (; j < source.length && source[j] !== '\n'; j++) {
        if (source[j] === '\\') { j++; continue; }
        if (source[j] === '[') bracket = true;
        if (source[j] === ']') bracket = false;
        if (source[j] === '/' && !bracket) { closed = true; j++; break; }
      }
      if (closed) { while (/[a-z]/i.test(source[j] ?? '') && j < source.length) j++; i = j; out.push({ kind: 'regex', value: '' }); continue; }
    }
    const word = source.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0];
    if (word) { out.push({ kind: 'word', value: word }); i += word.length; continue; }
    if (source.startsWith('=>', i)) { out.push({ kind: 'punct', value: '=>' }); i += 2; continue; }
    out.push({ kind: 'punct', value: c }); i++;
  }
  return out;
}
function extractRoutes(source) {
  const ts = tokens(source), routes = [];
  for (let i = 0; i < ts.length; i++) {
    if (ts[i - 1]?.value === '.' || ts[i].kind !== 'word' || ts[i].value !== 'app' || ts[i + 1]?.value !== '.' || !methods.has(ts[i + 2]?.value)) continue;
    const method = ts[i + 2].value; let j = i + 3;
    if (ts[j]?.value === '<') {
      let depth = 1; j++;
      while (j < ts.length && depth) {
        if (ts[j].kind === 'punct' && ts[j].value === '<') depth++;
        if (ts[j].kind === 'punct' && ts[j].value === '>') depth--;
        j++;
      }
      if (depth) throw new Error('unbalanced route type arguments');
    }
    if (ts[j]?.value !== '(') continue;
    if (ts[j + 1]?.kind !== 'string' || ts[j + 2]?.value !== ',')
      throw new Error('dynamic or computed route requires explicit inventory support');
    const route = ts[j + 1].value;
    if (!route.startsWith('/api/')) continue;
    if (route.includes('\\')) throw new Error('escaped route literals require explicit documentation support');
    routes.push([method + ' ' + route, method, route]);
  }
  return routes;
}
module.exports = { extractRoutes };
