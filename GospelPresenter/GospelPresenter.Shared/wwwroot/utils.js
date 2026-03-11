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

window.imageCropperState = {};

window.initImageCropper = function(containerId, imageDataUrl) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const img = container.querySelector('img');
    if (!img) return;

    img.src = imageDataUrl;

    const state = {
        scale: 1,
        minScale: 1,
        translateX: 0,
        translateY: 0,
        dragging: false,
        lastX: 0,
        lastY: 0,
        img: img,
        container: container
    };

    window.imageCropperState[containerId] = state;

    img.onload = function() {
        const containerSize = container.offsetWidth;
        const fitScale = containerSize / Math.min(img.naturalWidth, img.naturalHeight);
        state.minScale = fitScale;
        state.scale = fitScale;
        state.translateX = (containerSize - img.naturalWidth * fitScale) / 2;
        state.translateY = (containerSize - img.naturalHeight * fitScale) / 2;
        applyTransform(state);
    };

    function applyTransform(s) {
        s.img.style.transform = `translate(${s.translateX}px, ${s.translateY}px) scale(${s.scale})`;
    }

    function clampPosition(s) {
        const containerSize = s.container.offsetWidth;
        const w = s.img.naturalWidth * s.scale;
        const h = s.img.naturalHeight * s.scale;
        s.translateX = Math.min(0, Math.max(containerSize - w, s.translateX));
        s.translateY = Math.min(0, Math.max(containerSize - h, s.translateY));
    }

    function getPointerPos(e) {
        const rect = container.getBoundingClientRect();
        const touch = e.touches ? e.touches[0] : e;
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }

    function onPointerDown(e) {
        if (e.touches && e.touches.length > 1) return;
        e.preventDefault();
        state.dragging = true;
        const pos = getPointerPos(e);
        state.lastX = pos.x;
        state.lastY = pos.y;
    }

    function onPointerMove(e) {
        if (!state.dragging) return;
        if (e.touches && e.touches.length > 1) return;
        e.preventDefault();
        const pos = getPointerPos(e);
        state.translateX += pos.x - state.lastX;
        state.translateY += pos.y - state.lastY;
        state.lastX = pos.x;
        state.lastY = pos.y;
        clampPosition(state);
        applyTransform(state);
    }

    function onPointerUp() {
        state.dragging = false;
    }

    function onWheel(e) {
        e.preventDefault();
        const pos = getPointerPos(e);
        const oldScale = state.scale;
        const delta = e.deltaY > 0 ? 0.95 : 1.05;
        state.scale = Math.max(state.minScale, Math.min(state.minScale * 5, state.scale * delta));

        // Zoom toward cursor
        state.translateX = pos.x - (pos.x - state.translateX) * (state.scale / oldScale);
        state.translateY = pos.y - (pos.y - state.translateY) * (state.scale / oldScale);
        clampPosition(state);
        applyTransform(state);
    }

    // Pinch-to-zoom
    let lastPinchDist = 0;
    function onTouchStart(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            state.dragging = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            lastPinchDist = Math.sqrt(dx * dx + dy * dy);
        }
    }

    function onTouchMove(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const ratio = dist / lastPinchDist;
            lastPinchDist = dist;

            const rect = container.getBoundingClientRect();
            const cx = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
            const cy = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;

            const oldScale = state.scale;
            state.scale = Math.max(state.minScale, Math.min(state.minScale * 5, state.scale * ratio));
            state.translateX = cx - (cx - state.translateX) * (state.scale / oldScale);
            state.translateY = cy - (cy - state.translateY) * (state.scale / oldScale);
            clampPosition(state);
            applyTransform(state);
        }
    }

    container.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('touchstart', function(e) {
        onTouchStart(e);
        if (e.touches.length === 1) onPointerDown(e);
    }, { passive: false });
    container.addEventListener('touchmove', function(e) {
        onTouchMove(e);
        if (e.touches.length === 1) onPointerMove(e);
    }, { passive: false });
    container.addEventListener('touchend', onPointerUp);

    state.cleanup = function() {
        container.removeEventListener('mousedown', onPointerDown);
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
    };
};

window.setImageCropperZoom = function(containerId, value) {
    const state = window.imageCropperState[containerId];
    if (!state) return;

    const containerSize = state.container.offsetWidth;
    const centerX = containerSize / 2;
    const centerY = containerSize / 2;

    const oldScale = state.scale;
    // value is 0-100, map to minScale..minScale*5
    state.scale = state.minScale + (value / 100) * (state.minScale * 4);

    state.translateX = centerX - (centerX - state.translateX) * (state.scale / oldScale);
    state.translateY = centerY - (centerY - state.translateY) * (state.scale / oldScale);

    // Clamp
    const w = state.img.naturalWidth * state.scale;
    const h = state.img.naturalHeight * state.scale;
    state.translateX = Math.min(0, Math.max(containerSize - w, state.translateX));
    state.translateY = Math.min(0, Math.max(containerSize - h, state.translateY));

    state.img.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
};

window.getImageCropResult = function(containerId) {
    const state = window.imageCropperState[containerId];
    if (!state) return null;

    const containerSize = state.container.offsetWidth;
    const canvas = document.createElement('canvas');
    const exportSize = 512;
    canvas.width = exportSize;
    canvas.height = exportSize;
    const ctx = canvas.getContext('2d');

    // Calculate source rectangle in natural image coordinates
    const scaleRatio = exportSize / containerSize;
    const sx = -state.translateX / state.scale;
    const sy = -state.translateY / state.scale;
    const sSize = containerSize / state.scale;

    ctx.drawImage(state.img, sx, sy, sSize, sSize, 0, 0, exportSize, exportSize);

    return canvas.toDataURL('image/webp', 0.85);
};

window.destroyImageCropper = function(containerId) {
    const state = window.imageCropperState[containerId];
    if (state && state.cleanup) state.cleanup();
    delete window.imageCropperState[containerId];
};

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