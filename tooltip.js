import { isActorAlive } from './bouncer.js';

/**
 * TooltipManager — lean tooltip elevation + tracking.
 *
 * D2D controls ALL visibility, opacity, and timing natively.
 * We do exactly two things:
 *
 *   1. showLabel hook — after D2D sets position, apply a fixed elevation
 *      (Y shift for top/bottom docks, X shift for left/right docks)
 *      computed from the peak magnification scale setting so the tooltip
 *      sits beyond the tallest the icon can get.
 *
 *   2. updateIcon (per-frame) — when D2D has already made the label
 *      visible, track position changes along the dock axis:
 *        - Horizontal docks (top/bottom): center X within the container
 *          width, and lock Y to the fixed elevated Y.
 *        - Vertical docks (left/right): center Y within the container
 *          height, and lock X to the fixed elevated X.
 */
export class TooltipManager {
  constructor() {
    // Map<DashItemContainer, original showLabel fn>
    this._hookedContainers = new Map();
    // Current frame params — written before the icon loop, read by showLabel hook.
    this._iconSize = 48;
    this._elevation = 0;  // px to offset from D2D's native position (stage coords)
    this._dockPosition = 'bottom';
  }

  /**
   * Call once per _animate() frame, before the per-icon loop.
   * Stores the frame-level params the showLabel hook will read.
   *
   * @param {number} iconSize        - Logical icon size
   * @param {number} scaleFactor     - St HiDPI scale factor
   * @param {string} dockPosition    - 'top'|'bottom'|'left'|'right'
   * @param {number} animationMagnify - The animation-magnify pref value (0–1)
   */
  setParams(iconSize, scaleFactor, dockPosition, animationMagnify) {
    this._iconSize = iconSize;
    this._dockPosition = dockPosition;
    // Peak scale formula:
    const peakScale = Math.max(1.0, 1.3 + (animationMagnify ?? 0.5));
    // Elevation = how far beyond D2D's native position the tallest icon reaches.
    this._elevation = Math.round(iconSize * (peakScale - 1.0) * scaleFactor);
  }

  /**
   * Called once per frame per clone icon. Only adjusts X/Y along the dock's scroll axis.
   * Never touches visibility or opacity.
   *
   * @param {object} icon      - Clone icon widget (._label, ._appwell)
   * @param {boolean} inDash   - Whether cursor is inside the dock
   */
  updateIcon(icon, inDash) {
    const label = icon._label;
    if (!label) return;
    if (!isActorAlive(label)) return;

    // Hook the container once so we can override showLabel's position.
    this._maybeHookContainer(icon);

    // Only adjust position while D2D is showing the label.
    if (!label.visible || !inDash) return;

    const container = icon._appwell?.get_parent?.();
    if (!container || !isActorAlive(container)) return;

    let [containerStageX, containerStageY] = [0, 0];
    try {
      const pos = container.get_transformed_position();
      containerStageX = pos[0];
      containerStageY = pos[1];
    } catch (_) {
      return;
    }

    const isVertical = (this._dockPosition === 'left' || this._dockPosition === 'right');

    if (isVertical) {
      // Centering vertically within the container's height (which changes as the icon magnifies).
      let labelHeight = label.height;
      if (labelHeight === 0) {
        const [, natH] = label.get_preferred_height(-1);
        labelHeight = natH;
      }
      if (labelHeight === 0) return;

      label.remove_transition('y');
      label.y = Math.round(containerStageY + (container.height - labelHeight) / 2);

      // Lock X to the pre-calculated elevated X.
      if (label._cupertinoFixedX !== undefined) {
        label.remove_transition('x');
        label.x = label._cupertinoFixedX;
      }
    } else {
      // Centering horizontally within the container's width.
      let labelWidth = label.width;
      if (labelWidth === 0) {
        const [, natW] = label.get_preferred_width(-1);
        labelWidth = natW;
      }
      if (labelWidth === 0) return;

      label.remove_transition('x');
      label.x = Math.round(containerStageX + (container.width - labelWidth) / 2);

      // Lock Y to the pre-calculated elevated Y.
      if (label._cupertinoFixedY !== undefined) {
        label.remove_transition('y');
        label.y = label._cupertinoFixedY;
      }
    }
  }

  /** Restore all hooked containers. Call on disable() / resetMagnifier(). */
  restoreAll() {
    this._hookedContainers.forEach((original, container) => {
      if (isActorAlive(container)) container.showLabel = original;
    });
    this._hookedContainers.clear();
  }

  // ── private ────────────────────────────────────────────────────────────────

  _maybeHookContainer(icon) {
    const appwell = icon._appwell;
    if (!appwell) return;
    const container = appwell.get_parent();
    if (!container || !container.showLabel) return;
    if (this._hookedContainers.has(container)) return;

    const original = container.showLabel.bind(container);
    this._hookedContainers.set(container, original);

    // Closure captures `this` (TooltipManager) for current params.
    const mgr = this;
    container.showLabel = function () {
      // Let D2D run normally (sets text, visibility, opacity, and base position).
      original();

      // Shift position along the cross-axis by peak scale height.
      if (mgr._elevation > 0) {
        switch (mgr._dockPosition) {
          case 'bottom':
            container.label.y -= mgr._elevation;
            break;
          case 'top':
            container.label.y += mgr._elevation;
            break;
          case 'left':
            container.label.x += mgr._elevation;
            break;
          case 'right':
            container.label.x -= mgr._elevation;
            break;
        }
      }

      // Store both so updateIcon can restore/lock them safely.
      container.label._cupertinoFixedX = container.label.x;
      container.label._cupertinoFixedY = container.label.y;
    };
  }
}
