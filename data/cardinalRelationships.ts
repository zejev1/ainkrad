export type RelationshipSeed = {
  from: string;
  to: string;
  trust: number;
  affection: number;
  respect: number;
  tension: number;
  familiarity: number;
  reason: string;
};

// Directed edges: Mara can trust Bram less than Bram trusts Mara.
export const CARDINAL_RELATIONSHIP_SEEDS: RelationshipSeed[] = [
  { from: 'mara-vale', to: 'celia-ward', trust: .88, affection: .78, respect: .90, tension: .06, familiarity: .92, reason: 'Years of handling difficult nights and emergencies together.' },
  { from: 'celia-ward', to: 'mara-vale', trust: .92, affection: .72, respect: .86, tension: .04, familiarity: .91, reason: 'Mara reliably notices exhausted people before they ask for help.' },
  { from: 'mara-vale', to: 'theo-lark', trust: .68, affection: .86, respect: .45, tension: .12, familiarity: .80, reason: 'She has watched Theo grow up and treats him as chosen family.' },
  { from: 'theo-lark', to: 'mara-vale', trust: .88, affection: .82, respect: .74, tension: .04, familiarity: .84, reason: 'Mara is one of the few adults Theo trusts after making a mistake.' },
  { from: 'elias-thorn', to: 'theo-lark', trust: .48, affection: .55, respect: .40, tension: .30, familiarity: .82, reason: 'An apprenticeship built on real care and constant frustration.' },
  { from: 'theo-lark', to: 'elias-thorn', trust: .72, affection: .68, respect: .94, tension: .36, familiarity: .84, reason: 'Theo desperately wants Elias’s approval and fears disappointing him.' },
  { from: 'elias-thorn', to: 'jun-aris', trust: .66, affection: .28, respect: .84, tension: .35, familiarity: .62, reason: 'They disagree about method but recognize each other’s competence.' },
  { from: 'jun-aris', to: 'elias-thorn', trust: .74, affection: .34, respect: .90, tension: .31, familiarity: .65, reason: 'Jun enjoys arguing with someone who can actually prove him wrong.' },
  { from: 'aya-ren', to: 'celia-ward', trust: .86, affection: .60, respect: .91, tension: .08, familiarity: .79, reason: 'They treat patients together and openly challenge each other’s assumptions.' },
  { from: 'celia-ward', to: 'aya-ren', trust: .82, affection: .58, respect: .88, tension: .10, familiarity: .79, reason: 'Celia trusts Aya’s observations even when she dislikes the explanation.' },
  { from: 'aya-ren', to: 'bram-rook', trust: .35, affection: .22, respect: .52, tension: .48, familiarity: .58, reason: 'They repeatedly clash over what essential medicine should cost.' },
  { from: 'bram-rook', to: 'aya-ren', trust: .56, affection: .20, respect: .72, tension: .43, familiarity: .58, reason: 'Bram dislikes Aya’s economics but respects that she cannot be bought.' },
  { from: 'tomas-kade', to: 'ilya-cross', trust: .95, affection: .83, respect: .86, tension: .04, familiarity: .94, reason: 'Old friends who have rebuilt roofs, bridges, and each other’s bad days.' },
  { from: 'ilya-cross', to: 'tomas-kade', trust: .93, affection: .81, respect: .82, tension: .05, familiarity: .95, reason: 'Ilya trusts Tomas with the things he cannot say elegantly.' },
  { from: 'tomas-kade', to: 'bram-rook', trust: .52, affection: .25, respect: .58, tension: .52, familiarity: .64, reason: 'Debt makes every friendly conversation slightly dangerous.' },
  { from: 'bram-rook', to: 'tomas-kade', trust: .69, affection: .48, respect: .66, tension: .28, familiarity: .68, reason: 'Bram is quietly more forgiving of the debt than his public persona suggests.' },
  { from: 'liora-fen', to: 'silas-north', trust: .66, affection: .31, respect: .82, tension: .34, familiarity: .73, reason: 'They share belief in records but disagree over what institutions may hide.' },
  { from: 'silas-north', to: 'liora-fen', trust: .72, affection: .29, respect: .90, tension: .29, familiarity: .76, reason: 'Silas trusts Liora enough to fear what she will record about him.' },
  { from: 'daren-holt', to: 'renna-voss', trust: .70, affection: .25, respect: .82, tension: .44, familiarity: .75, reason: 'Daren values Renna’s instincts and hates that she ignores chain of command.' },
  { from: 'renna-voss', to: 'daren-holt', trust: .62, affection: .20, respect: .78, tension: .52, familiarity: .75, reason: 'Renna believes Daren is decent but too willing to let rules slow truth.' },
  { from: 'daren-holt', to: 'bram-rook', trust: .38, affection: .16, respect: .55, tension: .46, familiarity: .57, reason: 'The recent thefts make Daren suspicious of anyone controlling warehouses.' },
  { from: 'bram-rook', to: 'daren-holt', trust: .47, affection: .12, respect: .63, tension: .42, familiarity: .54, reason: 'Bram thinks Daren confuses suspicion with evidence.' },
  { from: 'niko-sera', to: 'eva-merin', trust: .72, affection: .68, respect: .56, tension: .10, familiarity: .76, reason: 'Playful friendship built through gossip, errands, and mutual teasing.' },
  { from: 'eva-merin', to: 'niko-sera', trust: .64, affection: .71, respect: .53, tension: .14, familiarity: .78, reason: 'Eva enjoys Niko but knows he sometimes talks before thinking.' },
  { from: 'eva-merin', to: 'kira-dawn', trust: .86, affection: .82, respect: .72, tension: .05, familiarity: .83, reason: 'Eva is one of the few people who sees Kira when she is not performing.' },
  { from: 'kira-dawn', to: 'eva-merin', trust: .91, affection: .85, respect: .75, tension: .04, familiarity: .86, reason: 'Kira trusts Eva with unfinished songs and unfinished feelings.' },
  { from: 'mira-sol', to: 'kira-dawn', trust: .74, affection: .88, respect: .61, tension: .08, familiarity: .72, reason: 'Mira notices when Kira has forgotten to eat and refuses to ignore it.' },
  { from: 'soren-pike', to: 'aya-ren', trust: .78, affection: .43, respect: .88, tension: .03, familiarity: .60, reason: 'They are comfortable sharing silence and exchanging observations.' },
  { from: 'aya-ren', to: 'soren-pike', trust: .80, affection: .45, respect: .84, tension: .02, familiarity: .59, reason: 'Aya never interprets Soren’s quietness as rejection.' },
  { from: 'soren-pike', to: 'niko-sera', trust: .58, affection: .39, respect: .46, tension: .24, familiarity: .49, reason: 'Soren pretends Niko exhausts him more than he actually does.' },
  { from: 'niko-sera', to: 'soren-pike', trust: .67, affection: .48, respect: .71, tension: .18, familiarity: .54, reason: 'Niko believes making Soren laugh is an important civic service.' },
  { from: 'ilya-cross', to: 'silas-north', trust: .47, affection: .16, respect: .58, tension: .53, familiarity: .56, reason: 'The delayed bridge funding has become personal to Ilya.' },
  { from: 'silas-north', to: 'ilya-cross', trust: .71, affection: .20, respect: .79, tension: .38, familiarity: .55, reason: 'Silas agrees the bridge is urgent but cannot promise money he does not control.' },
  { from: 'oren-vale', to: 'mara-vale', trust: .84, affection: .78, respect: .74, tension: .20, familiarity: .96, reason: 'Siblings who love one another and know exactly how to annoy each other.' },
  { from: 'mara-vale', to: 'oren-vale', trust: .81, affection: .82, respect: .66, tension: .24, familiarity: .96, reason: 'Mara worries Oren mistakes avoiding conflict for keeping peace.' },
  { from: 'mira-sol', to: 'tomas-kade', trust: .70, affection: .60, respect: .62, tension: .20, familiarity: .68, reason: 'Competitive friendship centered on festivals and who can feed more people.' },
  { from: 'tomas-kade', to: 'mira-sol', trust: .72, affection: .62, respect: .64, tension: .22, familiarity: .68, reason: 'Tomas considers annoying Mira a treasured local tradition.' },
  { from: 'renna-voss', to: 'niko-sera', trust: .61, affection: .34, respect: .55, tension: .21, familiarity: .51, reason: 'They trade information but disagree about which secrets should stay secret.' },
  { from: 'jun-aris', to: 'silas-north', trust: .69, affection: .22, respect: .75, tension: .18, familiarity: .52, reason: 'Silas gives Jun access to public machinery; Jun gives Silas answers without flattery.' },
  { from: 'hana-mire', to: 'celia-ward', trust: .75, affection: .52, respect: .80, tension: .15, familiarity: .64, reason: 'They disagree about metaphors and agree about showing up for grieving people.' },
];
