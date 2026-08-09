import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { BadgeManager } from './badge.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import St from 'gi://St';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';

const Point = Graphene.Point;

const ANIM_INTERVAL = 15;
const ANIM_INTERVAL_PAD = 15;
const ANIM_ICON_QUALITY = 2.0;
const ANIM_REENABLE_DELAY = 750;
const ANIM_ICON_RAISE = 0.75;
const ANIM_JUMP_HEIGHT = 0.35;
const ANIM_JUMP_SPEED = 0.7;
const ANIM_INTRO_HEIGHT = 0.4;
const ANIM_INTRO_SCALE_DURATION = 0.525;
const ANIM_INTRO_FADE_DURATION = 0.725;

export class Animator {
  constructor() {
    this._iconsContainer = null;
    this._intervalId = null;
    this.animationInterval = ANIM_INTERVAL;
    this._separator = null;
    this._draggableHooks = [];
  }

  enable() {
    if (this._iconsContainer) return;
    this._initialized = false;
    this._iconsContainer = new St.Widget({
      name: 'iconsContainer',
      reactive: false,
      can_focus: false
    });

    Main.uiGroup.add_child(this._iconsContainer);

    this._dragging = false;
    this._oneShotId = null;
    this._relayout = 8;
    this._pivot = new Point();

    this._badgeManager = new BadgeManager();
    this._badgeManager.onRebuild = () => {
      // Wake the loop so updateIcon() can refresh clone badge geometry/counts.
      this._startAnimation();
    };
  }

  disable() {
    this._endAnimation();
    if (this._oneShotId) { clearTimeout(this._oneShotId); this._oneShotId = null; }
    this._resetAppwellHooks();
    this._disconnectDraggableHooks();
    if (this._iconsContainer) {
      Main.uiGroup.remove_child(this._iconsContainer);
      this._iconsContainer.destroy();
      this._iconsContainer = null;
    }
    if (this._badgeManager) { this._badgeManager.destroy(); this._badgeManager = null; }
    if (this._separator) { this._separator.destroy(); this._separator = null; }
    if (this.dashContainer) this._restoreIcons();
  }

  _pauseForDrag() {
    if (!this._iconsContainer) {
      if (this._oneShotId) { clearTimeout(this._oneShotId); this._oneShotId = null; }
      return;
    }
    this._endAnimation();
    if (this._oneShotId) { clearTimeout(this._oneShotId); this._oneShotId = null; }
    this._resetAppwellHooks();
    if (this._iconsContainer) {
      Main.uiGroup.remove_child(this._iconsContainer);
      this._iconsContainer.destroy();
      this._iconsContainer = null;
    }
    if (this._badgeManager) { this._badgeManager.destroy(); this._badgeManager = null; }
    if (this._separator) { this._separator.destroy(); this._separator = null; }
    if (this.dashContainer) this._restoreIcons();
  }

  reloadIcons() {
    if (!this._iconsContainer) return;
    // Restore native icon opacity before destroying clones — the animation
    // loop may have zeroed them and _endAnimation won't run during a reload.
    this._iconsContainer.get_children().forEach(c => {
      if (c._bin?.first_child) c._bin.first_child.opacity = 255;
      this._setD2dBadgeOpacity(c._appwell, 255);
      this._disconnectAppwellHooks(c._appwell);
      c.destroy();
    });
    this._iconsCount = 0;
    // Suppress intro bounce on reload — icons are already known, this is
    // a rebuild (e.g. theme change), not a genuine first appearance.
    this._suppressIntro = true;
    this._startAnimation();
  }

  showAll() {
    if (this._iconsContainer) this._iconsContainer.visible = true;
  }

  hideAll() {
    if (this._iconsContainer) this._iconsContainer.visible = false;
  }

  isJumping() {
    if (!this._iconsContainer) return false;
    const icons = this._iconsContainer.get_children().filter(c => c.name !== 'cupertinisator-badge');
    // NOTE: _introJump intentionally excluded — intro is cosmetic and
    // should not influence dock visibility state machines.
    return icons.some(i => (i._clickJump > 0) || (i._attentionJump > 0));
  }


  resumeUrgentBounce() {
    if (!this._iconsContainer || this.extension?.urgent_bounce === false) return;
    let resumed = false;
    this._iconsContainer.get_children().forEach(icon => {
      if (!icon._appwell?.urgent || icon._appwell._dashAnimatorUrgentBounceActive === false) return;
      icon._attentionCooldown = 0;
      if (!(icon._attentionJump > 0)) icon._attentionJump = 1.0;
      resumed = true;
    });
    if (resumed) this._startAnimation();
  }

