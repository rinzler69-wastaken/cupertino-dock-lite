import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { BadgeManager } from './badge.js';
import St from 'gi://St';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';

import { setTimeout, setInterval, clearInterval, clearTimeout } from './utils.js';

const Point = Graphene.Point;

const ANIM_INTERVAL = 15;
const ANIM_INTERVAL_PAD = 15;
const ANIM_ICON_QUALITY = 2.0;
const ANIM_REENABLE_DELAY = 750;
const ANIM_ICON_RAISE = 0.75;

const DOT_CANVAS_SIZE = 96;

export class Animator {
  constructor() {
    this._enabled = false;
    this.animationInterval = ANIM_INTERVAL;
    this._separator = null;
  }

  enable() {
    if (this._enabled) return;
    this._iconsContainer = new St.Widget({
      name: 'iconsContainer',
      reactive: false,
      can_focus: false
    });

Main.uiGroup.add_child(this._iconsContainer);

    this._dotsContainer = new St.Widget({
      name: 'dotsContainer',
      reactive: false,
      can_focus: false
    });

    // CHANGE: Add directly to uiGroup
    Main.uiGroup.add_child(this._dotsContainer);

    this._enabled = true;
    this._dragging = false;
    this._oneShotId = null;
    this._relayout = 8;
    this.show_dots = true;
    this._badgeManager = new BadgeManager();
    // When badge state changes, wake the loop so active clones can refresh
    // their badge geometry/counts.
    this._badgeManager.onRebuild = () => {
      // Wake the loop so updateIcon() can refresh clone badge geometry/counts.
      this._startAnimation();
    };
  }

  disable() {
    if (!this._enabled) return;
    this._enabled = false;
    this._endAnimation();
    if (this._oneShotId) { clearInterval(this._oneShotId); this._oneShotId = null; }
    if (this._iconsContainer) {
Main.uiGroup.remove_child(this._iconsContainer);
      this._iconsContainer.destroy();
      this._iconsContainer = null;
Main.uiGroup.remove_child(this._dotsContainer);
      this._dotsContainer.destroy();
      this._dotsContainer = null;
    }
    if (this._badgeManager) { this._badgeManager.destroy(); this._badgeManager = null; }
    this._dots = [];
    if (this._separator) { this._separator.destroy(); this._separator = null; }
    if (this.dashContainer) this._restoreIcons();
  }

  reloadIcons() {
    if (!this._enabled) return;
    if (this._iconsContainer) {
      this._iconsContainer.get_children().forEach(c => {
        if (c._appwell) c._appwell._dashAnimatorHooked = false;
        c.destroy();
      });
    }
    if (this._dotsContainer) {
      this._dotsContainer.destroy_all_children();
      this._dots = [];
    }
    this._iconsCount = 0;
    this._startAnimation();
  }

  showAll() {
    if (this._iconsContainer) this._iconsContainer.visible = true;
    if (this._dotsContainer) this._dotsContainer.visible = true;
  }

  hideAll() {
    if (this._iconsContainer) this._iconsContainer.visible = false;
    if (this._dotsContainer) this._dotsContainer.visible = false;
  }

  isJumping() {
    if (!this._iconsContainer) return false;
    let icons = this._iconsContainer.get_children().filter(c => c.name !== 'cupertinisator-badge');
    // Treat the urgent "quiet gap" as active so auto-hide doesn't cancel
    // the next bounce cycle.
    return icons.some(i =>
      (i._clickJump > 0) ||
      (i._attentionJump > 0) ||
      (i._appwell?.urgent && (i._attentionCooldown > 0))
    );
  }




  _precreate_dots(count) {
    if (!this._dots) this._dots = [];
    if (this.show_dots && this.extension.xDot) {
      for (let i = 0; i < count - this._dots.length; i++) {
        let dot = new this.extension.xDot(DOT_CANVAS_SIZE);
        this._dots.push(dot);
        this._dotsContainer.add_child(dot);
        dot.set_position(0, 0);
      }
    }
    this._dots.forEach(d => { d.visible = false; });
  }

