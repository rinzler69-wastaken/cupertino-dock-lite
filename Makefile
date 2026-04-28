UUID = $(shell python3 -c "import json; print(json.load(open('metadata.json'))['uuid'])")

EXTENSION_DIR = ~/.local/share/gnome-shell/extensions/$(UUID)

JS_FILES = extension.js animator.js prefs.js patcher.js badge.js utils.js

.PHONY: all build install uninstall pack lint pretty

all: build install

build: ## Compile GSettings schemas
	glib-compile-schemas --strict --targetdir=schemas/ schemas/

install: build ## Install extension locally
	mkdir -p $(EXTENSION_DIR)
	cp -R $(JS_FILES) metadata.json stylesheet.css schemas/ assets/ themes/ LICENSE README.md \
		$(EXTENSION_DIR)/

uninstall: ## Remove locally installed extension
	rm -rf $(EXTENSION_DIR)

pack: build ## Create a ZIP package for Extensions.gnome.org
	@printf 'Packaging extension...\n'
	@rm -f $(UUID).zip
	@zip -q $(UUID).zip \
		$(JS_FILES) \
		metadata.json stylesheet.css LICENSE README.md \
		themes/*.css \
		assets/camle-extension.js.template \
		schemas/*.xml
	@printf 'Created package: %s\n' "$(UUID).zip"

lint: ## Run shexli linter on the ZIP
	@$(MAKE) -s pack
	shexli $(UUID).zip

pretty: ## Format JS files with prettier
	prettier --single-quote --write "**/*.js"