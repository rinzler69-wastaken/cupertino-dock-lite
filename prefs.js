import GLib from 'gi://GLib';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { getCamleStatus, patchCamle, restoreCamle } from './patcher.js';

export default class DashAnimatorPreferences extends ExtensionPreferences {
    _d2dExtension() {
        try {
            return this._extensionManager?.lookup?.('dash-to-dock@micxgx.gmail.com')
                ?? globalThis.Main?.extensionManager?.lookup('dash-to-dock@micxgx.gmail.com')
                ?? null;
        } catch (e) { return null; }
    }

    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.cupertino-dock-lite');

        // ── Animation page ────────────────────────────────────────────────────
        const animPage = new Adw.PreferencesPage({
            title: 'Animation',
            icon_name: 'media-playback-start-symbolic',
        });

        const buildScaleRow = (key, title, subtitle, lower, upper, step) => {
            const row = new Adw.ActionRow({ title, subtitle });
            const scale = new Gtk.Scale({
                orientation: Gtk.Orientation.HORIZONTAL,
                adjustment: new Gtk.Adjustment({ lower, upper, step_increment: step }),
                digits: 2,
                draw_value: true,
                value_pos: Gtk.PositionType.RIGHT,
                valign: Gtk.Align.CENTER,
            });
            scale.set_size_request(200, -1);

            settings.bind(key, scale.adjustment, 'value', 0);
            row.add_suffix(scale);
            row.activatable_widget = scale;
            return row;
        };

        const jumpGroup = new Adw.PreferencesGroup({
            title: 'Icon Bounce Animation',
            description: 'Tweak the bounce effect when apps load or are clicked.',
        });

