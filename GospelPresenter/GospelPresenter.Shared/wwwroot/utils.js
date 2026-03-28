window.copyToClipboard = function (text) {
    if (!navigator.clipboard) return Promise.resolve(false);
    return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
};

window.setTheme = function (theme) {
    localStorage.setItem('theme', theme);
    applyTheme();
};

window.getTheme = function () {
    return localStorage.getItem('theme') || 'system';
};

function applyTheme() {
    var theme = localStorage.getItem('theme') || 'system';
    var dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if ((localStorage.getItem('theme') || 'system') === 'system') {
        applyTheme();
    }
});

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
        ghostClass: 'opacity-0',
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
        if (e.target !== element) return;
        e.preventDefault();
        if (dotNetRef) dotNetRef.invokeMethodAsync('OnCancelFromJs');
    });

    element.addEventListener('mousedown', function(e) {
        if (e.target === element && dotNetRef) {
            dotNetRef.invokeMethodAsync('OnCancelFromJs');
        }
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

window.showPopoverElement = function(element) {
    element.showPopover();
}

window.hidePopoverElement = function(element) {
    element.hidePopover();
}

window.scrollSidebarItemIntoView = function(itemId) {
    var el = document.querySelector('#sidebar-item-list [data-id="' + CSS.escape(itemId) + '"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
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

        if ('PresentationRequest' in window && window.screen.isExtended) {
            e.preventDefault();

            const url = link.href;
            const request = new PresentationRequest(url);
            request.start().then(connection => {
                sessionStorage.setItem('presentation-url', url);
                window.setupPresentationConnection(state, connection, dotNetRef);
            }).catch(() => {
                // User cancelled or Presentation API failed — do nothing
            });
        }
    });
}

window.gospelPresenter = window.gospelPresenter || {};

window.gospelPresenter.resizeImage = function(base64, maxWidth, maxHeight, quality, mimeType) {
    var format = mimeType || 'image/jpeg';
    return new Promise(function(resolve, reject) {
        var img = new Image();
        img.onload = function() {
            var w = img.width, h = img.height;
            if (w > maxWidth || h > maxHeight) {
                var ratio = Math.min(maxWidth / w, maxHeight / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            var dataUrl = canvas.toDataURL(format, quality);
            resolve(dataUrl.split(',')[1]);
        };
        img.onerror = function() { reject('Failed to load image'); };
        img.src = 'data:image/png;base64,' + base64;
    });
};

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
        const fitScale = containerSize / Math.max(img.naturalWidth, img.naturalHeight);
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
        // Allow dragging until an edge reaches the opposite side of the container
        s.translateX = Math.max(-w, Math.min(containerSize, s.translateX));
        s.translateY = Math.max(-h, Math.min(containerSize, s.translateY));
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
        state.scale = Math.max(state.minScale * 0.5, Math.min(state.minScale * 10, state.scale * delta));

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
            state.scale = Math.max(state.minScale * 0.5, Math.min(state.minScale * 10, state.scale * ratio));
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
    // value is 0-100, map to minScale*0.5..minScale*10
    state.scale = state.minScale * 0.5 + (value / 100) * (state.minScale * 9.5);

    state.translateX = centerX - (centerX - state.translateX) * (state.scale / oldScale);
    state.translateY = centerY - (centerY - state.translateY) * (state.scale / oldScale);

    // Clamp — allow dragging until an edge reaches the opposite side
    const w = state.img.naturalWidth * state.scale;
    const h = state.img.naturalHeight * state.scale;
    state.translateX = Math.max(-w, Math.min(containerSize, state.translateX));
    state.translateY = Math.max(-h, Math.min(containerSize, state.translateY));

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

    // Fill background for areas not covered by the image
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, exportSize, exportSize);

    // Calculate source rectangle in natural image coordinates
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

window.positionDropdown = function(element) {
    if (!element) return;

    // Reset any previous inline adjustments
    element.style.removeProperty('top');
    element.style.removeProperty('bottom');
    element.style.removeProperty('margin-top');
    element.style.removeProperty('margin-bottom');
    element.style.removeProperty('max-height');
    element.style.removeProperty('overflow-y');

    var rect = element.getBoundingClientRect();
    var viewportHeight = window.innerHeight;
    var margin = 8;

    // If dropdown fits in viewport, nothing to do
    if (rect.bottom <= viewportHeight - margin) return;

    var parent = element.offsetParent || element.parentElement;
    var parentRect = parent.getBoundingClientRect();
    var spaceAbove = parentRect.top;
    var spaceBelow = viewportHeight - parentRect.bottom;

    if (spaceAbove > spaceBelow) {
        // Flip to open upward
        element.style.top = 'auto';
        element.style.bottom = '100%';
        element.style.marginBottom = '0.25rem';
        element.style.marginTop = '0';
        if (rect.height > spaceAbove - margin) {
            element.style.maxHeight = (spaceAbove - margin) + 'px';
            element.style.overflowY = 'auto';
        }
    } else {
        // Keep below but constrain height
        element.style.maxHeight = (spaceBelow - margin) + 'px';
        element.style.overflowY = 'auto';
    }
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