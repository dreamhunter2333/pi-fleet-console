import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { shouldUseVisualViewportHeight, getAppViewportHeight } = await jiti.import("./useViewportHeight.ts");

test("fits the iOS standalone content area without treating the status bar as a keyboard", () => {
  const state = { hasFocusedEditable: false, innerHeight: 852, viewportHeight: 793, viewportScale: 1 };
  assert.equal(shouldUseVisualViewportHeight(state), false);
  assert.equal(getAppViewportHeight(state, true), 793);
  assert.equal(getAppViewportHeight({ ...state, hasFocusedEditable: true }, true), 793);
  assert.equal(getAppViewportHeight(state, false), null);
});

test("standalone height follows rotation and keyboard dismissal without shrinking on pinch zoom", () => {
  const state = { hasFocusedEditable: false, innerHeight: 793, viewportHeight: 793, viewportScale: 1 };
  assert.equal(getAppViewportHeight(state, true), 793);
  assert.equal(getAppViewportHeight({ ...state, innerHeight: 390, viewportHeight: 390 }, true), 390);
  assert.equal(getAppViewportHeight({ ...state, viewportHeight: 396.5, viewportScale: 2 }, true), 793);
  assert.equal(getAppViewportHeight({ ...state, hasFocusedEditable: true, viewportHeight: 450 }, true), 450);
  assert.equal(getAppViewportHeight({ ...state, hasFocusedEditable: true, viewportHeight: 450 }, false), 450);
  assert.equal(getAppViewportHeight(state, true), 793);
});

test("uses the visual viewport for a focused editor when the keyboard shrinks it", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), true);
});

test("does not keep the keyboard height after the visual viewport restores", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});

test("restores the dynamic height as soon as the editor loses focus", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: false,
    innerHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), false);
});

test("does not mistake pinch zoom for an open keyboard", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 422,
    viewportScale: 2,
  }), false);
});

test("keeps the dynamic viewport height when the visual viewport is not reduced", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});

// iOS auto-zooms the page when a < 16px editable takes focus, and a user pinch
// zooms it too. The composer must still follow the keyboard in those cases.
test("detects the keyboard while the page is zoomed", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 350,
    viewportScale: 1.3,
  }), true);
});

test("ignores the Safari toolbar shift while an editor is focused", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 806,
    viewportScale: 1,
  }), false);
});

test("falls back to an unscaled comparison for a missing scale", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 510,
    viewportScale: 0,
  }), true);
});
