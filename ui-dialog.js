/**
 * Shared themed dialogs (confirm / prompt) for cards.js, quiz.js and poll.js.
 * Loaded via <script> tag; exposes uiDialog / uiConfirm / uiPrompt on
 * globalThis. Styles live in theme.css (.ui-modal*).
 */

/**
 * Accessible modal dialog — a themed, focus-trapped replacement for the native
 * blocking `confirm()` / `prompt()`. Returns a Promise resolving to:
 *   - confirm: `true` (confirmed) / `false` (cancelled)
 *   - prompt:  the entered string (confirmed) / `null` (cancelled)
 * Esc and backdrop click cancel; Enter confirms (from a prompt's input or the
 * focused confirm button); focus is trapped while open and restored on close.
 * @param {object} opts
 * @param {string} opts.message
 * @param {'confirm'|'prompt'} [opts.kind]
 * @param {string} [opts.defaultValue]
 * @param {string} [opts.confirmText]
 * @param {string} [opts.cancelText]
 * @param {boolean} [opts.danger] - Style the confirm button as destructive.
 * @param {number} [opts.maxLength] - Prompt input length cap.
 * @returns {Promise<boolean|string|null>}
 */
function uiDialog(opts) {
    const {
        message,
        kind = 'confirm',
        defaultValue = '',
        confirmText = 'OK',
        cancelText = 'Abbrechen',
        danger = false,
        maxLength = 0,
    } = opts;

    return new Promise((resolve) => {
        const previouslyFocused = document.activeElement;

        const backdrop = document.createElement('div');
        backdrop.className = 'ui-modal-backdrop';

        const modal = document.createElement('div');
        modal.className = 'ui-modal';
        modal.setAttribute('role', kind === 'prompt' ? 'dialog' : 'alertdialog');
        modal.setAttribute('aria-modal', 'true');

        const msgEl = document.createElement('p');
        msgEl.className = 'ui-modal-message';
        msgEl.id = `ui-modal-msg-${Date.now()}`;
        msgEl.textContent = message;
        modal.setAttribute('aria-labelledby', msgEl.id);
        modal.append(msgEl);

        let input = null;
        if (kind === 'prompt') {
            input = document.createElement('input');
            input.type = 'text';
            input.className = 'ui-modal-input';
            input.value = defaultValue;
            input.setAttribute('aria-label', message);
            if (maxLength > 0) input.maxLength = maxLength;
            modal.append(input);
        }

        const actions = document.createElement('div');
        actions.className = 'ui-modal-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'ui-modal-btn ui-modal-cancel';
        cancelBtn.textContent = cancelText;

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = `ui-modal-btn ui-modal-confirm${danger ? ' ui-modal-danger' : ''}`;
        confirmBtn.textContent = confirmText;

        actions.append(cancelBtn, confirmBtn);
        modal.append(actions);
        backdrop.append(modal);
        document.body.append(backdrop);

        const prevBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const cancelResult = kind === 'prompt' ? null : false;
        let settled = false;
        /**
         * @param {boolean|string|null} result
         */
        function close(result) {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', onKeydown, true);
            document.body.style.overflow = prevBodyOverflow;
            backdrop.remove();
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                previouslyFocused.focus();
            }
            resolve(result);
        }

        /**
         * @param {KeyboardEvent} e
         */
        function onKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                close(cancelResult);
            } else if (e.key === 'Enter' && input && document.activeElement === input) {
                // Buttons handle their own Enter/Space natively; only the prompt
                // input needs Enter wired to confirm.
                e.preventDefault();
                close(input.value);
            } else if (e.key === 'Tab') {
                const order = input ? [input, cancelBtn, confirmBtn] : [cancelBtn, confirmBtn];
                const first = order[0];
                const last = order.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }

        cancelBtn.addEventListener('click', () => close(cancelResult));
        confirmBtn.addEventListener('click', () => close(input ? input.value : true));
        backdrop.addEventListener('mousedown', (e) => {
            if (e.target === backdrop) close(cancelResult);
        });
        document.addEventListener('keydown', onKeydown, true);

        if (input) {
            input.focus();
            input.select();
        } else {
            confirmBtn.focus();
        }
    });
}

/**
 * Themed confirm dialog. @see uiDialog
 * @param {string} message
 * @param {object} [options]
 * @returns {Promise<boolean>}
 */
function uiConfirm(message, options = {}) {
    return uiDialog({ ...options, message, kind: 'confirm' });
}

/**
 * Themed prompt dialog. @see uiDialog
 * @param {string} message
 * @param {string} [defaultValue]
 * @param {object} [options]
 * @returns {Promise<string|null>}
 */
function uiPrompt(message, defaultValue = '', options = {}) {
    return uiDialog({ ...options, message, defaultValue, kind: 'prompt' });
}

globalThis.uiDialog = uiDialog;
globalThis.uiConfirm = uiConfirm;
globalThis.uiPrompt = uiPrompt;
