(function () {
    'use strict';

    var STORAGE_KEY = 'flashcards-theme';
    var DARK = 'dark';
    var LIGHT = 'light';

    /**
     *
     */
    function getPreferredTheme() {
        var stored = localStorage.getItem(STORAGE_KEY);
        if (stored === DARK || stored === LIGHT) {
            return stored;
        }
        if (
            globalThis.matchMedia &&
            globalThis.matchMedia('(prefers-color-scheme: dark)').matches
        ) {
            return DARK;
        }
        return LIGHT;
    }

    /**
     *
     * @param theme
     */
    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        updateToggleIcon(theme);
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute('content', theme === DARK ? '#1e1e2e' : '#3498db');
        }
    }

    /**
     *
     * @param theme
     */
    function updateToggleIcon(theme) {
        var btn = document.querySelector('.theme-toggle');
        if (btn) {
            btn.textContent = theme === DARK ? '\u2600\uFE0F' : '\uD83C\uDF19';
            btn.setAttribute(
                'aria-label',
                theme === DARK ? 'Zum hellen Modus wechseln' : 'Zum dunklen Modus wechseln'
            );
        }
    }

    /**
     *
     */
    function toggleTheme() {
        var current = document.documentElement.dataset.theme || LIGHT;
        var next = current === DARK ? LIGHT : DARK;

        document.documentElement.classList.add('theme-transition');
        applyTheme(next);
        localStorage.setItem(STORAGE_KEY, next);

        setTimeout(function () {
            document.documentElement.classList.remove('theme-transition');
        }, 350);
    }

    /**
     *
     */
    function createToggleButton() {
        var btn = document.createElement('button');
        btn.className = 'theme-toggle';
        btn.type = 'button';
        btn.addEventListener('click', toggleTheme);
        document.body.append(btn);
        updateToggleIcon(document.documentElement.dataset.theme || LIGHT);
    }

    var SOUND_KEY = 'flashcards-sound';
    var SOUND_ENABLED = 'enabled';
    var SOUND_DISABLED = 'disabled';

    function getSoundState() {
        var stored = localStorage.getItem(SOUND_KEY);
        if (stored === SOUND_ENABLED || stored === SOUND_DISABLED) {
            return stored;
        }
        return SOUND_DISABLED;
    }

    function updateSoundIcon(state) {
        var btn = document.querySelector('.sound-toggle');
        if (btn) {
            btn.textContent = state === SOUND_ENABLED ? '\uD83D\uDD0A' : '\uD83D\uDD07';
            btn.setAttribute(
                'aria-label',
                state === SOUND_ENABLED ? 'Sound ausschalten' : 'Sound einschalten'
            );
        }
    }

    function toggleSound() {
        var current = getSoundState();
        var next = current === SOUND_ENABLED ? SOUND_DISABLED : SOUND_ENABLED;
        localStorage.setItem(SOUND_KEY, next);
        updateSoundIcon(next);
    }

    function createSoundButton() {
        var btn = document.createElement('button');
        btn.className = 'sound-toggle';
        btn.type = 'button';
        btn.addEventListener('click', toggleSound);
        document.body.append(btn);
        updateSoundIcon(getSoundState());
    }

    // Apply theme immediately to prevent flash
    applyTheme(getPreferredTheme());

    // Listen for system preference changes
    if (globalThis.matchMedia) {
        globalThis
            .matchMedia('(prefers-color-scheme: dark)')
            .addEventListener('change', function (e) {
                if (!localStorage.getItem(STORAGE_KEY)) {
                    applyTheme(e.matches ? DARK : LIGHT);
                }
            });
    }

    // Create buttons once DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            createToggleButton();
            createSoundButton();
        });
    } else {
        createToggleButton();
        createSoundButton();
    }
})();
