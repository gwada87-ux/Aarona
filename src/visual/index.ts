export type { Palette } from './palette/Palette';
export { hexToColor, lerpColor, defaultPalette } from './palette/Palette';
export { FlashLimiter, FlashRateGate, NORMAL_MODE, REDUCED_FLASHING_MODE } from './safety/FlashLimiter';
export type { FlashLimiterConfig } from './safety/FlashLimiter';
export type { Layer, LayerKind, LayerParams, LayerInitContext } from './scene/Layer';
export { Scene } from './scene/Scene';
export { createPulseStyle } from './styles/pulse/createPulseStyle';
export { createFieldStyle } from './styles/field/createFieldStyle';
export { createSpectrumProStyle } from './styles/spectrum-pro/createSpectrumProStyle';
