import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import { Bouncer, isActorAlive } from './bouncer.js';
import { TooltipManager } from './tooltip.js';

const Point = Graphene.Point;

const ANIM_INTERVAL = 15;
const ANIM_INTERVAL_PAD = 15;
const ANIM_SCALE_COEF = 3.5;
const ANIM_ON_LEAVE_COEF = 1.0;
const ANIM_ICON_RAISE = 0.75;
const ANIM_ICON_SCALE = 1.8;
const ANIM_ICON_SCALE_REDUCE = 0.5;
const ANIM_ICON_HIT_AREA = 1.25;
const ANIM_ICON_QUALITY = 3.0;
const ANIM_JUMP_SPEED = 0.7;
const ANIM_DEBOUNCE_END_DELAY = 1000;

export class Magnifier extends Bouncer {
  enable() {
    super.enable();
    global.display.connectObject(
      'in-fullscreen-changed', () => this._onFullScreen(),
      this
    );
    this._connectDashContainerSignals();
  }

  disable() {
    this._tooltipManager?.restoreAll();
    this._tooltipManager = null;

    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    if (this._leaveSettleId) {
      clearTimeout(this._leaveSettleId);
      this._leaveSettleId = null;
    }
    global.display.disconnectObject(this);
    this._disconnectDashContainerSignals();
    super.disable();
  }

  set dashContainer(val) {
    this._disconnectDashContainerSignals();
    this._dashContainer = val;
    this._connectDashContainerSignals();
  }

  get dashContainer() {
    return this._dashContainer;
  }

  _connectDashContainerSignals() {
    if (!this._iconsContainer || !this._dashContainer) return;
    this._dashContainer.set_reactive(true);
    this._dashContainer.set_track_hover(true);
    this._dashContainer.connectObject(
      'motion-event', () => this._onMotionEvent(),
      'enter-event',  () => this._onEnterEvent(),
      'leave-event',  () => this._onLeaveEvent(),
      this
    );
  }

  _disconnectDashContainerSignals() {
    if (this._dashContainer) this._dashContainer.disconnectObject(this);
  }

  isMagnifying() {
    if (!this._iconsContainer) return false;
    let animateIcons = this._iconsContainer.get_children().filter(c => c.name !== 'cupertinisator-badge');
    return animateIcons.some(icon =>
      (icon._currentScale !== undefined && icon._currentScale > 1.01) ||
      (icon._targetScale  !== undefined && icon._targetScale  > 1.01)
    );
  }

  _onMotionEvent() { this._onEnterEvent(); }
  _onEnterEvent()  { this._inDash = true;  this._startAnimation(); }
  _onLeaveEvent()  { this._inDash = false; this._debounceEndAnimation(); }

  _onFullScreen() {
    if (!this._iconsContainer) return;
    if (!this._isInFullscreen()) this._iconsContainer.show();
    else                         this._iconsContainer.hide();
  }

  _isInFullscreen() {
    let m = this._dashContainer?.monitor || this._dashContainer?._monitor;
    return m ? m.inFullscreen : false;
  }

  _get_distance_sqr(p1, p2) {
    let a = p1[0] - p2[0], b = p1[1] - p2[1];
    return a * a + b * b;
  }

  _get_distance(p1, p2) {
    return Math.sqrt(this._get_distance_sqr(p1, p2));
  }

  _debounceEndAnimation() {
    if (this._inDash) {
      if (this._timeoutId) { clearTimeout(this._timeoutId); this._timeoutId = null; }
      return;
    }
    if (this._timeoutId) clearTimeout(this._timeoutId);
    this._timeoutId = setTimeout(
      this._endAnimation.bind(this),
      ANIM_DEBOUNCE_END_DELAY + this.animationInterval
    );
  }

  _startAnimation() {
    this._beginAnimation();
    this._debounceEndAnimation();
  }

  _endAnimation() {
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
    if (this._timeoutId)  { clearTimeout(this._timeoutId);   this._timeoutId  = null; }
    this._relayout = 0;
    this._persistBadgedClones();
    if (this.extension?._pendingHide) this.extension._firePendingHide();
  }

