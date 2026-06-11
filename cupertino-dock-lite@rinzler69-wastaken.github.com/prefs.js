import GLib from 'gi://GLib';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class CupertinoDockPreferences extends ExtensionPreferences {
    _buildComboRowString(settings, window, key, title, subtitle, options) {
        const model = new Gtk.StringList();
        for (const opt of options) {
            model.append(opt.label);
        }

        const row = new Adw.ComboRow({
            title,
            subtitle,
            model,
        });

        const syncFromSettings = () => {
            const val = settings.get_string(key);
            const index = options.findIndex(opt => opt.value === val);
            if (index !== -1) {
                row.selected = index;
            }
        };

        syncFromSettings();

        row.connect('notify::selected', () => {
            const val = options[row.selected]?.value;
            if (val && settings.get_string(key) !== val) {
                settings.set_string(key, val);
            }
        });

        const settingsId = settings.connect(`changed::${key}`, syncFromSettings);
        window.connect('destroy', () => {
            settings.disconnect(settingsId);
        });

        return row;
    }

    fillPreferencesWindow(window) {
        window.set_default_size(700, 800);

        const settings = this.getSettings();

        // ── Home page ────────────────────────────────────────────────────────
        const homePage = new Adw.PreferencesPage({
            title: 'Home',
            icon_name: 'go-home-symbolic',
        });

        const homeGroup = new Adw.PreferencesGroup();
        const homeBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.CENTER,
            spacing: 12,
            margin_top: 32,
            margin_bottom: 32,
            margin_start: 24,
            margin_end: 24,
        });

        const icon = new Gtk.Image({
            icon_name: 'plank',
            pixel_size: 128,
            halign: Gtk.Align.CENTER,
        });
        homeBox.append(icon);

        const titleLabel = new Gtk.Label({
            label: this.metadata.name,
            css_classes: ['title-1'],
            justify: Gtk.Justification.CENTER,
            halign: Gtk.Align.CENTER,
            wrap: true,
            hexpand: true,
        });
        homeBox.append(titleLabel);

        const descriptionLabel = new Gtk.Label({
            label: this.metadata.description,
            css_classes: ['dim-label'],
            justify: Gtk.Justification.CENTER,
            halign: Gtk.Align.CENTER,
            wrap: true,
            max_width_chars: 60,
            hexpand: true,
        });
        homeBox.append(descriptionLabel);

        const versionName = this.metadata['version-name'] || '';
        const versionLabel = versionName
            ? (versionName.startsWith('v') ? versionName : `v${versionName}`)
            : '';

        if (versionLabel) {
            const versionButton = new Gtk.Button({
                label: versionLabel,
                css_classes: ['app-version', 'text-button', 'pill'],
                halign: Gtk.Align.CENTER,
                margin_top: 24,
            });
            homeBox.append(versionButton);
        }

        homeGroup.add(homeBox);

        // ── Support/Donations group ──────────────────────────────────────────
        const supportGroup = new Adw.PreferencesGroup({
            title: 'Enjoying this extension?',
            description: 'Consider supporting its development!',
        });

        const donations = this.metadata.donations || {
            kofi: 'mikerinzler69',
            custom: 'https://saweria.co/rinzler69'
        };

        const kofiRow = new Adw.ActionRow({
            title: 'Ko-fi',
            subtitle: `ko-fi.com/${donations.kofi}`,
        });

        const kofiIcon = new Gtk.Image({
            icon_name: 'emblem-favorite-symbolic',
            pixel_size: 32,
            valign: Gtk.Align.CENTER,
        });
        kofiRow.add_prefix(kofiIcon);

        const kofiBtn = new Gtk.Button({
            icon_name: 'adw-external-link-symbolic',
            tooltip_text: 'Open Ko-fi',
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
        });
        kofiBtn.connect('clicked', () => {
            Gtk.show_uri(window, `https://ko-fi.com/${donations.kofi}`, GLib.CURRENT_TIME);
        });
        kofiRow.add_suffix(kofiBtn);

        supportGroup.add(kofiRow);

        const saweriaRow = new Adw.ActionRow({
            title: 'Saweria',
            subtitle: donations.custom.replace('https://', ''),
        });

        const saweriaIcon = new Gtk.Image({
            icon_name: 'emblem-favorite-symbolic',
            pixel_size: 32,
            valign: Gtk.Align.CENTER,
        });
        saweriaRow.add_prefix(saweriaIcon);

        const saweriaBtn = new Gtk.Button({
            icon_name: 'adw-external-link-symbolic',
            tooltip_text: 'Open Saweria',
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
        });
        saweriaBtn.connect('clicked', () => {
            Gtk.show_uri(window, donations.custom, GLib.CURRENT_TIME);
        });
        saweriaRow.add_suffix(saweriaBtn);

        supportGroup.add(saweriaRow);

        // ── Resources group ──────────────────────────────────────────────────
        const resourcesGroup = new Adw.PreferencesGroup({ title: 'Resources' });

        const repoRow = new Adw.ActionRow({
            title: 'Extension Repo',
            subtitle: 'github.com/rinzler69-wastaken/cupertino-dock-lite',
        });

        const githubIcon = new Gtk.Image({
            icon_name: 'system-software-install-symbolic',
            pixel_size: 32,
            valign: Gtk.Align.CENTER,
        });
        repoRow.add_prefix(githubIcon);

        const openBtn = new Gtk.Button({
            icon_name: 'adw-external-link-symbolic',
            tooltip_text: 'Open on GitHub',
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
        });
        openBtn.connect('clicked', () => {
            Gtk.show_uri(window, this.metadata.url, GLib.CURRENT_TIME);
        });
        repoRow.add_suffix(openBtn);

        resourcesGroup.add(repoRow);

        homePage.add(homeGroup);
        homePage.add(supportGroup);
        homePage.add(resourcesGroup);

        window.add(homePage);

        // ── Configuration page ────────────────────────────────────────────────
        const configPage = new Adw.PreferencesPage({
            title: 'Configuration',
            icon_name: 'preferences-system-symbolic',
        });

        // ── Bounce animation group ────────────────────────────────────────────
        const bounceGroup = new Adw.PreferencesGroup({
            title: 'Icon Bounce',
        });

        const urgentBounceRow = new Adw.SwitchRow({
            title: 'Urgent Bounce',
            subtitle: 'Bounce dock icons when applications request attention. Recommended to turn off "Wiggle Urgent Applications" in Dash to Dock when enabled.',
        });
        settings.bind('urgent-bounce', urgentBounceRow, 'active', 0);
        bounceGroup.add(urgentBounceRow);
        configPage.add(bounceGroup);

        // ── Dock theme group ──────────────────────────────────────────────────
        const themeGroup = new Adw.PreferencesGroup({
            title: 'Dock Theme',
            description: 'Override Dash to Dock styling with macOS-inspired themes. Note that toggling "Shrink the Dock" off may not work as expected when this theming is active.',
        });
        configPage.add(themeGroup);

        const overrideRow = new Adw.SwitchRow({
            title: 'Override Theming',
            subtitle: 'Apply macOS-inspired dock styling on top of Dash to Dock',
        });
        settings.bind('override-theming', overrideRow, 'active', 0);
        themeGroup.add(overrideRow);

        const themeStyleGroup = new Adw.PreferencesGroup({
            title: 'Style',
        });
        configPage.add(themeStyleGroup);

        const themeRow = this._buildComboRowString(
            settings,
            window,
            'dock-theme',
            'Dock Style',
            'Mojave sits flush at the screen edge, 10px border radius · Big Sur floats above it, 22px border radius',
            [
                { value: 'mojave', label: 'Mojave' },
                { value: 'bigsur', label: 'Big Sur' }
            ]
        );
        themeStyleGroup.add(themeRow);

        const colorGroup = new Adw.PreferencesGroup({ title: 'Color Scheme' });
        configPage.add(colorGroup);

        const themeAwareRow = new Adw.SwitchRow({
            title: 'Follow System Theme',
            subtitle: 'Automatically match the system light/dark setting',
        });
        settings.bind('theme-aware', themeAwareRow, 'active', 0);
        colorGroup.add(themeAwareRow);

        const colorRow = this._buildComboRowString(
            settings,
            window,
            'dock-color-scheme',
            'Color Scheme',
            'Manual override when Follow System Theme is off',
            [
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' }
            ]
        );
        colorGroup.add(colorRow);

        const updateColorSensitivity = () => { colorRow.sensitive = !settings.get_boolean('theme-aware'); };
        updateColorSensitivity();
        const awareId = settings.connect('changed::theme-aware', updateColorSensitivity);

        const updateThemeSensitivity = () => {
            const on = settings.get_boolean('override-theming');
            themeStyleGroup.sensitive = on;
            colorGroup.sensitive = on;
        };
        updateThemeSensitivity();
        const overrideId = settings.connect('changed::override-theming', updateThemeSensitivity);

        window.connect('destroy', () => {
            settings.disconnect(awareId);
            settings.disconnect(overrideId);
        });

        window.add(configPage);
    }
}