  requestUrgentBounce(appwell, forceFirstRun = false) {
    if (this.extension?.urgent_bounce === false) return;
    if (!appwell) return;
    appwell._dashAnimatorUrgentBounceActive = true;
    // First-time urgent procedure: keep the dock visible for three bounce
    // cycles before later hide requests are allowed to pause the urgent state.
    if (forceFirstRun || !(appwell._dashAnimatorUrgentFirstRunRemaining > 0)) {
      appwell._dashAnimatorUrgentFirstRunRemaining = 3;
    }

    const icon = this._findCloneForAppwell(appwell);
    if (!icon) return;

    icon._attentionCooldown = 0;
    if (!(icon._attentionJump > 0)) icon._attentionJump = 1.0;
    this._startAnimation();
  }

  clearUrgentBounce(appwell) {
    if (!appwell) return;
    appwell._dashAnimatorUrgentBounceActive = false;
    appwell._dashAnimatorUrgentFirstRunRemaining = 0;

    const icon = this._findCloneForAppwell(appwell);
    if (!icon) return;

    icon._attentionJump = 0;
    icon._attentionCooldown = 0;
  }

  _findCloneForAppwell(appwell) {
    if (!this._iconsContainer) return null;
    return this._iconsContainer.get_children().find(icon => icon._appwell === appwell) ?? null;
  }

