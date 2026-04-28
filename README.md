# WACK – Cupertino Lite Dock

- A stripped down, and currently maintained lightweight fork, of **[Dash Cupertinisator](github.com/rinzler69-wastaken/dash-cupertinisator)**.

<p align="center">
  <img src="screenshots/screenshot1.png" width="48%" />
  <img src="screenshots/screenshot2.png" width="48%" />
</p>

This is a part of the WACK project (WACK Ain't Cupertino, Kid), a collection of tweaks aimed at bringing a refined, macOS-inspired aesthetic to the GNOME desktop.

This specific extension focuses on the Dock (derived from GNOME Dash by Dash to Dock), giving bounce animations for running and urgent apps, as well as theming your dock with Mojave or Big Sur inspired themes.

## Features, and What it does
- Custom, macOS inspired Theming: Lets you choose from two dock themes: Mojave and Big Sur (Mojave style sticks flush to the screen edge, 10px border radius, Big Sur floats above it, 22px border radius).
- Custom, macOS inspired Animations:  Animates launching apps' icons with bounce animation, of which you can tune the speed, and the height of the bounce.

## Best Used With
This extension is made as a companion extension to **[Dash to Dock](https://github.com/micheleg/dash-to-dock/)**. In order for this extension to work, install Dash to Dock first.


## Install / update (one-step Makefile)
Prereqs: `make`, `rsync`, GNOME Shell 48–50.

```bash
git clone https://github.com/rinzler69-wastaken/cupertino-dock-lite.git
cd cupertino-dock-lite
make            # copies into ~/.local/share/gnome-shell/extensions/cupertino-dock-lite@rinzler69-wastaken.github.com
```

Then reload GNOME Shell (`Alt+F2` → `r` on Xorg; logout/login on Wayland) and enable:

```bash
gnome-extensions enable cupertino-dock-lite@rinzler69-wastaken.github.com
```


## Compatibility
- Developed and tested on GNOME 49 (Fedora), support for GNOME 48 through GNOME 45 should most likely be fine. More issues are yet to be known since tests are yet to be made for other configurations. Feel free to open an issue if bugs are found, or clone and contribute!

## About the WACK Project
- WACK (WACK Ain't Cupertino, Kid) brings the best design patterns and details from macOS to the GNOME Desktop — dock magnification, traffic-light window controls, lockscreen layout, quick settings layouts, and many more to come — built entirely within what GNOME already gives you.