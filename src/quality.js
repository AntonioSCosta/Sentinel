// Graphics presets chosen in the menu (Baixa / Média / Alta).
export const QUALITY = {
  low:    { pixelRatio: .7, shadowMap: 1024, ssao: false, bloom: false, grass: 1500, texRes: '1k' },
  medium: { pixelRatio: 1,  shadowMap: 2048, ssao: false, bloom: true,  grass: 3500, texRes: '1k' },
  // SSAO costs more than it shows under the canopy, and a 4k shadow map is redrawn every frame: neither is worth the frames
  high:   { pixelRatio: 1,  shadowMap: 3072, ssao: false, bloom: true,  grass: 5500, texRes: '2k' },
};
export const QUALITY_LABELS = { low: 'Baixa', medium: 'Média', high: 'Alta' };
export const resolveQuality = q => (q in QUALITY ? q : 'medium');
