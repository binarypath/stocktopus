// Shared step helpers for the BDD harness.
//
// These thin wrappers exist so step definitions can express keyboard
// interactions in one line and have consistent pacing between keystrokes.
// The 100ms sleep matches the cadence a human typist would use and gives
// the terminal UI time to react between events.

const SLEEP_MS = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pressKey(page, key) {
  await page.keyboard.press(key);
  await sleep(SLEEP_MS);
}

async function pressSequence(page, seq) {
  for (const ch of seq) {
    await page.keyboard.press(ch);
    await sleep(SLEEP_MS);
  }
}

module.exports = {
  pressKey,
  pressSequence,
};
