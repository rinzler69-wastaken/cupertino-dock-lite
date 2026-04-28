// badge.js — clone badge renderer, delegates count to D2D's notificationsMonitor
import Clutter from 'gi://Clutter';

export class BadgeManager {
  constructor() {
    this._icons = new Set();
    this._notificationsMonitor = null;
    this._monitorChangedId = null;
  }

  // Called by animator.js once D2D is ready.
  setNotificationsMonitor(monitor) {
    if (this._monitorChangedId && this._notificationsMonitor) {
      try { this._notificationsMonitor.disconnect(this._monitorChangedId); } catch (e) { }
      this._monitorChangedId = null;
    }
    this._notificationsMonitor = monitor;
    if (monitor) {
      try {
        this._monitorChangedId = monitor.connect('changed', () => {
          this._icons.forEach(uiIcon => { try { this._applyBadge(uiIcon); } catch (e) { } });
          try { this.onRebuild?.(); } catch (e) { }
        });
      } catch (e) { }
    }
    this._icons.forEach(uiIcon => { try { this._applyBadge(uiIcon); } catch (e) { } });
    try { this.onRebuild?.(); } catch (e) { }
  }

  _getCount(appId) {
    if (!appId || !this._notificationsMonitor) return 0;
    try { return this._notificationsMonitor.getAppNotificationsCount(appId) ?? 0; } catch (e) { return 0; }
  }

  destroy() {
    if (this._monitorChangedId && this._notificationsMonitor) {
      try { this._notificationsMonitor.disconnect(this._monitorChangedId); } catch (e) { }
    }
    this._monitorChangedId = null;
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
    try {
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
    } catch (e) { }
  }

  updateIcon(uiIcon, iconSize, countOverride = null, cloneActive = false) {
    try {
      const badge = uiIcon._badge;
      if (!badge) return;

      const appId = uiIcon._appwell?.app?.get_id() ?? null;
      const count = countOverride ?? this._getCount(appId);
      const shouldShow = cloneActive && count > 0;

      this._positionLikeD2d(uiIcon, badge, iconSize);

      badge._geometryReady = true;
      badge.visible = shouldShow;
    } catch (e) { }
  }

  _positionLikeD2d(uiIcon, badge, iconSize) {
    const d2dBadge = this._getD2dBadgeActor(uiIcon._appwell);
    if (d2dBadge && uiIcon._bin) {
      try {
        const badgePos = d2dBadge.get_transformed_position();
        const iconPos = uiIcon._bin.get_transformed_position();
        const badgeSize = this._getTransformedSize(d2dBadge);

        badge.source = d2dBadge;
        badge.x = Math.round(badgePos[0] - iconPos[0]);
        badge.y = Math.round(badgePos[1] - iconPos[1]);
        if (badgeSize) {
          badge.set_size(Math.round(badgeSize[0]), Math.round(badgeSize[1]));
          badge.set_scale(1, 1);
        }
        return;
      } catch (e) { }
    }

    const fallback = Math.round(Math.max(16, iconSize * 0.42));
    badge.source = null;
    badge.set_size(fallback, fallback);
    badge.set_scale(1, 1);
    badge.x = Math.round(uiIcon.width - fallback * 0.72);
    badge.y = Math.round(-fallback * 0.28);
  }

  _getTransformedSize(actor) {
    try {
      const size = actor.get_transformed_size?.();
      if (size && size[0] > 0 && size[1] > 0) return size;
    } catch (e) { }

    try {
      const width = actor.width;
      const height = actor.height;
      if (width > 0 && height > 0) return [width, height];
    } catch (e) { }

    return null;
  }

  _getD2dBadgeActor(appwell) {
    const badgeBin = this._getD2dBadgeBin(appwell);
    if (!badgeBin) return null;
    return this._findStyledBadgeActor(badgeBin) ?? badgeBin;
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

  _findStyledBadgeActor(actor) {
    try {
      if (actor.has_style_class_name?.('notification-badge')) return actor;

      const children = actor.get_children?.() ?? [];
      for (let i = 0; i < children.length; i++) {
        const found = this._findStyledBadgeActor(children[i]);
        if (found) return found;
      }
    } catch (e) { }

    return null;
  }
}
