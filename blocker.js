// blocker.js
(function() {
    const noop = () => {};
    // Блокируем SCEditor на уровне имен, не ломая прототипы
    window.sceditor = undefined;
    window.SCEditor = undefined;
    window.initSceditor = noop;
    window.tryInit = noop;

    console.log("[Blocker] SCEditor neutralized.");
})();