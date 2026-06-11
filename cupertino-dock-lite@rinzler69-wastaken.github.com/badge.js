// badge.js — clone badge renderer, delegates count to D2D's notificationsMonitor
import Clutter from 'gi://Clutter';

export class BadgeManager {
  constructor() {
    this._icons = new Set();
    this._notificationsMonitor = null;
  }

  // Called by animator.js once D2D is ready.
  setNotificationsMonitor(monitor) {
    if (this._notificationsMonitor) {
      this._notificationsMonitor.disconnectObject(this);
    }
    this._notificationsMonitor = monitor;
    if (monitor) {
      monitor.connectObject('changed', () => {
        this._icons.forEach(uiIcon => this._applyBadge(uiIcon));
        this.onRebuild?.();
      }, this);
    }
    this._icons.forEach(uiIcon => this._applyBadge(uiIcon));
    this.onRebuild?.();
  }

  _getCount(appId) {
    if (!appId || !this._notificationsMonitor) return 0;
    return this._notificationsMonitor.getAppNotificationsCount(appId) ?? 0;
  }

  destroy() {
    if (this._notificationsMonitor) {
      this._notificationsMonitor.disconnectObject(this);
    }
    this._notificationsMonitor = null;
    this._icons.clear();
  }

  _applyBadge(uiIcon, countOverride = null, cloneActive = false) {
    const badge = uiIcon._badge;
    if (!badge || !badge._geometryReady) return;
    const appId = uiIcon._appwell?.app?.get_id() ?? null;
    const count = countOverride ?? this._getCount(appId);
    const show = cloneActive && count > 0;

    badge.visible = show;
  }

  attachToIcon(uiIcon) {
    const badge = new Clutter.Clone({
      name: 'cupertinisator-badge-container',
      visible: false,
      reactive: false,
    });

    badge._geometryReady = false;
    badge.set_pivot_point(0, 0);

    uiIcon.add_child(badge);
    uiIcon._badge = badge;
    this._icons.add(uiIcon);
  }

  updateIcon(uiIcon, iconSize, countOverride = null, cloneActive = false) {
    const badge = uiIcon._badge;
    if (!badge) return;

    const appId = uiIcon._appwell?.app?.get_id() ?? null;
    const count = countOverride ?? this._getCount(appId);
    const shouldShow = cloneActive && count > 0;

    this._positionLikeD2d(uiIcon, badge, iconSize);

    badge._geometryReady = true;
    badge.visible = shouldShow;
  }

  _positionLikeD2d(uiIcon, badge, iconSize) {
    const d2dBadge = this._getD2dBadgeActor(uiIcon._appwell);
    const badgeBin = this._getD2dBadgeBin(uiIcon._appwell);
    if (d2dBadge && uiIcon._bin) {
      const badgeSize = this._getTransformedSize(d2dBadge) || [0, 0];
      const lastBadgeSize = badge._lastBadgeSize || [0, 0];

      const needsUpdate = !badge._cachedOffsetReady ||
                          badge._lastIconSize !== iconSize ||
                          lastBadgeSize[0] !== badgeSize[0] ||
                          lastBadgeSize[1] !== badgeSize[1];

      if (needsUpdate) {
        const oldTx = badgeBin ? badgeBin.translation_x : 0;
        if (badgeBin) badgeBin.translation_x = 0;

        const badgePos = d2dBadge.get_transformed_position();
        const iconPos = uiIcon._bin.get_transformed_position();

        if (badgeBin) badgeBin.translation_x = oldTx;

        badge._cachedX = Math.round(badgePos[0] - iconPos[0]);
        badge._cachedY = Math.round(badgePos[1] - iconPos[1]);
        badge._cachedWidth = Math.round(badgeSize[0]);
        badge._cachedHeight = Math.round(badgeSize[1]);
        badge._cachedOffsetReady = true;
        badge._lastIconSize = iconSize;
        badge._lastBadgeSize = badgeSize;

        badge.source = d2dBadge;
        badge.x = badge._cachedX;
        badge.y = badge._cachedY;
        if (badgeSize[0] > 0 && badgeSize[1] > 0) {
          badge.set_size(badge._cachedWidth, badge._cachedHeight);
          badge.set_scale(1, 1);
        }
      }
      return;
    }

    const fallback = Math.round(Math.max(16, iconSize * 0.42));
    if (!badge._cachedOffsetReady || badge._lastIconSize !== iconSize || badge.source !== null) {
      badge.source = null;
      badge.set_size(fallback, fallback);
      badge.set_scale(1, 1);
      badge.x = Math.round(uiIcon.width - fallback * 0.72);
      badge.y = Math.round(-fallback * 0.28);
      badge._cachedOffsetReady = true;
      badge._lastIconSize = iconSize;
      badge._lastBadgeSize = [fallback, fallback];
    }
  }

  _getTransformedSize(actor) {
    if (!actor) return null;
    const size = actor.get_transformed_size();
    if (size && size[0] > 0 && size[1] > 0) return size;

    const width = actor.width;
    const height = actor.height;
    if (width > 0 && height > 0) return [width, height];

    return null;
  }

  _getD2dBadgeActor(appwell) {
    const badgeBin = this._getD2dBadgeBin(appwell);
    if (!badgeBin) return null;
    return this._findStyledBadgeActor(badgeBin) ?? badgeBin;
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

  _findStyledBadgeActor(actor) {
    if (!actor) return null;
    if (actor.has_style_class_name && actor.has_style_class_name('notification-badge')) return actor;

    const children = actor.get_children();
    for (const child of children) {
      const found = this._findStyledBadgeActor(child);
      if (found) return found;
    }
    return null;
  }
}
