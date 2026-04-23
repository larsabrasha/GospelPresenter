window.getElementWidth = function (element) {
    return element ? element.getBoundingClientRect().width : 0;
};

window.clickElement = function (element) {
    if (element) element.click();
};

window.uploadFiles = async function (inputElement, url, organizationId, dotNetRef, maxFileSize, allowedTypes) {
    var files = inputElement.files;
    if (!files || files.length === 0) return;

    await dotNetRef.invokeMethodAsync('OnUploadStarted', files.length);

    for (var i = 0; i < files.length; i++) {
        if (allowedTypes && allowedTypes.length > 0 && allowedTypes.indexOf(files[i].type) === -1) {
            await dotNetRef.invokeMethodAsync('OnFileUploadFailed', files[i].name);
            continue;
        }
        if (maxFileSize > 0 && files[i].size > maxFileSize) {
            await dotNetRef.invokeMethodAsync('OnFileUploadFailed', files[i].name);
            continue;
        }

        var formData = new FormData();
        formData.append('file', files[i]);
        if (organizationId) formData.append('organizationId', organizationId);

        try {
            var response = await fetch(url, {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                var json = await response.text();
                await dotNetRef.invokeMethodAsync('OnFileUploaded', json);
            } else {
                await dotNetRef.invokeMethodAsync('OnFileUploadFailed', files[i].name);
            }
        } catch (e) {
            await dotNetRef.invokeMethodAsync('OnFileUploadFailed', files[i].name);
        }
    }

    await dotNetRef.invokeMethodAsync('OnAllUploadsComplete');
    inputElement.value = '';
};

window.uploadAllFiles = async function (inputElement, url, organizationId, replaceExisting) {
    var files = inputElement.files;
    if (!files || files.length === 0) return null;

    var formData = new FormData();
    for (var i = 0; i < files.length; i++) {
        formData.append('file', files[i], files[i].name);
    }
    if (organizationId) {
        formData.append('organizationId', organizationId);
    }
    if (replaceExisting) {
        formData.append('replaceExisting', 'true');
    }

    try {
        var response = await fetch(url, { method: 'POST', body: formData });
        if (!response.ok) return null;

        var result = await response.json();
        result.fileCount = files.length;
        if (!result.duplicates) inputElement.value = '';
        return result;
    } catch (e) {
        return null;
    }
};

window.uploadSlides = async function (inputElement, url, organizationId, dotNetRef) {
    var file = inputElement.files && inputElement.files[0];
    if (!file) return;

    var formData = new FormData();
    formData.append('file', file);
    if (organizationId) formData.append('organizationId', organizationId);

    try {
        var response = await fetch(url, { method: 'POST', body: formData });
        inputElement.value = '';
        if (response.ok) {
            await dotNetRef.invokeMethodAsync('OnSlidesUploaded', await response.text());
        } else {
            await dotNetRef.invokeMethodAsync('OnSlidesUploadFailed', await response.text() || 'error');
        }
    } catch (e) {
        await dotNetRef.invokeMethodAsync('OnSlidesUploadFailed', 'network-error');
    }
};

window.readFileAsDataUrl = function (inputElement, maxFileSize, allowedTypes) {
    var file = inputElement.files && inputElement.files[0];
    if (!file) return Promise.resolve(null);
    if (allowedTypes && allowedTypes.length > 0 && allowedTypes.indexOf(file.type) === -1) return Promise.resolve('unsupported-type');
    if (maxFileSize > 0 && file.size > maxFileSize) return Promise.resolve('too-large');

    return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { resolve(null); };
        reader.readAsDataURL(file);
    });
};

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

