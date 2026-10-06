// The breakdown's JSON schema: the worker's Claude call (breakdown.ts) and the MCP tools (mcp.ts) both use
// this one copy. parseStoryboard (frontend/src/storyboard/composition.ts) enforces the limits on every path.

const str = (description: string) => ({ type: 'string', description });
const object = (properties: Record<string, object>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const BREAKDOWN_SCHEMA = object({
  title: str('Film title, up to 200 characters.'),
  brief: str('The Vision Brief: 6-10 short lines (spine, look, method, motifs, lighting bible, script flags and decisions).'),
  scenes: { type: 'array', description: 'Scenes in script order, at least one.', items: object({
    heading: str('Scene N - <PART/SLUG> - INT./EXT. <Place> - <Time>'),
    lighting: str('The scene lighting setup: sources, quality, colour temperature, key, mood.'),
    shots: { type: 'array', description: 'Shots in order, at least one. Numbered from 1 across the whole film.', items: object({
      description: str('What we see.'),
      magnification: str('A shot code: EWS, ELS, WS, LS, FS, MLS, MWS, MS, MCU, CU, BCU, ECU, INS, OTS, POV, 2S.'),
      movement: str('Camera move, e.g. "Static", "Slow push in", "Truck left", "Handheld".'),
      lens: str('Focal length in mm (digits only), or N/A for graphics.'),
      angle: str('Eye level, high, low, overhead, worm, dutch...'),
      position: str('Where the camera physically is: distance in metres, height, side, what it looks past.'),
      lighting: str('How this shot is lit inside the scene setup.'),
      notes: str("Director's intent, with cross-references by shot number."),
      audio: str('Word-for-word VO / dialogue / on-screen text in the script\'s language, prefixed VO:, <CHARACTER>:, SFX:, Music:.'),
      duration: { type: 'integer', description: 'Whole seconds, 1-120.' },
    }) },
  }) },
});