  _persistBadgedClones() {
    if (!this._iconsContainer || !this._badgeManager) return;
    this._iconsContainer.get_children().forEach(icon => {
      const app    = icon._appwell?.app ?? null;
      const count  = this._badgeManager._appMap?.[app?.get_id()] ?? 0;
      const hasBadge = count > 0;
      if (hasBadge) {
        if (icon._bin?.first_child) icon._bin.first_child.opacity = 0;
        this._setD2dBadgeOpacity(icon._appwell, 0);
        icon.visible = true;
        icon.opacity = 255;
      } else {
        if (icon._bin?.first_child) icon._bin.first_child.opacity = 255;
        this._setD2dBadgeOpacity(icon._appwell, 255);
        icon.visible = false;
      }
    });
  }

  resetMagnifier() {
    this._inDash = false;
    this._tooltipManager?.restoreAll();
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
    if (this._timeoutId)  { clearTimeout(this._timeoutId);   this._timeoutId  = null; }
    this._relayout = 0;
    this._restoreCloneHandoffs();
    this._restoreIcons();
    if (this._iconsContainer) {
      this._iconsContainer.get_children().forEach(icon => {
        icon._currentScale = 1.0;
        icon._targetScale  = 1.0;
      });
    }
  }

  // ── router ─────────────────────────────────────────────────────────────────

  _animate() {
    if (!this._iconsContainer || !this.dashContainer) { this._endAnimation(); return; }
    const pos = this.dashContainer._position;
    if (pos === 1 || pos === 3)
      this._animateVertical();
    else
      this._animateHorizontal();
  }

  // ── vertical dock (left / right) — bounce only ────────────────────────────
  // Magnification is WIP for vertical docks. Delegate straight to the parent
  // Bouncer animation loop — no magnification code path is involved at all.

  _animateVertical() {
    Bouncer.prototype._animate.call(this);
  }

  // ── shared per-frame helpers ───────────────────────────────────────────────

  _animSetup(isVertical = false) {
    const isHidden   = this.extension?._isHidden === true;
    this.dash        = this.dashContainer.dash;

    // For vertical, skip the width=1/height=1 reset — the rotated container
    // doesn't have meaningful w/h in the same sense, and resetting it causes
    // the rotation pivot to jump every frame.
    if (!isVertical) {
      this._iconsContainer.width = 1;
      this._iconsContainer.height = 1;
    }

    let animateIcons = this._iconsContainer.get_children().filter(c => c.name !== 'cupertinisator-badge');
    if (this._iconsCount !== animateIcons.length) {
      this._relayout   = 8;
      this._iconsCount = animateIcons.length;
    }

    const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const iconSize    = (this.dash && this.dash.iconSize)
      ? this.dash.iconSize * (this.extension.scale || 1.0) : 48;
    const magnify     = this.extension.animation_magnify !== undefined ? this.extension.animation_magnify : 0.5;
    const spread      = Math.max(1.0, magnify + 0.90);
    const raiseFactor = 0;
    let   peakScale   = ANIM_ICON_SCALE + magnify - ANIM_ICON_SCALE_REDUCE;
    if (peakScale < 1.1) peakScale = 1.1;

    return { isHidden, animateIcons, scaleFactor, iconSize, magnify, spread, raiseFactor, peakScale };
  }

