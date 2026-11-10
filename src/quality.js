// Graphics presets chosen in the menu (Baixa / Média / Alta).
export const QUALITY = {
  low:    { pixelRatio: .75, shadowMap: 1024, ssao: false, bloom: false, grass: 2000, texRes: '1k' },
  medium: { pixelRatio: 1,   shadowMap: 2048, ssao: false, bloom: true,  grass: 4000, texRes: '1k' },
  high:   { pixelRatio: 1.25, shadowMap: 4096, ssao: true, bloom: true,  grass: 7000, texRes: '2k' },
};
export const QUALITY_LABELS = { low: 'Baixa', medium: 'Média', high: 'Alta' };
export const resolveQuality = q => (q in QUALITY ? q : 'medium');
