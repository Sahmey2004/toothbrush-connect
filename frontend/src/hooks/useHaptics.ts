// FR-T4 / FR-P2: quadrant and overlap haptics where the browser supports vibration.
const vibrate = (pattern: number | number[]) => {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
};

export const haptics = {
  quadrant: () => vibrate(60),
  overlap: () => vibrate([40, 60, 40]),
  done: () => vibrate([80, 60, 80, 60, 160]),
  tap: () => vibrate(15),
};