  _animate() {
    if (!this._iconsContainer || !this.dashContainer) {
      this._endAnimation();
      return;
    }
    this.dash = this.dashContainer.dash;
    this._iconsContainer.width = 1; this._iconsContainer.height = 1;

    let animateIcons = this._iconsContainer.get_children().filter(c => c.name !== 'cupertinisator-badge');
    if (this._iconsCount !== animateIcons.length) {
      this._relayout = 8;
      this._iconsCount = animateIcons.length;
    }

    let dock_position = 'bottom';
    let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const pivot = this._pivot; pivot.x = 0.5; pivot.y = 1.0;
    let iconSize = (this.dash && this.dash.iconSize) ? this.dash.iconSize * (this.extension.scale || 1.0) : 48;

    switch (this.dashContainer._position) {
      case 0: dock_position = 'top'; pivot.x = 0.5; pivot.y = 0.0; break;
      case 1: dock_position = 'right'; pivot.x = 1.0; pivot.y = 0.5; break;
      case 2: dock_position = 'bottom'; break;
      case 3: dock_position = 'left'; pivot.x = 0.0; pivot.y = 0.5; break;
    }

    let icons = this._findIcons();

    icons.forEach((c) => {
      let bin = c._bin;
      if (!bin) return;
      let found = false;
      for (let i = 0; i < animateIcons.length; i++) {
        if (animateIcons[i]._bin === bin) { found = true; break; }
      }
      if (!found) {
        let uiIcon = new St.Widget({ name: 'icon', width: iconSize, height: iconSize, visible: true, opacity: 0 });
        uiIcon.pivot_point = pivot; uiIcon._bin = bin; uiIcon._appwell = c._appwell; uiIcon._label = c._label;
        uiIcon._wasActive = false;
        uiIcon._introJump = 0;

        if (bin.first_child) {
          let img = new St.Icon({ name: 'icon', icon_name: bin.first_child.icon_name || null, gicon: bin.first_child.gicon || null });
          img._source = bin; img.set_icon_size(iconSize * ANIM_ICON_QUALITY); img.set_scale(1 / ANIM_ICON_QUALITY, 1 / ANIM_ICON_QUALITY);
          uiIcon.add_child(img);
          if (this._badgeManager) this._badgeManager.attachToIcon(uiIcon);
        }

        if (uiIcon._appwell && !uiIcon._appwell._dashAnimatorHooked) {
          uiIcon._appwell._dashAnimatorHooked = true;
          uiIcon._appwell.connectObject(
            'clicked',
            () => {
              if (uiIcon._appwell.app && uiIcon._appwell.app.get_n_windows() === 0) {
                uiIcon._clickJump = 1.0;
                this._startAnimation();
                if (this.dashContainer?._animateIn) this.dashContainer._animateIn(0.2, 0);
              }
            },
            this._iconsContainer
          );
          uiIcon._appwell.connectObject(
            'notify::urgent',
            () => {
              if (uiIcon._appwell.urgent) {
                this.requestUrgentBounce(uiIcon._appwell, true);
                if (this.extension?.urgent_bounce && this.dashContainer?._animateIn) this.dashContainer._animateIn(0.2, 0);
              } else {
                this.clearUrgentBounce(uiIcon._appwell);
              }
            },
            this._iconsContainer
          );
        }

        if (this._initialized && !this._suppressIntro && c._appwell?.app && !(this.extension?._isHidden)) {
          let appId = c._appwell.app.get_id() ?? '';
          let isFavorite = AppFavorites.getAppFavorites().isFavorite(appId);
          let isLocationApp = !!c._appwell.app.location;
          if (!isFavorite && !isLocationApp) {
            uiIcon._introJump = 1.0;
          }
        }

        this._iconsContainer.add_child(uiIcon);
        this._connectDraggableHooks(c._draggable);
      }
    });

    // Clear after creation pass — suppression covers this tick only.
    this._suppressIntro = false;

    animateIcons.forEach((c) => {
      let orphan = true;
      for (let i = 0; i < icons.length; i++) { if (icons[i]._bin === c._bin) { orphan = false; break; } }
      if (orphan) {
        this._iconsContainer.remove_child(c);
      }
    });

    animateIcons = this._iconsContainer.get_children().filter(c => c.name !== 'cupertinisator-badge');

    // Update clone sizes and check state changes
    animateIcons.forEach((icon) => {
      let bin = icon._bin;
      if (icon.width !== iconSize || icon.height !== iconSize) {
        icon.set_size(iconSize, iconSize);
      }

      // Safety fallback check for dynamic children updates
      if (!icon.first_child && bin.first_child) {
        let img = new St.Icon({ name: 'icon', icon_name: bin.first_child.icon_name || null, gicon: bin.first_child.gicon || null });
        img._source = bin; img.set_icon_size(iconSize * ANIM_ICON_QUALITY); img.set_scale(1 / ANIM_ICON_QUALITY, 1 / ANIM_ICON_QUALITY);
        icon.add_child(img);
        if (this._badgeManager) this._badgeManager.attachToIcon(icon);
      }

      if (icon.first_child) {
        const targetIconSize = iconSize * ANIM_ICON_QUALITY;
        if (icon.first_child.icon_size !== targetIconSize) {
          icon.first_child.set_icon_size(targetIconSize);
        }
        const src = icon._bin?.first_child;
        if (src) {
          if (src.gicon && icon.first_child.gicon !== src.gicon)
            icon.first_child.gicon = src.gicon;
          else if (src.icon_name && icon.first_child.icon_name !== src.icon_name)
            icon.first_child.icon_name = src.icon_name;
        }
      }
    });

    const isHidden = this.extension?._isHidden === true;

    let didAnimate = false;
    animateIcons.forEach((icon) => {
      // Intro never plays while dock is hidden — kill immediately
      if (isHidden) {
        icon._introJump = 0;
      }

      if (!icon._bin.width || !icon._bin.height) {
        if (icon._introJump > 0) {
          didAnimate = true;
        }
        return;
      }

      if (icon._clickJump > 0) {
        icon._clickJump -= 0.0275 * ANIM_JUMP_SPEED;
        if (icon._clickJump <= 0) {
          // Re-arm only when dock is visible and no hide is pending.
          // If hide was requested mid-loop, let this arc finish landing then stop —
          // _endAnimation will fire _firePendingHide once everything settles.
          const pendingHide = !!this.extension?._pendingHide;
          if (!isHidden && !pendingHide && icon._appwell?.app?.get_state() === Shell.AppState.STARTING) {
            icon._clickJump = 1.0;
          } else {
            icon._clickJump = 0;
          }
        }
        didAnimate = true;
      }

      if (icon._introJump > 0) {
        icon._introJump -= 0.03 * ANIM_JUMP_SPEED;
        if (icon._introJump <= 0) {
          icon._introJump = 0;
        }
        didAnimate = true;
      }

      const urgentBounceEnabled = this.extension?.urgent_bounce !== false;
      if (!urgentBounceEnabled) {
        if (icon._appwell) icon._appwell._dashAnimatorUrgentBounceActive = false;
        icon._attentionJump = 0;
        icon._attentionCooldown = 0;
      }

      if (urgentBounceEnabled && icon._attentionJump > 0) {
        icon._attentionJump -= 0.0275 * ANIM_JUMP_SPEED;
        if (icon._attentionJump <= 0) {
          icon._attentionJump = 0;
          if (!isHidden) {
            // Only schedule next bounce cycle when dock is visible
            if (icon._appwell?._dashAnimatorUrgentFirstRunRemaining > 0) {
              icon._appwell._dashAnimatorUrgentFirstRunRemaining--;
            }
            if (icon._appwell?.urgent && icon._appwell._dashAnimatorUrgentBounceActive !== false) {
              icon._attentionCooldown = Math.round(1000 / this.animationInterval);
            }
          }
          // If a hide was deferred waiting for first-run cycles to finish,
          // check now whether all icons have cleared their first-run quota.
          if (this.extension?._pendingHide) {
            const anyFirstRunPending = this._iconsContainer?.get_children()
              .filter(c => c.name !== 'cupertinisator-badge')
              .some(c => (c._appwell?._dashAnimatorUrgentFirstRunRemaining ?? 0) > 0);
            if (!anyFirstRunPending) {
              this.extension._firePendingHide();
            }
          }
        }
        didAnimate = true;
      } else if (urgentBounceEnabled && !isHidden && !this.extension?._pendingHide && icon._appwell?.urgent && icon._appwell._dashAnimatorUrgentBounceActive !== false) {
        // New bounce cycles only fire when dock is visible and no hide is pending.
        // If hide was requested, current arc drains to zero, then _endAnimation
        // fires _firePendingHide — icon settles before dock slides.
        if (icon._attentionCooldown > 0) {
          icon._attentionCooldown--;
          didAnimate = true;
        } else {
          icon._attentionJump = 1.0;
          didAnimate = true;
        }
      }

      const isJumping = (icon._clickJump > 0 || icon._introJump > 0 || icon._attentionJump > 0);
      const forceClone = icon._forceClone === true;
      const cloneActive = isJumping || forceClone;

      if (!cloneActive) {
        if (icon._wasActive) {
          if (icon._bin.first_child) icon._bin.first_child.opacity = 255;
          this._setD2dBadgeOpacity(icon._appwell, 255);
          icon.opacity = 0;
          icon._wasActive = false;
        }
        return;
      }

      icon._wasActive = true;
      icon.visible = true;

      let pos = this._get_position(icon._bin);
      let jX = 0, jY = 0;
      let scale = 1.0;
      let opacity = 255;

      if (icon._clickJump > 0) {
        let off = Math.sin(icon._clickJump * Math.PI) * iconSize * ANIM_ICON_RAISE * scaleFactor * 1.65 * ANIM_JUMP_HEIGHT;
        if (dock_position === 'bottom') jY = -off; else if (dock_position === 'top') jY = off; else if (dock_position === 'left') jX = off; else if (dock_position === 'right') jX = -off;
      } else if (icon._introJump > 0) {
        let t = icon._introJump;
        let p = 1.0 - t;
        let scale_duration = ANIM_INTRO_SCALE_DURATION;
        let fade_duration = ANIM_INTRO_FADE_DURATION;
        let off = 0;
        opacity = fade_duration > 0
          ? Math.min(255, Math.max(0, Math.round(Math.sin((Math.min(p, fade_duration) / fade_duration) * Math.PI / 2) * 255)))
          : 255;
        if (p <= scale_duration) {
          scale = Math.sin((p / scale_duration) * Math.PI / 2);
          off = iconSize * ANIM_INTRO_HEIGHT * scaleFactor;
        } else {
          scale = 1.0;
          let drop_p = (p - scale_duration) / (1.0 - scale_duration);
          off = Math.cos(drop_p * Math.PI / 2) * iconSize * ANIM_INTRO_HEIGHT * scaleFactor;
        }
        if (dock_position === 'bottom') jY = -off; else if (dock_position === 'top') jY = off; else if (dock_position === 'left') jX = off; else if (dock_position === 'right') jX = -off;
      } else if (urgentBounceEnabled && icon._attentionJump > 0) {
        let off = Math.sin(icon._attentionJump * Math.PI) * iconSize * ANIM_ICON_RAISE * scaleFactor * 1.65 * ANIM_JUMP_HEIGHT;
        if (dock_position === 'bottom') jY = -off; else if (dock_position === 'top') jY = off; else if (dock_position === 'left') jX = off; else if (dock_position === 'right') jX = -off;
      }

      if (icon._bin.first_child) icon._bin.first_child.opacity = 0;
      this._setD2dBadgeOpacity(icon._appwell, 0);

      icon.set_position(Math.round(pos[0] + jX), Math.round(pos[1] + jY));
      icon.set_scale(scale, scale);
      icon.opacity = opacity;

      if (this._badgeManager) {
        const badgeCount = this._getD2dBadgeCount(icon._appwell);
        this._badgeManager.updateIcon(icon, iconSize, badgeCount, true);
      }
    });

    this._initialized = true;

    if (didAnimate)
      this._startAnimation();
    else
      this._endAnimation();
  }

