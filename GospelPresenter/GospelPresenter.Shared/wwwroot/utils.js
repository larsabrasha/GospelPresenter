window.getOrCreateSessionId = function () {
    let id = sessionStorage.getItem('session-id');
    if (!id) {
        id = crypto.randomUUID().replace(/-/g, '').substring(0, 8);
        sessionStorage.setItem('session-id', id);
    }
    return id;
}

window.initSortableList = function (elementId, dotNetRef) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (el._sortable) el._sortable.destroy();
    el._sortable = new Sortable(el, {
        animation: 150,
        handle: '.drag-handle',
        delay: 150,
        delayOnTouchOnly: true,
        touchStartThreshold: 5,
        ghostClass: 'opacity-30',
        onEnd: function (evt) {
            if (evt.oldIndex !== evt.newIndex) {
                // Revert the DOM change — let Blazor handle the reorder via its own rendering
                var parent = evt.from;
                if (evt.oldIndex < evt.newIndex) {
                    parent.insertBefore(evt.item, parent.children[evt.oldIndex]);
                } else {
                    parent.insertBefore(evt.item, parent.children[evt.oldIndex + 1]);
                }
                dotNetRef.invokeMethodAsync('OnItemReordered', evt.oldIndex, evt.newIndex);
            }
        }
    });
}

window.destroySortableList = function (elementId) {
    const el = document.getElementById(elementId);
    if (el && el._sortable) {
        el._sortable.destroy();
        el._sortable = null;
    }
}

window.scrollElementToTop = function (elementId) {
    const element = document.getElementById(elementId);
    
    if (element) {
        element.scrollTop = 0;
    }
}

window.setRootElementBackgroundColor = function(color) {
    document.documentElement.style.backgroundColor = color;
}

window.showModal = function(element, dotNetRef) {
    element.addEventListener('cancel', function(e) {
        e.preventDefault();
        if (dotNetRef) dotNetRef.invokeMethodAsync('OnCancelFromJs');
    });
    element.showModal();
}

window.closeModal = function(element) {
    if (!element.open) return Promise.resolve();
    return new Promise(resolve => {
        const done = () => { clearTimeout(timeout); resolve(); };
        const timeout = setTimeout(done, 300);
        element.addEventListener('transitionend', done, { once: true });
        element.close();
    });
}

window.liveViewChannel = new BroadcastChannel('gospel-live');

window.presentationState = { connection: null, dotNetRef: null };

window.setupPresentationConnection = function(state, connection, dotNetRef) {
    state.connection = connection;
    state.isLiveOpen = true;
    sessionStorage.setItem('presentation-id', connection.id);
    dotNetRef.invokeMethodAsync('OnPresentationStateChanged', true);

    function onDisconnect() {
        state.connection = null;
        state.isLiveOpen = false;
        sessionStorage.removeItem('presentation-id');
        sessionStorage.removeItem('presentation-url');
        dotNetRef.invokeMethodAsync('OnPresentationStateChanged', false);
    }

    connection.addEventListener('close', onDisconnect);
    connection.addEventListener('terminate', onDisconnect);
}

window.initLiveViewButton = function(containerId, dotNetRef, isActive, sessionId) {
    const state = window.presentationState;
    state.dotNetRef = dotNetRef;
    state.isLiveOpen = isActive;
    state.sessionId = sessionId;

    // Try to reconnect to an existing Presentation API session after reload
    const savedPresentationId = sessionStorage.getItem('presentation-id');
    const savedPresentationUrl = sessionStorage.getItem('presentation-url');
    if (savedPresentationId && savedPresentationUrl && 'PresentationRequest' in window) {
        const request = new PresentationRequest(savedPresentationUrl);
        request.reconnect(savedPresentationId).then(connection => {
            window.setupPresentationConnection(state, connection, dotNetRef);
        }).catch(() => {
            sessionStorage.removeItem('presentation-id');
            sessionStorage.removeItem('presentation-url');
            if (isActive) {
                state.isLiveOpen = false;
                dotNetRef.invokeMethodAsync('OnPresentationStateChanged', false);
            }
        });
    }

    window.liveViewChannel.addEventListener('message', function(e) {
        if (e.data?.sessionId !== sessionId) return;

        if (e.data.type === 'live-opened') {
            state.isLiveOpen = true;
            dotNetRef.invokeMethodAsync('OnPresentationStateChanged', true);
        } else if (e.data.type === 'live-closed') {
            state.isLiveOpen = false;
            dotNetRef.invokeMethodAsync('OnPresentationStateChanged', false);
        }
    });

    document.getElementById(containerId).addEventListener('click', function(e) {
        const link = e.target.closest('a');
        if (!link) return;

        if (state.connection) {
            e.preventDefault();
            state.connection.terminate();
            return;
        }

        if (state.isLiveOpen) {
            e.preventDefault();
            window.liveViewChannel.postMessage({ type: 'close', sessionId });
            return;
        }

        if ('PresentationRequest' in window) {
            e.preventDefault();

            const url = link.href;
            const request = new PresentationRequest(url);
            request.start().then(connection => {
                sessionStorage.setItem('presentation-url', url);
                window.setupPresentationConnection(state, connection, dotNetRef);
            }).catch(() => {
                // Fallback: let the link open normally
            });
        }
    });
}

window.initLiveViewListener = function(sessionId) {
    window.liveViewChannel.postMessage({ type: 'live-opened', sessionId });
    window.liveViewChannel.addEventListener('message', function(e) {
        if (e.data?.sessionId !== sessionId) return;

        if (e.data.type === 'close') {
            window.liveViewChannel.postMessage({ type: 'live-closed', sessionId });
            window.close();
        }
    });
    window.addEventListener('beforeunload', function() {
        window.liveViewChannel.postMessage({ type: 'live-closed', sessionId });
    });
}