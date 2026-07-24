import type { Eye, Species } from "./engine.ts";
import { HAT_ART, SPECIES_ART } from "./art-data.ts";

export function getArtFrame(species: Species, eye: Eye, frame: number = 0): string[] {
  const frames = SPECIES_ART[species];
  const f = frames[frame % frames.length];
  return f.map((line) => line.replace(/\{E\}/g, eye));
}

export { HAT_ART, SPECIES_ART };
