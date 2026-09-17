// How the region looks, in one table.
//
// MERCENARY STRIKE is meant to be an upbeat game — bright, clean, construction-toy country
// you enjoy flying over. It had drifted grim: the light was down a third from the campaign
// it grew out of, the palette was earthy, and the tone curve was spending the frame in two
// dim brightness buckets. The grit and the dirt belong later, when the region has turned on
// you; the opening should look like a good day to be flying.
//
// The numbers here are the campaign's own lighting, which is the look this is returning to,
// adapted for a region a hundred times larger: the same generous sun and sky, and fog thin
// enough that ten kilometres of ground stays legible instead of disappearing into haze.

export const LOOK = {
  // Measured against the original rather than chosen by eye. BLOCKHAWK — the look this is
  // returning to — reads lum 0.445, sat 0.363, max 0.896, spread 4.8 across four places.
  // The surprise in that is that the original is neither brighter nor more saturated than
  // what this game already had: what makes it feel upbeat is real highlights and a broad
  // tonal range. This pairing lands at lum 0.436, sat 0.484, max 0.928, spread 4.8 — the
  // original's range, with a little more colour. AgX cannot get there from here: at every
  // exposure and light level it measured spread 2–3 and put up to 81% of the frame into one
  // brightness bucket, which is the pale wash this had become.
  tone: 'neutral',
  exposure: 1.5,

  sky: 0x7fb0a2,                     // a bright horizon, not an overcast one
  fog: { colour: 0xa8cfc2, density: 0.00092 },

  hemi: { sky: 0xc9e2d8, ground: 0x5d6a48, intensity: 1.78 },
  sun: { colour: 0xffdfa4, intensity: 3.75 },
  fill: { colour: 0x9ecfd4, intensity: 0.66 },

  sea: 0x1a7f8f,                     // reads as water you would swim in
  seaRoughness: 0.24,
  seaMetalness: 0.32,

  // The campaign's exact bloom. The threshold is above 1, so it catches only what is
  // genuinely over-bright in linear terms — snow, salt, glazing, the beacon, a muzzle
  // flash — and leaves the terrain alone. Dropping it to catch the ground blows the frame
  // out to a mean of 0.9: measured, and not what the original does.
  bloom: { strength: 0.22, radius: 0.55, threshold: 1.15 },

  // The grade runs after tone mapping, on the values you actually see.
  grade: { vignette: 0.085, saturation: 1.14, contrast: 1.06 },

  // Weather is the one thing allowed to take the brightness away, and only for the job that
  // carries it.
  closing: { sky: 0x6f8a86, fog: 0x8ea8a2, density: 0.0029, sun: 2.2, hemi: 1.25 },
};

// Each area gets its own tone without the game getting a new mood. These are all a few
// percent off white and applied at a third strength, so the Salt Pans feel like glare and
// the White Spine feels like altitude, while the region as a whole stays the same game.
export const REGION_GRADE = {
  delta: 0xe9fff2,        // cool, fresh, wet
  savanna: 0xfff3d4,      // warm gold
  badlands: 0xffe4c4,     // hot amber
  highland: 0xe6f2ff,     // cool blue timber
  alpine: 0xdcedff,       // cold, thin air
  coast: 0xe0faff,        // bright cyan
  jungle: 0xe7ffe2,       // green light under canopy
  saltflat: 0xfffdec,     // white glare
  basin: 0xfff8ea,        // neutral, worked ground
};
export const GRADE_STRENGTH = 0.34;