        const resetJumpBtnRow = new Adw.ActionRow({ title: 'Icon Bounce Animation - Reset to defaults' });
        const resetJumpBtn = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            tooltip_text: 'Reset bounce settings to defaults',
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
        });
        resetJumpBtn.connect('clicked', () => {
            settings.set_double('jump-height', 0.6);
            settings.set_double('jump-speed', 0.7);
        });
        resetJumpBtnRow.add_suffix(resetJumpBtn);
        jumpGroup.add(resetJumpBtnRow);

        animPage.add(jumpGroup);

        const jumpHeightRow = buildScaleRow('jump-height', 'Bounce Height', 'How high the icon bounces', 0.1, 0.8, 0.1);
        jumpGroup.add(jumpHeightRow);

        const jumpSpeedRow = buildScaleRow('jump-speed', 'Bounce Speed', 'Speed multiplier for the bounce animation', 0.5, 0.8, 0.1);
        jumpGroup.add(jumpSpeedRow);

        const urgentBounceRow = new Adw.SwitchRow({
            title: 'Urgent Bounce',
            subtitle: 'Bounce dock icons when applications request attention. Recommended to turn off "Wiggle Urgent Applications" in Dash to Dock when enabled.',
        });
        settings.bind('urgent-bounce', urgentBounceRow, 'active', 0);
        jumpGroup.add(urgentBounceRow);

        window.add(animPage);

        // ── Theme page ────────────────────────────────────────────────────────
        const themePage = new Adw.PreferencesPage({
            title: 'Theme',
            icon_name: 'preferences-desktop-appearance-symbolic',
        });

        const themeGroup = new Adw.PreferencesGroup({
            title: 'Dock Theme',
            description: 'Override Dash to Dock styling with macOS-inspired themes. Forces "Shrink the Dock" to always be enabled when this is active, and does not support "Panel Mode: Extend to Screen Edges".',
        });
        themePage.add(themeGroup);

        const overrideRow = new Adw.SwitchRow({
            title: 'Override Theming',
            subtitle: 'Apply macOS-inspired dock styling on top of Dash to Dock',
        });
        settings.bind('override-theming', overrideRow, 'active', 0);
        themeGroup.add(overrideRow);

        const themeStyleGroup = new Adw.PreferencesGroup({ 
            title: 'Style',
        });
        themePage.add(themeStyleGroup);

        const themeRow = new Adw.ActionRow({
            title: 'Dock Style',
            subtitle: 'Mojave sits flush at the screen edge, 10px border radius · Big Sur floats above it, 22px border radius',
        });
        const themeBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            valign: Gtk.Align.CENTER,
            css_classes: ['linked'],
        });
        const mojaveBtn = new Gtk.ToggleButton({ label: 'Mojave' });
        const bigsurBtn = new Gtk.ToggleButton({ label: 'Big Sur', group: mojaveBtn });
        themeBox.append(mojaveBtn);
        themeBox.append(bigsurBtn);
        const syncThemeButtons = () => {
            const val = settings.get_string('dock-theme');
            mojaveBtn.active = val === 'mojave';
            bigsurBtn.active = val === 'bigsur';
        };
        syncThemeButtons();
        mojaveBtn.connect('toggled', () => { 
            if (mojaveBtn.active) settings.set_string('dock-theme', 'mojave'); 
        });
        bigsurBtn.connect('toggled', () => { 
            if (bigsurBtn.active) settings.set_string('dock-theme', 'bigsur'); 
        });
        

        settings.connect('changed::dock-theme', syncThemeButtons);
        themeRow.add_suffix(themeBox);
        themeRow.add_suffix(themeBox);
        themeStyleGroup.add(themeRow);

        const colorGroup = new Adw.PreferencesGroup({ title: 'Color Scheme' });
        themePage.add(colorGroup);

        const themeAwareRow = new Adw.SwitchRow({
            title: 'Follow System Theme',
            subtitle: 'Automatically match the system light/dark setting',
        });
        settings.bind('theme-aware', themeAwareRow, 'active', 0);
        colorGroup.add(themeAwareRow);

        const colorRow = new Adw.ActionRow({
            title: 'Color Scheme',
            subtitle: 'Manual override when Follow System Theme is off',
        });
        const colorBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            valign: Gtk.Align.CENTER,
            css_classes: ['linked'],
        });
        const lightBtn = new Gtk.ToggleButton({ label: 'Light' });
        const darkBtn = new Gtk.ToggleButton({ label: 'Dark', group: lightBtn });
        colorBox.append(lightBtn);
        colorBox.append(darkBtn);
        const syncColorButtons = () => {
            const val = settings.get_string('dock-color-scheme');
            lightBtn.active = val === 'light';
            darkBtn.active = val === 'dark';
        };
        syncColorButtons();
        lightBtn.connect('toggled', () => { 
            if (lightBtn.active) settings.set_string('dock-color-scheme', 'light'); 
        });
        darkBtn.connect('toggled', () => { 
            if (darkBtn.active) settings.set_string('dock-color-scheme', 'dark'); 
        });


        settings.connect('changed::dock-color-scheme', syncColorButtons);
        colorRow.add_suffix(colorBox);
        colorRow.add_suffix(colorBox);
        colorGroup.add(colorRow);

        const updateColorSensitivity = () => { colorRow.sensitive = !settings.get_boolean('theme-aware'); };
        updateColorSensitivity();
        settings.connect('changed::theme-aware', updateColorSensitivity);

        const updateThemeSensitivity = () => {
            const on = settings.get_boolean('override-theming');
            themeStyleGroup.sensitive = on;
            colorGroup.sensitive = on;
        };
        updateThemeSensitivity();
        settings.connect('changed::override-theming', updateThemeSensitivity);

        window.add(themePage);

        // ── Extras page ────────────────────────────────────────────────
        const miscPage = new Adw.PreferencesPage({
            title: 'Extras',
            icon_name: 'emblem-system-symbolic',
        });


        // CAMLE Patcher group
        const camleGroup = new Adw.PreferencesGroup({
            title: 'Compiz Alike Magic Lamp Effect',
            description:
                'Patches the CAMLE extension to stop windows minimizing under the dock and enable bilinear texture filtering. ' +
                'Safely backs up original files. Recommended for Big Sur dock style.',
        });
        miscPage.add(camleGroup);

        const camleStatusRow = new Adw.ActionRow({ title: 'Patch Status' });
        const camleStatusLabel = new Gtk.Label({
            label: 'Checking...',
            css_classes: ['dim-label'],
        });
        camleStatusRow.add_suffix(camleStatusLabel);

        // Restore — icon-only button in rounded square style
        const restoreBtn = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: 'Restore original CAMLE extension.js',
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
        });

        // Patch button
        const patchBtn = new Gtk.Button({
            label: 'Patch',
            css_classes: ['suggested-action'],
            valign: Gtk.Align.CENTER,
        });

        camleStatusRow.add_suffix(restoreBtn);
        camleStatusRow.add_suffix(patchBtn);
        camleGroup.add(camleStatusRow);

        const extensionDir = this.metadata.path;

        const showModal = (title, body) => {
            const dialog = new Adw.MessageDialog({
                heading: title,
                body,
                transient_for: window,
            });
            dialog.add_response('ok', 'OK');
            dialog.present();
        };

        const refreshCamleStatus = () => {
            const status = getCamleStatus(extensionDir);
            if (status === 'not-installed') {
                camleStatusLabel.label = 'CAMLE not installed';
                patchBtn.sensitive = false;
                restoreBtn.sensitive = false;
            } else if (status === 'not-patched') {
                camleStatusLabel.label = 'Not patched';
                patchBtn.sensitive = true;
                restoreBtn.sensitive = false;
            } else {
                camleStatusLabel.label = 'Patched';
                patchBtn.sensitive = false;
                restoreBtn.sensitive = true;
            }
        };
        refreshCamleStatus();

        patchBtn.connect('clicked', () => {
            if (getCamleStatus(extensionDir) === 'not-installed') {
                showModal('CAMLE Not Installed',
                    'Compiz Alike Magic Lamp Effect is not installed.\n' +
                    'Please install it first through the GNOME Shell Extensions website.');
                return;
            }
            const result = patchCamle(extensionDir);
            if (result.success)
                showModal('Patch Applied',
                    'CAMLE has been patched successfully.\n' +
                    'Toggle CAMLE off and on, or log out and log back in to apply changes.');
            else
                showModal('Patch Failed', 'Something went wrong:\n' + result.error);
            refreshCamleStatus();
        });

        restoreBtn.connect('clicked', () => {
            if (getCamleStatus(extensionDir) !== 'patched') {
                showModal('No Backup Found',
                    'No backup directory found.\nYou have not patched CAMLE yet.');
                return;
            }
            const result = restoreCamle(extensionDir);
            if (result.success)
                showModal('Restored',
                    'CAMLE original extension.js has been restored.\n' +
                    'Toggle CAMLE off and on, or log out and log back in to apply changes.');
            else
                showModal('Restore Failed', 'Something went wrong:\n' + result.error);
            refreshCamleStatus();
        });

        window.add(miscPage);
    }
}