  _syncClones(icons, animateIcons, iconSize, scaleFactor, pivot) {
    icons.forEach((c) => {
      let bin = c._bin;
      if (!bin) return;
      if (animateIcons.some(ai => ai._bin === bin)) return;

      let uiIcon = new St.Widget({
        name: 'icon', width: iconSize, height: iconSize, visible: true, opacity: 0
      });
      uiIcon.pivot_point   = pivot;
      uiIcon._bin          = bin;
      uiIcon._appwell      = c._appwell;
      uiIcon._label        = c._label;
      uiIcon._wasActive    = false;
      uiIcon._introJump    = 0;
      uiIcon._currentScale = 1.0;
      uiIcon._targetScale  = 1.0;

      if (bin.first_child) {
        let img = new St.Icon({
          name: 'icon',
          icon_name: bin.first_child.icon_name || null,
          gicon:     bin.first_child.gicon     || null
        });
        img._source = bin;
        img.set_icon_size(iconSize * ANIM_ICON_QUALITY);
        img.set_scale(1 / ANIM_ICON_QUALITY, 1 / ANIM_ICON_QUALITY);
        uiIcon.add_child(img);
        if (this._badgeManager) this._badgeManager.attachToIcon(uiIcon);
      }

      if (uiIcon._appwell && !uiIcon._appwell._dashAnimatorHooked) {
        uiIcon._appwell._dashAnimatorHooked = true;
        uiIcon._appwell.connectObject(
          'clicked', () => {
            if (uiIcon._appwell.app && uiIcon._appwell.app.get_n_windows() === 0) {
              uiIcon._clickJump = 1.0;
              this._startAnimation();
              if (this.dashContainer?._animateIn) this.dashContainer._animateIn(0.2, 0);
            }
          },
          this._iconsContainer
        );
        uiIcon._appwell.connectObject(
          'notify::urgent', () => {
            if (uiIcon._appwell.urgent) {
              this.requestUrgentBounce(uiIcon._appwell, true);
              if (this.extension?.urgent_bounce && this.dashContainer?._animateIn)
                this.dashContainer._animateIn(0.2, 0);
            } else {
              this.clearUrgentBounce(uiIcon._appwell);
            }
          },
          this._iconsContainer
        );
      }

      if (this._initialized && !this._suppressIntro &&
          c._appwell?.app && !(this.extension?._isHidden)) {
        let appId         = c._appwell.app.get_id() ?? '';
        let isFavorite    = AppFavorites.getAppFavorites().isFavorite(appId);
        let isLocationApp = !!c._appwell.app.location;
        if (!isFavorite && !isLocationApp) uiIcon._introJump = 1.0;
      }

      this._iconsContainer.add_child(uiIcon);
      this._connectDraggableHooks(c._draggable);
    });

    this._suppressIntro = false;

    animateIcons.forEach((c) => {
      if (!icons.some(i => i._bin === c._bin))
        this._iconsContainer.remove_child(c);
    });

    animateIcons = this._iconsContainer.get_children().filter(c => c.name !== 'cupertinisator-badge');

    animateIcons.forEach((icon) => {
      let bin = icon._bin;
      if (icon.width !== iconSize || icon.height !== iconSize) icon.set_size(iconSize, iconSize);

      if (!icon.first_child && bin.first_child) {
        let img = new St.Icon({
          name: 'icon',
          icon_name: bin.first_child.icon_name || null,
          gicon:     bin.first_child.gicon     || null
        });
        img._source = bin;
        img.set_icon_size(iconSize * ANIM_ICON_QUALITY);
        img.set_scale(1 / ANIM_ICON_QUALITY, 1 / ANIM_ICON_QUALITY);
        icon.add_child(img);
        if (this._badgeManager) this._badgeManager.attachToIcon(icon);
      }

      if (icon.first_child) {
        const targetIconSize = iconSize * ANIM_ICON_QUALITY;
        if (icon.first_child.icon_size !== targetIconSize)
          icon.first_child.set_icon_size(targetIconSize);
        const src = icon._bin?.first_child;
        if (src) {
          if      (src.gicon     && icon.first_child.gicon     !== src.gicon)     icon.first_child.gicon     = src.gicon;
          else if (src.icon_name && icon.first_child.icon_name !== src.icon_name) icon.first_child.icon_name = src.icon_name;
        }
      }
    });

    return animateIcons;
  }

