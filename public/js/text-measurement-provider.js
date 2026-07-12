/**
 * text-measurement-provider.js
 *
 * Phase 8 — Real text measurement
 *
 * CanvasTextMeasurementProvider  — uses CanvasRenderingContext2D.measureText() with
 *   deterministic word-wrapping; works in browser and Worker contexts.
 * DeterministicFallbackTextMeasurementProvider — character-width approximation that
 *   works in any environment including Node.js test runners (no Canvas required).
 * createTextMeasurementProvider() — factory that returns the best available provider.
 *
 * Both providers share the same interface:
 *   measureTextHeight(text, { fontFamily, fontSize, fontWeight, fontStyle, lineHeight }, availableWidth)
 *   → number (height in pixels)
 */

// ============================================================
// CANVAS TEXT MEASUREMENT PROVIDER
// ============================================================

export class CanvasTextMeasurementProvider {
  constructor() {
    if (typeof OffscreenCanvas !== "undefined") {
      this._canvas = new OffscreenCanvas(1, 1);
    } else if (typeof document !== "undefined" && typeof document.createElement === "function") {
      this._canvas = document.createElement("canvas");
    } else {
      throw new Error("Canvas not available in this environment");
    }
    this._ctx = this._canvas.getContext("2d");
    if (!this._ctx) throw new Error("Could not get 2D rendering context");
  }

  static isAvailable() {
    return (
      typeof OffscreenCanvas !== "undefined" ||
      (typeof document !== "undefined" && typeof document.createElement === "function")
    );
  }

  /**
   * Measure pixel height of text rendered at the specified font settings,
   * using deterministic word-wrapping against availableWidth.
   *
   * @param {string} text
   * @param {{ fontFamily?, fontSize, fontWeight?, fontStyle?, lineHeight? }} options
   * @param {number} availableWidth - in pixels
   * @returns {number} height in pixels
   */
  measureTextHeight(
    text,
    { fontFamily = "Arial", fontSize, fontWeight = "normal", fontStyle = "normal", lineHeight = 1.5 },
    availableWidth,
  ) {
    if (!text || fontSize <= 0 || availableWidth <= 0) return 0;

    const fontStr = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    this._ctx.font = fontStr;
    const spaceWidth = this._ctx.measureText(" ").width;

    const segments = String(text).split(/\n/);
    let totalLines = 0;

    for (const seg of segments) {
      const words = seg.split(/\s+/).filter(w => w.length > 0);
      if (!words.length) {
        totalLines++; // count blank line
        continue;
      }
      let lineWidth = 0;
      let isFirstWord = true;

      for (const word of words) {
        const ww = this._ctx.measureText(word).width;
        const needed = isFirstWord ? ww : spaceWidth + ww;
        if (!isFirstWord && lineWidth + needed > availableWidth) {
          totalLines++;
          lineWidth = ww;
        } else {
          lineWidth += needed;
          isFirstWord = false;
        }
      }
      totalLines++; // commit last line of this segment
    }

    return Math.ceil(Math.max(1, totalLines) * fontSize * lineHeight);
  }
}

// ============================================================
// DETERMINISTIC FALLBACK PROVIDER
// ============================================================

/**
 * Character-width approximation — fully deterministic, no DOM or Canvas required.
 * Works in Node.js test environments.
 */
export class DeterministicFallbackTextMeasurementProvider {
  static isAvailable() {
    return true;
  }

  /**
   * @param {string} text
   * @param {{ fontSize, fontWeight?, lineHeight? }} options
   * @param {number} availableWidth
   * @returns {number} height in pixels
   */
  measureTextHeight(
    text,
    { fontSize, fontWeight = "normal", lineHeight = 1.5 },
    availableWidth,
  ) {
    if (!text || fontSize <= 0 || availableWidth <= 0) return 0;
    // Bold characters are approximately 12% wider than normal
    const charWidthFactor = fontWeight === "bold" ? 0.58 : 0.52;
    const avgCharWidth    = Math.max(1, fontSize * charWidthFactor);
    const charsPerLine    = Math.max(1, Math.floor(availableWidth / avgCharWidth));
    const segments        = String(text).split(/\n/);
    const totalLines      = segments.reduce((sum, seg) => {
      return sum + Math.max(1, Math.ceil(Math.max(1, seg.length) / charsPerLine));
    }, 0);
    return Math.ceil(totalLines * fontSize * lineHeight);
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Returns a CanvasTextMeasurementProvider when Canvas is available,
 * otherwise returns a DeterministicFallbackTextMeasurementProvider.
 * Always returns a usable provider — never throws.
 */
export function createTextMeasurementProvider() {
  if (CanvasTextMeasurementProvider.isAvailable()) {
    try {
      return new CanvasTextMeasurementProvider();
    } catch (_) {
      // fall through to deterministic fallback
    }
  }
  return new DeterministicFallbackTextMeasurementProvider();
}
