// stubs/script.js —— 模拟 SillyTavern 的 /script.js
export const event_types = {
    APP_READY: 'app_ready',
    SETTINGS_UPDATED: 'settings_updated',
    WORLDINFO_UPDATED: 'worldinfo_updated',
    CHAT_CHANGED: 'chat_changed',
    CHARACTER_SELECTED: 'character_selected',
    CHARACTER_EDITED: 'character_edited',
    CHARACTER_DELETED: 'character_deleted',
};

export const eventSource = {
    handlers: {},
    on(type, fn) {
        (this.handlers[type] ||= []).push(fn);
        return this;
    },
    off(type, fn) {
        if (!fn) delete this.handlers[type];
        else this.handlers[type] = (this.handlers[type] || []).filter(f => f !== fn);
    },
    emit(type, ...args) {
        (this.handlers[type] || []).forEach(fn => fn(...args));
    },
};