  _animate() {
    if (!this._iconsContainer || !this.dashContainer) return;
    this.dash = this.dashContainer.dash;
    if (this._relayout > 0 && this.extension && this.extension._updateLayout) {
      this.extension._updateLayout();
      this._relayout--;
    }
    this._iconsContainer.width = 1; this._iconsContainer.height = 1;
    this._dotsContainer.width = 1; this._dotsContainer.height = 1;

    let jumping = this.isJumping();

    let animateIcons = this._iconsContainer.get_children().filter(c => c.name !== 'cupertinisator-badge');
    if (this._iconsCount != animateIcons.length) {
      this._relayout = 8;
      this._iconsCount = animateIcons.length;
    }

    let dock_position = 'bottom';
    let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    let pivot = new Point(); pivot.x = 0.5; pivot.y = 1.0;
    let iconSize = (this.dash && this.dash.iconSize) ? this.dash.iconSize * (this.extension.scale || 1.0) : 48;

    switch (this.dashContainer._position) {
      case 0: dock_position = 'top'; pivot.x = 0.5; pivot.y = 0.0; break;
      case 1: dock_position = 'right'; pivot.x = 1.0; pivot.y = 0.5; break;
      case 2: dock_position = 'bottom'; break;
      case 3: dock_position = 'left'; pivot.x = 0.0; pivot.y = 0.5; break;
    }

    let visible_dots = 0;
    let icons = this._findIcons();

    icons.forEach((c) => {
      let bin = c._bin;
      if (!bin) return;
      if (c._appwell && c._appwell.app && c._appwell.app.get_n_windows() > 0) visible_dots++;
      let found = false;
      for (let i = 0; i < animateIcons.length; i++) {
        if (animateIcons[i]._bin == bin) { found = true; break; }
      }
      if (!found) {
        let uiIcon = new St.Widget({ name: 'icon', width: iconSize, height: iconSize });
        uiIcon.pivot_point = pivot; uiIcon._bin = bin; uiIcon._appwell = c._appwell; uiIcon._label = c._label;
        this._iconsContainer.add_child(uiIcon);
        let draggable = c._draggable;
        if (draggable && !draggable._dragBeginId) {
          draggable._dragBeginId = draggable.connect('drag-begin', () => { this._dragging = true; this.disable(); });
          draggable._dragEndId = draggable.connect('drag-end', () => { this._dragging = false; this._oneShotId = setTimeout(this.enable.bind(this), ANIM_REENABLE_DELAY); });
        }
      }
    });

    this._precreate_dots(visible_dots);


    animateIcons.forEach((c) => {
      let orphan = true;
      for (let i = 0; i < icons.length; i++) { if (icons[i]._bin == c._bin) { orphan = false; break; } }
      if (orphan) this._iconsContainer.remove_child(c);
    });

    animateIcons = this._iconsContainer.get_children().filter(c => c.name !== 'cupertinisator-badge');
    let cornerPos = this._get_position(this.dashContainer);
    animateIcons.sort((a, b) => {
      let dstA = this._get_distance_sqr(cornerPos, this._get_position(a._bin));
      let dstB = this._get_distance_sqr(cornerPos, this._get_position(b._bin));
      return dstA - dstB;
    });

    let dotIndex = 0;
    animateIcons.forEach((icon) => {
      let bin = icon._bin;
      let pos = this._get_position(bin);
      icon.set_size(iconSize, iconSize);

      if (!icon.first_child && bin.first_child) {
        let img = new St.Icon({ name: 'icon', icon_name: bin.first_child.icon_name || null, gicon: bin.first_child.gicon || null });
        img._source = bin; img.set_icon_size(iconSize * ANIM_ICON_QUALITY); img.set_scale(1 / ANIM_ICON_QUALITY, 1 / ANIM_ICON_QUALITY);
        icon.add_child(img);
        if (this._badgeManager) this._badgeManager.attachToIcon(icon);
        if (icon._appwell && !icon._appwell._dashAnimatorHooked) {
          icon._appwell._dashAnimatorHooked = true;
          icon._appwell.connect('clicked', () => {
            if (icon._appwell.app && icon._appwell.app.get_n_windows() === 0) { icon._clickJump = 1.0; this._startAnimation(); if (this.dashContainer?._animateIn) this.dashContainer._animateIn(0.2, 0); }
          });
          icon._appwell.connect('notify::urgent', () => {
            if (icon._appwell.urgent && !(icon._attentionJump > 0)) { icon._attentionJump = 1.0; icon._attentionCooldown = 0; this._startAnimation(); if (this.dashContainer?._animateIn) this.dashContainer._animateIn(0.2, 0); }
          });
        }
      }

    });


    let didAnimate = false;
    animateIcons.forEach((icon) => {
let pos = this._get_position(icon._bin);

      icon.visible = !isNaN(pos[0]) && pos[0] !== 0; // Guard (0,0) sticking
      if (!icon.visible) return;

      let jX = 0, jY = 0;
      if (icon._clickJump > 0) {
        let jh = this.extension.jump_height || 0.85;
        let off = Math.sin(icon._clickJump * Math.PI) * iconSize * ANIM_ICON_RAISE * scaleFactor * 1.65 * jh;
        if (dock_position === 'bottom') jY = -off; else if (dock_position === 'top') jY = off; else if (dock_position === 'left') jX = off; else if (dock_position === 'right') jX = -off;
        icon._clickJump -= 0.0275 * (this.extension.jump_speed || 1.0);
        if (icon._clickJump <= 0) {
          const app = icon._appwell?.app;
          const appId = app?.get_id() ?? '';
          // Chromium-based browsers report STARTING for a long time across
          // multiple profile windows — cap them at one bounce cycle.
          const isChromium = appId.includes('chromium') || appId.includes('chrome') ||
                             appId.includes('brave') || appId.includes('microsoft-edge') ||
                             appId.includes('opera');
          if (!isChromium && app?.get_state() === Shell.AppState.STARTING) {
            icon._clickJump = 1.0; // App still loading — continue bouncing
          } else {
            icon._clickJump = 0;
          }
        }
        didAnimate = true;
      }
      if (icon._attentionJump > 0) {
        let jh = this.extension.jump_height || 0.85;
        let off = Math.sin(icon._attentionJump * Math.PI) * iconSize * ANIM_ICON_RAISE * scaleFactor * 1.65 * jh;
        if (dock_position === 'bottom') jY = -off; else if (dock_position === 'top') jY = off; else if (dock_position === 'left') jX = off; else if (dock_position === 'right') jX = -off;
        icon._attentionJump -= 0.0275 * (this.extension.jump_speed || 1.0);
        if (icon._attentionJump <= 0) {
          icon._attentionJump = 0;
          // If still urgent — start the 1s quiet gap before next bounce cycle
          if (icon._appwell?.urgent) {
            icon._attentionCooldown = Math.round(1000 / this.animationInterval);
          }
        }
        didAnimate = true;
      } else if (icon._appwell?.urgent) {
        if (icon._attentionCooldown > 0) {
          icon._attentionCooldown--;
          didAnimate = true;
        } else {
          // Quiet gap expired — fire next bounce cycle
          icon._attentionJump = 1.0;
          didAnimate = true;
        }
      }

      let isJumping = (icon._clickJump > 0 || icon._attentionJump > 0);
      let isActive = isJumping;

      const badgeCount = this._getD2dBadgeCount(icon._appwell);
      const forceClone = icon._forceClone === true;
      const cloneActive = isActive || forceClone;

      const canAffectLayout = (!this.extension._isHidden || jumping);
      if (canAffectLayout && cloneActive) {
        let sz = Math.round(iconSize);
        let pad = Math.round(12 * scaleFactor);
        if (dock_position === 'top' || dock_position === 'bottom') {
          icon._bin.set_width(sz);
          if (icon._appwell?.get_parent()) icon._appwell.get_parent().set_width(sz + pad);
        } else {
          icon._bin.set_height(sz);
          if (icon._appwell?.get_parent()) icon._appwell.get_parent().set_height(sz + pad);
        }
      } else if (canAffectLayout) {
        // Fully restore native layout constraints when the clone is inactive,
        // otherwise fixed widths/heights can keep icons spaced apart.
        let sz = Math.round(iconSize);
        if (dock_position === 'top' || dock_position === 'bottom') {
          icon._bin.set_width(sz);
          if (icon._appwell?.get_parent()) icon._appwell.get_parent().set_width(-1);
        } else {
          icon._bin.set_height(sz);
          if (icon._appwell?.get_parent()) icon._appwell.get_parent().set_height(-1);
        }
      }

      if (icon._bin.first_child) icon._bin.first_child.opacity = cloneActive ? 0 : 255;
      this._setD2dBadgeOpacity(icon._appwell, cloneActive ? 0 : 255);
      icon.visible = cloneActive;

      icon.set_position(Math.round(pos[0] + jX), Math.round(pos[1] + jY));

      if (this.show_dots && icon._appwell?.app?.get_n_windows() > 0) {
        let dot = this._dots[dotIndex++];
        if (dot) {
          dot.visible = true;
          let cx = pos[0] + jX + (iconSize) / 2; let cy = pos[1] + jY + (iconSize) / 2;
          let dy = 0;
          if (dock_position === 'bottom') dy = (iconSize) / 2 + 6 * scaleFactor;
          else if (dock_position === 'top') dy = -(iconSize) / 2 - 6 * scaleFactor;
          dot.set_position(Math.round(cx - 12 * scaleFactor), Math.round(cy + dy - 12 * scaleFactor));
        }
      }
      if (this._badgeManager) this._badgeManager.updateIcon(icon, iconSize, badgeCount, cloneActive);
    });
    if (didAnimate) this._startAnimation();
  }