window.initArrangementSortable = function (elementId, dotNetRef, arrangementId) {
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
                var parent = evt.from;
                if (evt.oldIndex < evt.newIndex) {
                    parent.insertBefore(evt.item, parent.children[evt.oldIndex]);
                } else {
                    parent.insertBefore(evt.item, parent.children[evt.oldIndex + 1]);
                }
                dotNetRef.invokeMethodAsync('OnArrangementReordered', arrangementId, evt.oldIndex, evt.newIndex);
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

window.scrollToElement = function(elementId) {
    var el = document.getElementById(elementId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

window.scrollSidebarItemIntoView = function(itemId) {
    var el = document.querySelector('#sidebar-item-list [data-id="' + CSS.escape(itemId) + '"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
}

window.liveViewChannel = new BroadcastChannel('gospel-live');

window.presentationState = { connection: null };

window.stopLivePresentation = function(sessionId) {
    var state = window.presentationState;
    if (state.connection) {
        state.connection.terminate();
        state.connection = null;
        sessionStorage.removeItem('presentation-id');
        sessionStorage.removeItem('presentation-url');
    }
    window.liveViewChannel.postMessage({ type: 'close', sessionId: sessionId });
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

// Find the nearest ancestor that establishes a containing block for
// position: fixed descendants (transform, filter, backdrop-filter, perspective,
// will-change on any of these, or contain: layout/paint/strict).
function findFixedContainingBlock(el) {
    var parent = el.parentElement;
    while (parent && parent !== document.documentElement) {
        var style = getComputedStyle(parent);
        if (style.transform !== 'none' ||
            style.filter !== 'none' ||
            style.backdropFilter !== 'none' ||
            style.perspective !== 'none' ||
            style.contain.indexOf('layout') !== -1 ||
            style.contain.indexOf('paint') !== -1 ||
            style.contain.indexOf('strict') !== -1 ||
            /transform|filter|backdrop-filter|perspective/.test(style.willChange)) {
            return parent;
        }
        parent = parent.parentElement;
    }
    return null;
}

window.positionDropdownPortal = function(menuEl, triggerEl) {
    if (!menuEl || !triggerEl) return;

    // Reset previous inline adjustments
    menuEl.style.removeProperty('top');
    menuEl.style.removeProperty('bottom');
    menuEl.style.removeProperty('left');
    menuEl.style.removeProperty('width');
    menuEl.style.removeProperty('max-height');
    menuEl.style.removeProperty('overflow-y');

    var triggerRect = triggerEl.getBoundingClientRect();
    var viewportHeight = window.innerHeight;
    var margin = 8;
    var spacing = 4;

    // If an ancestor establishes a containing block for fixed positioning
    // (e.g. backdrop-filter on a parent), position coordinates must be
    // adjusted relative to that ancestor, not the viewport.
    var cb = findFixedContainingBlock(menuEl);
    var cbTop = 0;
    var cbLeft = 0;
    var cbBottom = viewportHeight;
    if (cb) {
        var cbRect = cb.getBoundingClientRect();
        cbTop = cbRect.top;
        cbLeft = cbRect.left;
        cbBottom = cbRect.bottom;
    }

    // Match trigger width, align to its left edge
    menuEl.style.width = triggerRect.width + 'px';
    menuEl.style.left = (triggerRect.left - cbLeft) + 'px';
    menuEl.style.top = (triggerRect.bottom - cbTop + spacing) + 'px';

    var menuRect = menuEl.getBoundingClientRect();
    if (menuRect.bottom <= viewportHeight - margin) return;

    var spaceAbove = triggerRect.top;
    var spaceBelow = viewportHeight - triggerRect.bottom;

    if (spaceAbove > spaceBelow) {
        // Flip to open upward
        menuEl.style.top = 'auto';
        menuEl.style.bottom = (cbBottom - triggerRect.top + spacing) + 'px';
        if (menuRect.height > spaceAbove - margin - spacing) {
            menuEl.style.maxHeight = (spaceAbove - margin - spacing) + 'px';
            menuEl.style.overflowY = 'auto';
        }
    } else {
        // Keep below but constrain height
        menuEl.style.maxHeight = (spaceBelow - margin - spacing) + 'px';
        menuEl.style.overflowY = 'auto';
    }
};

window.initLiveViewListener = function(sessionId, windowId) {
    window.liveViewChannel.addEventListener('message', function(e) {
        if (e.data?.sessionId !== sessionId) return;

        if (e.data.type === 'close') {
            window.close();
        }
    });

    window.addEventListener('pagehide', function() {
        window.liveViewChannel.postMessage({
            type: 'window-closed',
            sessionId: sessionId,
            windowId: windowId
        });
    });
}

window.gospelPresenter.liveWindows = [];
window.gospelPresenter.livePanelRef = null;

window.gospelPresenter.setLivePanelRef = function(dotNetRef) {
    window.gospelPresenter.livePanelRef = dotNetRef;
}

window.gospelPresenter.openLiveWindow = function(sessionId, windowId, title) {
    var url = '/live?session=' + sessionId + '&windowId=' + windowId;
    if (title) url += '&title=' + encodeURIComponent(title);
    var win = window.open(url, '_blank');
    if (!win) return false;

    window.gospelPresenter.liveWindows.push({ ref: win, windowId: windowId });
    return true;
}

// Opens the live window synchronously inside the click event so Safari does not
// block it as a popup. Blazor Server's @onclick goes through SignalR and loses the
// user-gesture context before window.open() runs.
window.gospelPresenter.openLiveWindowFromClick = function(button) {
    var sessionId = button.dataset.sessionId;
    if (!sessionId) return;

    var titlePrefix = button.dataset.titlePrefix || '';
    var nextIndex = button.dataset.nextIndex || '';
    var title = titlePrefix && nextIndex ? titlePrefix + ' (' + nextIndex + ')' : titlePrefix;

    // Generate an 8-character hex id matching Guid.NewGuid().ToString("N")[..8]
    var windowId = '';
    var chars = '0123456789abcdef';
    for (var i = 0; i < 8; i++) {
        windowId += chars.charAt(Math.floor(Math.random() * 16));
    }

    var url = '/live?session=' + encodeURIComponent(sessionId) + '&windowId=' + windowId;
    if (title) url += '&title=' + encodeURIComponent(title);

    var win = window.open(url, '_blank');
    if (!win) return;

    window.gospelPresenter.liveWindows.push({ ref: win, windowId: windowId });

    if (window.gospelPresenter.livePanelRef) {
        window.gospelPresenter.livePanelRef.invokeMethodAsync('OnLiveWindowOpened', windowId);
    }
}

window.gospelPresenter.closeLiveWindow = function(windowId) {
    var entry = window.gospelPresenter.liveWindows.find(function(w) { return w && w.windowId === windowId; });
    if (entry && entry.ref && !entry.ref.closed) {
        entry.ref.close();
    }
    window.gospelPresenter.liveWindows = window.gospelPresenter.liveWindows.filter(function(w) { return w && w.windowId !== windowId; });
}

window.gospelPresenter.onLiveWindowClosed = function(dotNetRef) {
    window.liveViewChannel.addEventListener('message', function(e) {
        if (e.data?.type === 'window-closed' && e.data.windowId) {
            window.gospelPresenter.liveWindows = window.gospelPresenter.liveWindows.filter(function(w) { return w && w.windowId !== e.data.windowId; });
            dotNetRef.invokeMethodAsync('OnLiveWindowClosed', e.data.windowId);
        }
    });
}

window.gospelPresenter.saveOutputConfig = function(config) {
    localStorage.setItem('output-config', JSON.stringify(config));
}

window.gospelPresenter.loadOutputConfig = function() {
    var json = localStorage.getItem('output-config');
    return json ? JSON.parse(json) : null;
}

window.gospelPresenter.isPresentationApiAvailable = function() {
    return typeof PresentationRequest !== 'undefined' && !!navigator.presentation;
}

window.gospelPresenter.presentationConnections = [];

window.gospelPresenter.startPresentation = function(sessionId, dotNetRef) {
    var url = window.location.origin + '/live?session=' + sessionId;
    var request = new PresentationRequest([url]);

    return request.start().then(function(connection) {
        var id = window.gospelPresenter.presentationConnections.length;
        window.gospelPresenter.presentationConnections.push(connection);

        var onClosed = function() {
            window.gospelPresenter.presentationConnections[id] = null;
            if (dotNetRef) {
                dotNetRef.invokeMethodAsync('OnPresentationClosed', id);
            }
        };
        connection.addEventListener('close', onClosed);
        connection.addEventListener('terminate', onClosed);

        return id;
    });
}

window.gospelPresenter.stopPresentation = function(id) {
    var conn = window.gospelPresenter.presentationConnections[id];
    if (conn) {
        conn.terminate();
        window.gospelPresenter.presentationConnections[id] = null;
    }
}

window.gospelPresenter.isPresentationActive = function(id) {
    var conn = window.gospelPresenter.presentationConnections[id];
    return conn != null && conn.state === 'connected';
}

window.gospelPresenter.formatTime = function(seconds) {
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
};

window.gospelPresenter._audioRelay = null;

window.gospelPresenter.registerAudioRelay = function(dotnetRef) {
    window.gospelPresenter._audioRelay = dotnetRef;
};

window.gospelPresenter.unregisterAudioRelay = function() {
    window.gospelPresenter._audioRelay = null;
};

window.gospelPresenter.executeAudioCommand = function(action, audioId, position) {
    var audio = document.getElementById(audioId);
    if (!audio) return;
    if (action === 'toggle') { if (audio.paused) audio.play(); else audio.pause(); }
    else if (action === 'seek' && position != null) { audio.currentTime = position; }
    else if (action === 'fade') { gospelPresenter.fadeOutAudio(audio, null); }
};

window.gospelPresenter.toggleAudio = function(audioId) {
    if (window.gospelPresenter._audioRelay)
        window.gospelPresenter._audioRelay.invokeMethodAsync('OnRemoteAudioCommand', 'toggle', audioId, null);
    var audio = document.getElementById(audioId);
    if (!audio) return;
    if (audio.paused) audio.play();
    else audio.pause();
};

window.gospelPresenter.startSeek = function(audioId, event, bar) {
    var audio = document.getElementById(audioId);
    if (!audio || !audio.duration) return;
    event.preventDefault();

    var debounceTimer = null;
    audio._seeking = true;

    function getX(e) {
        return e.touches ? e.touches[0].clientX : e.clientX;
    }

    function seekTo(e) {
        var rect = bar.getBoundingClientRect();
        var ratio = Math.max(0, Math.min(1, (getX(e) - rect.left) / rect.width));
        audio.currentTime = ratio * audio.duration;
        gospelPresenter.updateAudioUI(audioId, audio.currentTime, audio.duration);
    }

    var originalVolume = audio.volume;
    audio.volume = 0;
    seekTo(event);

    function scheduleUnmute() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
            audio.volume = originalVolume;
        }, 150);
    }

    scheduleUnmute();

    function onMove(e) {
        audio.volume = 0;
        seekTo(e);
        scheduleUnmute();
    }

    function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        if (debounceTimer) clearTimeout(debounceTimer);
        audio._seeking = false;
        audio.volume = originalVolume;
        if (window.gospelPresenter._audioRelay)
            window.gospelPresenter._audioRelay.invokeMethodAsync('OnRemoteAudioCommand', 'seek', audioId, audio.currentTime);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onUp);
};

window.gospelPresenter.onAudioPlay = function(audioId, containerId) {
    var playIcon = document.getElementById(audioId + '-play-icon');
    var pauseIcon = document.getElementById(audioId + '-pause-icon');
    if (playIcon) playIcon.classList.add('hidden');
    if (pauseIcon) pauseIcon.classList.remove('hidden');

    // Pause all other audio elements in the same container
    var container = document.getElementById(containerId);
    if (container) {
        container.querySelectorAll('audio').forEach(function(a) {
            if (a.id !== audioId && !a.paused) {
                a.pause();
                a.currentTime = 0;
            }
        });
    }
};

window.gospelPresenter.onAudioPause = function(audioId) {
    var playIcon = document.getElementById(audioId + '-play-icon');
    var pauseIcon = document.getElementById(audioId + '-pause-icon');
    if (playIcon) playIcon.classList.remove('hidden');
    if (pauseIcon) pauseIcon.classList.add('hidden');
};

window.gospelPresenter.updateAudioUI = function(audioId, currentTime, duration) {
    var pct = (currentTime / duration) * 100;
    var progress = document.getElementById(audioId + '-progress');
    var thumb = document.getElementById(audioId + '-thumb');
    var current = document.getElementById(audioId + '-current');
    if (progress) progress.style.width = pct + '%';
    if (thumb) thumb.style.left = 'calc(' + pct + '% - 7px)';
    if (current) current.textContent = gospelPresenter.formatTime(currentTime);
};

window.gospelPresenter.onAudioTimeUpdate = function(audioId) {
    var audio = document.getElementById(audioId);
    if (!audio || !audio.duration || audio._seeking) return;
    gospelPresenter.updateAudioUI(audioId, audio.currentTime, audio.duration);
};

window.gospelPresenter.syncAudioUi = function(audioId) {
    var audio = document.getElementById(audioId);
    if (!audio) return;
    var playIcon = document.getElementById(audioId + '-play-icon');
    var pauseIcon = document.getElementById(audioId + '-pause-icon');
    if (!audio.paused) {
        if (playIcon) playIcon.classList.add('hidden');
        if (pauseIcon) pauseIcon.classList.remove('hidden');
    } else {
        if (playIcon) playIcon.classList.remove('hidden');
        if (pauseIcon) pauseIcon.classList.add('hidden');
    }
    if (audio.duration) {
        gospelPresenter.updateAudioUI(audioId, audio.currentTime, audio.duration);
        var duration = document.getElementById(audioId + '-duration');
        if (duration) duration.textContent = gospelPresenter.formatTime(audio.duration);
    }
};

window.gospelPresenter.onAudioMetadata = function(audioId) {
    var audio = document.getElementById(audioId);
    if (!audio) return;
    var duration = document.getElementById(audioId + '-duration');
    if (duration) duration.textContent = gospelPresenter.formatTime(audio.duration);
};

window.initScrollFade = function(scrollEl, fadeLeftEl, fadeRightEl) {
    function update() {
        var canScroll = scrollEl.scrollWidth > scrollEl.clientWidth + 1;
        var atStart = scrollEl.scrollLeft <= 1;
        var atEnd = scrollEl.scrollLeft + scrollEl.clientWidth >= scrollEl.scrollWidth - 1;
        fadeLeftEl.style.display = (canScroll && !atStart) ? '' : 'none';
        fadeRightEl.style.display = (canScroll && !atEnd) ? '' : 'none';
        scrollEl.classList.toggle('is-overflowing', canScroll);
    }
    var observer = new ResizeObserver(update);
    scrollEl.addEventListener('scroll', update);
    observer.observe(scrollEl);
    update();
    return {
        dispose: function() {
            scrollEl.removeEventListener('scroll', update);
            observer.disconnect();
        }
    };
};

window.gospelPresenter.fadeOutAudio = function(audioElement, button, durationMs) {
    durationMs = durationMs || 5000;
    if (audioElement.paused) return;
    if (audioElement._fadeInterval) return;
    if (window.gospelPresenter._audioRelay)
        window.gospelPresenter._audioRelay.invokeMethodAsync('OnRemoteAudioCommand', 'fade', audioElement.id, null);

    var startVolume = audioElement.volume;
    var startTime = Date.now();

    if (button) button.classList.add('fading-out');

    audioElement._fadeInterval = setInterval(function() {
        var elapsed = Date.now() - startTime;
        var progress = Math.min(1, elapsed / durationMs);
        // Ease-out: fast at start, slow at end
        var eased = 1 - Math.pow(1 - progress, 3);
        audioElement.volume = Math.max(0, startVolume * (1 - eased));

        if (progress >= 1) {
            clearInterval(audioElement._fadeInterval);
            audioElement._fadeInterval = null;
            audioElement.pause();
            audioElement.currentTime = 0;
            audioElement.volume = startVolume;
            if (button) button.classList.remove('fading-out');
        }
    }, 50);
};