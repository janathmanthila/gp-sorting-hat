/* The rules every hat line must follow; the review screen shows the warnings next to each line. */
'use strict';

const PARTS = ['intro', 'ponder', 'shout'];
const LIMITS = { intro: 160, ponder: 120, shout: 80 };
const HOGWARTS_TRAITS = {
  gryffindor: 'courage, daring, nerve and chivalry',
  hufflepuff: 'loyalty, patience, fairness and hard work',
  ravenclaw: 'wit, wisdom, curiosity and creativity',
  slytherin: 'ambition, resourcefulness, determination and leadership',
};

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = (text, house) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(house)}(?![\\p{L}\\p{N}])`, 'iu').test(text);

function defaultTraits(house) {
  return HOGWARTS_TRAITS[String(house).trim().toLowerCase()] || '';
}

// -> { intro: [..], ponder: [..], shout: [..] } of short warning texts.
function lineWarnings(lines, house, allHouses) {
  const warnings = { intro: [], ponder: [], shout: [] };
  for (const part of PARTS) {
    const text = String((lines && lines[part]) || '').trim();
    if (!text) { warnings[part].push('empty'); continue; }
    if (text.length > LIMITS[part]) warnings[part].push(`${text.length}/${LIMITS[part]} characters`);
    if (part === 'shout') {
      const tail = text.replace(/[\s!.…,"'“”‘’]+$/u, '');
      if (!tail.toLowerCase().endsWith(house.toLowerCase())) warnings.shout.push(`must end with "${house}"`);
      const others = allHouses.filter(h => h !== house && names(text, h));
      if (others.length) warnings.shout.push(`names another house (${others.join(', ')})`);
    } else {
      const named = allHouses.filter(h => names(text, h));
      if (named.length) warnings[part].push(`names a house (${named.join(', ')})`);
    }
  }
  return warnings;
}

const hasWarnings = w => PARTS.some(p => w[p].length);

module.exports = { PARTS, LIMITS, defaultTraits, lineWarnings, hasWarnings };