  _findIcons() { return this.extension._findIcons(); }
  _get_x(obj) { return obj ? obj.get_transformed_position()[0] : 0; }
  _get_y(obj) { return obj ? obj.get_transformed_position()[1] : 0; }
  _get_position(obj) { return [this._get_x(obj), this._get_y(obj)]; }
  _get_distance_sqr(p1, p2) { let a = p1[0] - p2[0], b = p1[1] - p2[1]; return a * a + b * b; }

  _beginAnimation() {
    if (this._intervalId == null) {
      this.animationInterval = ANIM_INTERVAL + (this.extension.animation_fps || 0) * ANIM_INTERVAL_PAD;
      this._intervalId = setInterval(this._animate.bind(this), this.animationInterval);
    }
  }

  _endAnimation() {
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
    if (this._timeoutId) { clearTimeout(this._timeoutId); this._timeoutId = null; }
    this._relayout = 0;
    this._restoreCloneHandoffs();
  }

  _restoreCloneHandoffs() {
    if (!this._iconsContainer) return;

    this._iconsContainer.get_children().forEach(icon => {
      if (icon._bin?.first_child) icon._bin.first_child.opacity = 255;
      this._setD2dBadgeOpacity(icon._appwell, 255);
      if (icon._badge) icon._badge.visible = false;
      icon.visible = false;
    });
  }