  _tickBounceTimers(icon, isHidden) {
    let didAnimate = false;

    if (isHidden) icon._introJump = 0;

    if (!icon._bin.width || !icon._bin.height) {
      if (icon._introJump > 0) didAnimate = true;
      return { skip: true, didAnimate };
    }

    if (icon._clickJump > 0) {
      icon._clickJump -= 0.0275 * ANIM_JUMP_SPEED;
      if (icon._clickJump <= 0) {
        const pendingHide = !!this.extension?._pendingHide;
        if (!isHidden && !pendingHide &&
            icon._appwell?.app?.get_state() === Shell.AppState.STARTING)
          icon._clickJump = 1.0;
        else
          icon._clickJump = 0;
      }
      didAnimate = true;
    }

    if (icon._introJump > 0) {
      icon._introJump -= 0.03 * ANIM_JUMP_SPEED;
      if (icon._introJump <= 0) icon._introJump = 0;
      didAnimate = true;
    }

    const urgentBounceEnabled = this.extension?.urgent_bounce !== false;
    if (!urgentBounceEnabled) {
      if (icon._appwell) icon._appwell._dashAnimatorUrgentBounceActive = false;
      icon._attentionJump     = 0;
      icon._attentionCooldown = 0;
    }

    if (urgentBounceEnabled && icon._attentionJump > 0) {
      icon._attentionJump -= 0.0275 * ANIM_JUMP_SPEED;
      if (icon._attentionJump <= 0) {
        icon._attentionJump = 0;
        if (!isHidden) {
          if (icon._appwell?._dashAnimatorUrgentFirstRunRemaining > 0)
            icon._appwell._dashAnimatorUrgentFirstRunRemaining--;
          if (icon._appwell?.urgent && icon._appwell._dashAnimatorUrgentBounceActive !== false)
            icon._attentionCooldown = Math.round(1000 / this.animationInterval);
        }
        if (this.extension?._pendingHide) {
          const anyFirstRunPending = this._iconsContainer?.get_children()
            .filter(c => c.name !== 'cupertinisator-badge')
            .some(c => (c._appwell?._dashAnimatorUrgentFirstRunRemaining ?? 0) > 0);
          if (!anyFirstRunPending) this.extension._firePendingHide();
        }
      }
      didAnimate = true;
    } else if (urgentBounceEnabled && !isHidden && !this.extension?._pendingHide &&
               icon._appwell?.urgent &&
               icon._appwell._dashAnimatorUrgentBounceActive !== false) {
      if (icon._attentionCooldown > 0) {
        icon._attentionCooldown--;
        didAnimate = true;
      } else {
        icon._attentionJump = 1.0;
        didAnimate = true;
      }
    }

    return { skip: false, didAnimate };
  }

  _convergeScale(icon, nearestIcon) {
    if (icon._currentScale === undefined) icon._currentScale = icon.get_scale()[0];
    let fromScale = icon._currentScale;
    let scale     = icon._targetScale;

    let coef = nearestIcon ? ANIM_SCALE_COEF : ANIM_SCALE_COEF * ANIM_ON_LEAVE_COEF;
    if (this.extension?._isHidden) coef *= 3.5;

    scale = (fromScale * coef + scale) / (coef + 1);
    let didAnimate = false;
    if (Math.abs(scale - icon._targetScale) < 0.001) {
      scale = icon._targetScale;
    } else {
      didAnimate = true;
    }
    icon._currentScale = scale;
    return { scale, fromScale, didAnimate };
  }

  _updateIconOverlays(icon, iconSize, scaleFactor, dock_position) {
    if (icon._label) {
      if (!this._tooltipManager) {
        const magnify = this.extension.animation_magnify !== undefined
          ? this.extension.animation_magnify : 0.5;
        this._tooltipManager = new TooltipManager();
        this._tooltipManager.setParams(iconSize, scaleFactor, dock_position, magnify);
      }
      this._tooltipManager.updateIcon(icon, this._inDash);
    }
    if (this._badgeManager) {
      const badgeCount = this._getD2dBadgeCount(icon._appwell);
      this._badgeManager.updateIcon(icon, iconSize, badgeCount, true);
    }
  }

  _finishLoop(didAnimate) {
    this._initialized = true;
    if (this.extension?._isHidden) didAnimate = true;
    if (didAnimate) {
      this._startAnimation();
    } else {
      if (!this._inDash) this._endAnimation();
      else               this._debounceEndAnimation();
    }
  }

