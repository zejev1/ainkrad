export const CARDINAL_INITIAL_STRESS: Record<string, number> = {
  'mara-vale': .52, 'elias-thorn': .44, 'niko-sera': .38, 'aya-ren': .58, 'tomas-kade': .62,
  'liora-fen': .47, 'daren-holt': .64, 'mira-sol': .67, 'soren-pike': .41, 'celia-ward': .69,
  'oren-vale': .45, 'jun-aris': .50, 'eva-merin': .43, 'bram-rook': .56, 'kira-dawn': .57,
  'theo-lark': .61, 'hana-mire': .35, 'ilya-cross': .60, 'renna-voss': .55, 'silas-north': .63,
};

export const CARDINAL_INITIAL_TRUST_IN_TOWN: Record<string, number> = {
  'daren-holt': .72, 'silas-north': .66, 'renna-voss': .48, 'ilya-cross': .51, 'liora-fen': .58,
};

export type InitialWorldEvent = {
  kind: string;
  summary: string;
  importance: number;
  participants: string[];
};

export const CARDINAL_INITIAL_EVENTS: InitialWorldEvent[] = [
  { kind: 'system:initial_conditions', summary: 'Cardinal social simulation initialized.', importance: .10, participants: [] },
  { kind: 'resource:food_supply', summary: 'Flour and several staple deliveries are becoming unreliable.', importance: .56, participants: ['mira-sol', 'oren-vale', 'bram-rook'] },
  { kind: 'safety:warehouse_thefts', summary: 'Several small but coordinated warehouse thefts remain unexplained.', importance: .58, participants: ['daren-holt', 'renna-voss', 'bram-rook'] },
  { kind: 'health:seasonal_fever', summary: 'A mild but widespread fever is increasing demand for care and herbs.', importance: .43, participants: ['celia-ward', 'aya-ren'] },
  { kind: 'economy:bridge_funding', summary: 'The old bridge needs urgent work but funding is delayed.', importance: .51, participants: ['ilya-cross', 'silas-north', 'tomas-kade'] },
  { kind: 'resource:mill_fault', summary: 'The town mill has a recurring fault that resists ordinary mechanical explanations.', importance: .47, participants: ['jun-aris', 'elias-thorn'] },
];
