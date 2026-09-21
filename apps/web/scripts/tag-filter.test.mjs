// The Bookmarks and Wrong Question Book filter: OR matching, availability tied
// to the list on screen, and a collapsed bar that never hides an active filter.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
const { code } = transformSync(readFileSync(new URL('../src/lib/tagFilter.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
const { tagFacets, filterByTags, pruneTags, matchesQuery, visibleFacets } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const q = (id, ...tags) => ({ id, tags });
const questions = [
  q('a', 'Networking', 'Security'),
  q('b', 'Networking'),
  q('c', 'Storage', 'Security'),
  q('d'),
];

test('facets count questions, not tag occurrences, and lead with the widest coverage', () => {
  assert.deepEqual(tagFacets(questions), [
    { name: 'Networking', count: 2 },
    { name: 'Security', count: 2 },
    { name: 'Storage', count: 1 },
  ]);
  assert.deepEqual(tagFacets([q('a', 'Dup', 'Dup')]), [{ name: 'Dup', count: 1 }]);
  assert.deepEqual(tagFacets([]), []);
});

test('several selected tags match any of them, and no selection matches everything', () => {
  assert.deepEqual(filterByTags(questions, []).map(x => x.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(filterByTags(questions, ['Storage']).map(x => x.id), ['c']);
  assert.deepEqual(filterByTags(questions, ['Storage', 'Networking']).map(x => x.id), ['a', 'b', 'c']);
  assert.deepEqual(filterByTags(questions, ['Absent']).map(x => x.id), []);
});

test('a tag that leaves the list stops filtering it', () => {
  const remaining = tagFacets([q('b', 'Networking')]);
  assert.deepEqual(pruneTags(['Networking', 'Storage'], remaining), ['Networking']);
  assert.deepEqual(pruneTags(['Storage'], remaining), []);
  const unchanged = ['Networking'];
  assert.equal(pruneTags(unchanged, remaining), unchanged, 'unchanged selections keep their identity so callers can skip the write');
});

test('search is case-insensitive, trims, and an empty query matches everything', () => {
  assert.equal(matchesQuery('Networking', 'net'), true);
  assert.equal(matchesQuery('Networking', '  WORK '), true);
  assert.equal(matchesQuery('Networking', 'storage'), false);
  assert.equal(matchesQuery('Networking', ''), true);
});

test('collapsing shows the top tags but never buries a selected one', () => {
  const facets = tagFacets(questions);
  const collapsed = visibleFacets(facets, [], { expanded: false, limit: 2 });
  assert.deepEqual(collapsed.shown.map(f => f.name), ['Networking', 'Security']);
  assert.equal(collapsed.hidden, 1);

  const withSelection = visibleFacets(facets, ['Storage'], { expanded: false, limit: 2 });
  assert.deepEqual(withSelection.shown.map(f => f.name), ['Storage', 'Networking']);
  assert.equal(withSelection.hidden, 1);

  const everythingSelected = visibleFacets(facets, ['Networking', 'Security', 'Storage'], { expanded: false, limit: 1 });
  assert.deepEqual(everythingSelected.shown.map(f => f.name), ['Networking', 'Security', 'Storage']);
  assert.equal(everythingSelected.hidden, 0, 'an active filter is never counted as hidden');
});

test('expanding applies the search and stops hiding tags', () => {
  const facets = tagFacets(questions);
  const expanded = visibleFacets(facets, [], { expanded: true, limit: 2 });
  assert.deepEqual(expanded.shown.map(f => f.name), ['Networking', 'Security', 'Storage']);
  assert.equal(expanded.hidden, 0);
  assert.deepEqual(visibleFacets(facets, [], { expanded: true, limit: 2, query: 'zzz' }).shown, []);
});

test('searching for another tag never takes an active filter off the screen', () => {
  const facets = tagFacets(questions);
  // Storage filters the page; searching for something else must not remove the
  // one control that can switch it off.
  const searched = visibleFacets(facets, ['Storage'], { expanded: true, limit: 2, query: 'ec' });
  assert.deepEqual(searched.shown.map(f => f.name), ['Storage', 'Security'], 'the selected tag stays pinned ahead of the matches');
  assert.equal(searched.matched, 1);

  const noMatch = visibleFacets(facets, ['Storage'], { expanded: true, limit: 2, query: 'zzz' });
  assert.deepEqual(noMatch.shown.map(f => f.name), ['Storage']);
  assert.equal(noMatch.matched, 0, 'an empty result is about the tags the search can reach');

  // A selected tag is not a search hit either: it is pinned whether or not the
  // query happens to match it, and never listed twice.
  assert.deepEqual(visibleFacets(facets, ['Storage'], { expanded: true, limit: 2, query: 'sto' }).shown.map(f => f.name), ['Storage']);
});