  // ── horizontal dock (top / bottom) ────────────────────────────────────────
  // Also called by _animateVertical with a swapped pointer — see below.

  _animateHorizontal(pointerOverride = null) {
    const isVerticalCaller = pointerOverride !== null;
    const { isHidden, scaleFactor, iconSize, raiseFactor, peakScale, spread, magnify } =
      this._animSetup(isVerticalCaller);

    const pivot = this._pivot;
    let dock_position;
    switch (this.dashContainer._position) {
      case 0:  dock_position = 'top';    pivot.x = 0.5; pivot.y = 0.0; break;
      case 3:  dock_position = 'left';   pivot.x = 0.0; pivot.y = 0.5; break; // grow rightward (inward)
      case 1:  dock_position = 'right';  pivot.x = 1.0; pivot.y = 0.5; break; // grow leftward (inward)
      default: dock_position = 'bottom'; pivot.x = 0.5; pivot.y = 1.0; break;
    }

    if (this._tooltipManager)
      this._tooltipManager.setParams(iconSize, scaleFactor, dock_position, magnify);

    let icons        = this._findIcons();
    let animateIcons = this._iconsContainer.get_children().filter(c => c.name !== 'cupertinisator-badge');
    animateIcons     = this._syncClones(icons, animateIcons, iconSize, scaleFactor, pivot);

    // Use swapped pointer when called from vertical
    const pointer = pointerOverride ?? global.get_pointer();

    // 4. distances
    let nearestIcon = null, nearestDistance = -1;
    animateIcons.forEach((icon) => {
      let pos        = this._get_position(icon._bin);

      // For vertical caller: swap the stored position axes so the horizontal
      // spread logic (which works on X) operates on what was originally Y.
      // We store the real positions too for set_position later.
      icon._realPos = [pos[0], pos[1]];
      let lpos = isVerticalCaller ? [pos[1], pos[0]] : [pos[0], pos[1]];

      let bposcenter = [lpos[0] + (iconSize * scaleFactor) / 2, lpos[1] + (iconSize * scaleFactor) / 2];
      let dst        = this._get_distance(pointer, bposcenter);
      icon._distance  = dst;
      icon._edgeNear  = lpos[0]; icon._edgeFar  = lpos[0] + iconSize * scaleFactor;
      icon._edgeNearV = lpos[1]; icon._edgeFarV = lpos[1] + iconSize * scaleFactor;
      if (nearestDistance === -1 || nearestDistance > dst) { nearestDistance = dst; nearestIcon = icon; }
      icon._nativeTarget = [lpos[0], lpos[1]]; icon._target = [lpos[0], lpos[1]]; icon._targetScale = 1;
    });
    if (!this._inDash || isHidden) nearestIcon = null;

    // 5. magnification targets
    if (isHidden) {
      animateIcons.forEach((icon) => {
        icon._targetScale = 1.0;
        let falloff = 0;
        let peakScaleDiff = peakScale - 1.0;
        if (peakScaleDiff > 0.001 && icon._currentScale > 1.0)
          falloff = (icon._currentScale - 1.0) / peakScaleDiff;
        let off = iconSize * raiseFactor * scaleFactor * falloff;
        icon._target = [...icon._nativeTarget];
        // raise is on swapped-Y (= real X for vertical) — inward means:
        //   bottom: up   (-Y)  | top: down  (+Y)
        //   left:   right(+sY) | right: left(-sY)   [sY = swapped Y = real X]
        if      (dock_position === 'bottom') icon._target[1] -= off;
        else if (dock_position === 'top')    icon._target[1] += off;
        else if (dock_position === 'left')   icon._target[1] += off; // swapped Y = real X, push right
        else if (dock_position === 'right')  icon._target[1] -= off; // push left
      });
    } else if (nearestIcon && this.extension.enable_magnification !== false) {
      let hitRadius  = iconSize * scaleFactor * (ANIM_ICON_HIT_AREA + spread * 2.5);
      let cursorAxis = pointer[0]; // X axis in (possibly swapped) space
      animateIcons.forEach((icon) => {
        let edgeDist = (cursorAxis < icon._edgeNear)
          ? (icon._edgeNear - cursorAxis)
          : (cursorAxis > icon._edgeFar ? (cursorAxis - icon._edgeFar) : 0);
        if (edgeDist >= hitRadius) return;
        let falloff  = Math.cos((edgeDist / hitRadius) * Math.PI / 2);
        let targetSz = 1.0 + (peakScale - 1.0) * falloff;
        if (targetSz > icon._targetScale) {
          icon._targetScale = targetSz;
          let off = iconSize * raiseFactor * scaleFactor * falloff;
          // same axis logic as hidden branch above
          if      (dock_position === 'bottom') icon._target[1] -= off;
          else if (dock_position === 'top')    icon._target[1] += off;
          else if (dock_position === 'left')   icon._target[1] += off;
          else if (dock_position === 'right')  icon._target[1] -= off;
        }
      });
    }

    // 6. convergence + render
    let didAnimate = false;
    animateIcons.forEach((icon) => {
      const bounce = this._tickBounceTimers(icon, isHidden);
      if (bounce.didAnimate) didAnimate = true;
      if (bounce.skip) return;

      const { scale, fromScale, didAnimate: scaleAnim } = this._convergeScale(icon, nearestIcon);
      if (scaleAnim) didAnimate = true;

      let isJumping    = (icon._clickJump > 0 || icon._introJump > 0 || icon._attentionJump > 0);
      let isMagnifying = (this._inDash || Math.abs(fromScale - 1.0) > 0.001 || Math.abs(scale - 1.0) > 0.001);
      let isActive     = isJumping || isMagnifying;

      const appId      = icon._appwell?.app?.get_id() ?? null;
      const hasBadge   = appId && ((this._badgeManager?._appMap?.[appId] ?? 0) > 0);
      const forceClone = hasBadge;

      const { jX, jY, scale: bounceScale, opacity } =
        this._calculateBounceOffset(icon, iconSize, scaleFactor, dock_position);
      icon.set_scale(scale * bounceScale, scale * bounceScale);

      // Bin layout — horizontal callers only.
      // For vertical docks: _dashContainer.height is set directly in
      // _animateVertical to elongate the pill — no bin dimensions are touched.
      const skipBinLayout = (icon._introJump > 0);
      if (!isVerticalCaller) {
        if (!skipBinLayout && (isActive || forceClone)) {
          let sz  = Math.round(iconSize * scale);
          let pad = Math.round(12 * scaleFactor);
          icon._bin.set_width(sz);
          if (icon._appwell?.get_parent()) icon._appwell.get_parent().set_width(sz + pad);
        } else if (!skipBinLayout) {
          icon._bin.set_width(Math.round(iconSize));
          icon._bin.set_height(Math.round(iconSize));
          if (icon._appwell?.get_parent()) {
            icon._appwell.get_parent().set_width(-1);
            icon._appwell.get_parent().set_height(-1);
          }
        }
      }

      if (icon._bin.first_child) icon._bin.first_child.opacity = (isActive || forceClone) ? 0 : 255;
      this._setD2dBadgeOpacity(icon._appwell, (isActive || forceClone) ? 0 : 255);
      icon.visible = isActive || forceClone;

      // Position: for vertical caller, un-swap axes back to real screen coords,
      // then the container rotation makes them visually correct.
      let renderX, renderY;
      if (isVerticalCaller) {
        // swapped space: _target[0] = realY (spread doesn't touch this)
        //                _target[1] = realX + raise offset
        // _nativeTarget[1] = original realX (no raise)
        // so the raise delta = _target[1] - _nativeTarget[1], applied to screen X
        renderX = icon._realPos[0] + (icon._target[1] - icon._nativeTarget[1]);
        renderY = icon._target[0];
      } else {
        renderX = icon._target[0];
        renderY = icon._target[1];
      }

      icon.set_position(Math.round(renderX + jX), Math.round(renderY + jY));
      icon.opacity = opacity;

      this._updateIconOverlays(icon, iconSize, scaleFactor, dock_position);
    });

    this._finishLoop(didAnimate);
  }

}