  _onFocusWindow() { this._relayout = 8; if (!this._intervalId) this._startAnimation(); }

  _onFullScreen() {
    if (!this._iconsContainer) return;
    if (!this._isInFullscreen()) { this._iconsContainer.show(); this._dotsContainer.show(); }
    else { this._iconsContainer.hide(); this._dotsContainer.hide(); }
  }

  _isInFullscreen() {
    let m = this.dashContainer.monitor || this.dashContainer._monitor;
    return m ? m.inFullscreen : false;
  }

  _startAnimation() { this._beginAnimation(); }

  _restoreIcons() {
    this._findIcons().forEach(c => {
      if (!c || !c._bin) return; // Safety check
      if (c._icon) c._icon.opacity = 255;
      if (c._bin?.first_child) c._bin.first_child.opacity = 255;
      this._setD2dBadgeOpacity(c._appwell, 255);
      if (this.dashContainer && this.dash) {
        let sz = this.dash.iconSize * (this.extension.scale || 1.0);
        if (this.dashContainer._position % 2 === 0) {
          c._bin.set_width(sz); if (c._appwell?.get_parent()) c._appwell.get_parent().set_width(-1);
        } else {
          c._bin.set_height(sz); if (c._appwell?.get_parent()) c._appwell.get_parent().set_height(-1);
        }
      }
    });
    if (this.dash?._box) { this.dash._box.get_children().forEach(c => { if (c.first_child) c.first_child.opacity = 255; }); }
  }

  _getD2dBadgeBin(appwell) {
    try {
      const container = appwell?._iconContainer;
      if (!container) return null;
      if (container._notificationBadgeBin) return container._notificationBadgeBin;

      return container.get_children?.().find(child =>
        child.get_children?.()?.some?.(c => c.has_style_class_name?.('notification-badge'))
      ) ?? null;
    } catch (e) {
      return null;
    }
  }

  _setD2dBadgeOpacity(appwell, opacity) {
    try {
      const badgeBin = this._getD2dBadgeBin(appwell);
      if (badgeBin) badgeBin.opacity = opacity;
    } catch (e) { }
  }

  _getD2dBadgeCount(appwell) {
    try {
      const badgeBin = this._getD2dBadgeBin(appwell);
      if (!badgeBin) return 0;

      const text = this._findBadgeText(badgeBin);
      if (text.includes('+')) return 100;

      const count = Number.parseInt(text, 10);
      if (Number.isFinite(count) && count > 0) return count;

      return badgeBin.visible ? 1 : 0;
    } catch (e) {
      return 0;
    }
  }

  _findBadgeText(actor) {
    try {
      const text = actor.get_text?.();
      if (text) return text;

      const children = actor.get_children?.() ?? [];
      for (let i = 0; i < children.length; i++) {
        const childText = this._findBadgeText(children[i]);
        if (childText) return childText;
      }
    } catch (e) { }

    return '';
  }
}
