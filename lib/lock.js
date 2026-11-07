// Выполняет fn под замком чата, если хранилище его поддерживает (в тестах — просто вызов fn).
export const withChatLock = (store, chatId, fn) => (store.withLock ? store.withLock(chatId, fn) : fn());
