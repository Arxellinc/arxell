export const PHONEME_BLENDS: Record<string, Record<string, number>> = {
  AA: { PH_A: 1.0 },
  AE: { PH_A: 0.7, "PH_I-E": 0.2 },
  AH: { PH_A: 0.5 },
  AO: { PH_A: 0.45, "PH_O-U": 0.45 },
  AW: { PH_A: 0.6, "PH_O-U": 0.3 },
  AY: { PH_A: 0.55, "PH_I-E": 0.3 },
  EH: { "PH_I-E": 0.5, PH_A: 0.1 },
  ER: { "PH_I-E": 0.45, "PH_O-U": 0.15 },
  EY: { "PH_I-E": 0.6, PH_A: 0.15 },
  IH: { "PH_I-E": 0.65 },
  IY: { "PH_I-E": 0.9 },
  OW: { "PH_O-U": 0.7, PH_A: 0.15 },
  OY: { "PH_O-U": 0.5, PH_A: 0.25 },
  UH: { "PH_O-U": 0.55 },
  UW: { "PH_O-U": 0.9 },

  B: { "PH_B-P": 1.0 },
  P: { "PH_B-P": 0.95 },
  M: { "PH_B-P": 0.8 },

  F: { "PH_V-F": 1.0 },
  V: { "PH_V-F": 0.9 },

  TH: { "PH_D-S": 0.4, "PH_V-F": 0.15 },
  DH: { "PH_D-S": 0.35, "PH_V-F": 0.1 },
  T: { "PH_D-S": 0.6 },
  D: { "PH_D-S": 0.55 },
  S: { "PH_D-S": 0.75 },
  Z: { "PH_D-S": 0.7 },
  N: { "PH_D-S": 0.35 },
  L: { "PH_D-S": 0.3, "PH_I-E": 0.1 },
  R: { "PH_D-S": 0.25, "PH_O-U": 0.2 },

  SH: { "PH_CH-SH": 0.9 },
  ZH: { "PH_CH-SH": 0.8 },
  CH: { "PH_CH-SH": 0.85 },
  JH: { "PH_CH-SH": 0.75 },

  K: { "PH_D-S": 0.25 },
  G: { "PH_D-S": 0.25 },
  NG: { "PH_D-S": 0.15 },
  HH: { PH_A: 0.15 },

  W: { "PH_O-U": 0.65 },
  Y: { "PH_I-E": 0.45 },

  SIL: {},
  SP: {},
};

export const MORPH_BLEND_KEYS = [
  "PH_A",
  "PH_I-E",
  "PH_O-U",
  "PH_B-P",
  "PH_V-F",
  "PH_D-S",
  "PH_CH-SH",
] as const;