  _findIcons() { return this.extension._findIcons(); }
  _get_position(obj) { return obj ? obj.get_transformed_position() : [0, 0]; }

  _beginAnimation() {
    if (this._intervalId === null) {
      this.animationInterval = ANIM_INTERVAL + (this.extension.animation_fps || 0) * ANIM_INTERVAL_PAD;
      this._intervalId = setInterval(this._animate.bind(this), this.animationInterval);
    }
  }

  _endAnimation() {
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
    this._relayout = 0;
    this._restoreCloneHandoffs();
    // All bounces have settled — if a hide was waiting for this moment, fire it now.
    if (this.extension?._pendingHide) {
      this.extension._firePendingHide();
    }
  }

  _restoreCloneHandoffs() {
    if (!this._iconsContainer) return;

    this._iconsContainer.get_children().forEach(icon => {
      if (icon._bin?.first_child) icon._bin.first_child.opacity = 255;
      this._setD2dBadgeOpacity(icon._appwell, 255);
      if (icon._badge) icon._badge.visible = false;
      icon.set_scale(1.0, 1.0);
      icon.opacity = 0;
    });
  }

  _startAnimation() { this._beginAnimation(); }

  _restoreIcons() {
    this._findIcons().forEach(c => {
      if (!c || !c._bin) return;
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

  _resetAppwellHooks() {
    if (!this._iconsContainer) return;
    this._iconsContainer.get_children().forEach(icon => {
      this._disconnectAppwellHooks(icon._appwell);
    });
  }

  _disconnectAppwellHooks(appwell) {
    if (!appwell) return;

    appwell.disconnectObject(this._iconsContainer);
    appwell._dashAnimatorHooked = false;
  }

  _connectDraggableHooks(draggable) {
    if (!draggable || this._draggableHooks.some(d => d === draggable)) return;

    draggable.connectObject(
      'drag-begin', () => {
        this._dragging = true;
        this._pauseForDrag();
      },
      'drag-end', () => {
        this._dragging = false;
        if (draggable) {
          this._safeDisconnectObject(draggable, this);
        }
        this._draggableHooks = this._draggableHooks.filter(d => d !== draggable);
        if (this.extension?.animator === this) {
          if (this._oneShotId) {
            clearTimeout(this._oneShotId);
          }
          this._oneShotId = setTimeout(() => {
            this._oneShotId = null;
            if (this.extension?.animator !== this) return;
            this.enable();
            this.extension._iconsDirty = true;
            this._startAnimation();
          }, ANIM_REENABLE_DELAY);
        }
      },
      this
    );
    this._draggableHooks.push(draggable);
  }

  _disconnectDraggableHook(draggable) {
    if (draggable) {
      // A dock rebuild can destroy the draggable before disable(); GJS then
      // has already removed its signal connections.
      this._safeDisconnectObject(draggable, this);
    }
  }

  _safeDisconnectObject(object, owner) {
    try {
      object.disconnectObject(owner);
    } catch (error) {
      // Destroyed actors may keep stale SignalTracker entries; treat the
      // known stale-connection error as already-cleaned state.
      if (!String(error).includes('No signal connection'))
        throw error;
    }
  }

  _disconnectDraggableHooks() {
    this._draggableHooks.forEach(draggable => this._disconnectDraggableHook(draggable));
    this._draggableHooks = [];
  }

  _getD2dBadgeBin(appwell) {
    const container = appwell?._iconContainer;
    if (!container) return null;
    if (container._notificationBadgeBin) return container._notificationBadgeBin;

    const children = container.get_children();
    const badgeBin = children.find(child => {
      const grandChildren = child.get_children();
      return grandChildren.some(c => c.has_style_class_name('notification-badge'));
    }) ?? null;

    if (badgeBin) {
      container._notificationBadgeBin = badgeBin;
    }
    return badgeBin;
  }

  _setD2dBadgeOpacity(appwell, opacity) {
    const badgeBin = this._getD2dBadgeBin(appwell);
    if (badgeBin) {
      if (opacity === 0) {
        badgeBin.translation_x = -9999;
      } else {
        badgeBin.translation_x = 0;
        badgeBin.opacity = 255;
      }
    }
  }

  _getD2dBadgeCount(appwell) {
    const badgeBin = this._getD2dBadgeBin(appwell);
    if (!badgeBin) return 0;

    const text = this._findBadgeText(badgeBin);
    if (text.includes('+')) return 100;

    const count = Number.parseInt(text, 10);
    if (Number.isFinite(count) && count > 0) return count;

    return badgeBin.visible ? 1 : 0;
  }

  _findBadgeText(actor) {
    if (!actor) return '';
    const text = actor.get_text ? actor.get_text() : '';
    if (text) return text;

    const children = actor.get_children();
    for (const child of children) {
      const childText = this._findBadgeText(child);
      if (childText) return childText;
    }
    return '';
  }
}

