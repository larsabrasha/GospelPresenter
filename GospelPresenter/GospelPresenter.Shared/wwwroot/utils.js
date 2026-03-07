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

window.showModal = function(element) {
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

window.initLiveViewButton = function(containerId, dotNetRef) {
    window.presentationState.dotNetRef = dotNetRef;

    window.liveViewChannel.addEventListener('message', function(e) {
        if (e.data === 'live-opened') {
            dotNetRef.invokeMethodAsync('OnPresentationStateChanged', true);
        } else if (e.data === 'live-closed') {
            dotNetRef.invokeMethodAsync('OnPresentationStateChanged', false);
        }
    });

    document.getElementById(containerId).addEventListener('click', function(e) {
        const link = e.target.closest('a');
        if (!link) return;

        const state = window.presentationState;

        if ('PresentationRequest' in window) {
            e.preventDefault();

            if (state.connection) {
                state.connection.terminate();
                return;
            }

            const request = new PresentationRequest(link.href);
            request.start().then(connection => {
                state.connection = connection;
                dotNetRef.invokeMethodAsync('OnPresentationStateChanged', true);
                connection.addEventListener('close', () => {
                    state.connection = null;
                    dotNetRef.invokeMethodAsync('OnPresentationStateChanged', false);
                });
                connection.addEventListener('terminate', () => {
                    state.connection = null;
                    dotNetRef.invokeMethodAsync('OnPresentationStateChanged', false);
                });
            }).catch(() => {
                // Fallback: let the link open normally
            });
        } else if (state.isLiveOpen) {
            e.preventDefault();
            window.liveViewChannel.postMessage('close');
        }

        state.isLiveOpen = !state.isLiveOpen;
    });
}

window.closeLiveView = function() {
    window.liveViewChannel.postMessage('close');
}

window.initLiveViewListener = function() {
    window.liveViewChannel.postMessage('live-opened');
    window.liveViewChannel.addEventListener('message', function(e) {
        if (e.data === 'close') {
            window.liveViewChannel.postMessage('live-closed');
            window.close();
        }
    });
    window.addEventListener('beforeunload', function() {
        window.liveViewChannel.postMessage('live-closed');
    });
}