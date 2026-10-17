// ==UserScript==
// @name         YouTube Longest Playlist Finder
// @namespace    youtube-longest-playlist
// @version      2.0
// @description  Find playlists matching a title and rank them by video count
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const PANEL_ID = 'YT_LONGEST_PLAYLIST_PANEL_V2';
    const STORAGE_KEY = 'YT_LONGEST_PLAYLIST_QUERY_V2';
    const POSITION_KEY = 'YT_LONGEST_PLAYLIST_POSITION_V2';
    const YELLOW = '#fff176';

    let scanTimer = null;
    let lastUrl = '';
    let startupAttempts = 0;

    function cleanText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function parseCount(text) {
        const value = cleanText(text).replace(/[٬،]/g, ',');
        const match = value.match(/[0-9][0-9,.\s]*/);
        if (!match) return null;
        const digits = match[0].replace(/[^0-9]/g, '');
        const count = Number(digits);
        return Number.isFinite(count) ? count : null;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    function getQuery() {
        return new URL(location.href).searchParams.get('search_query') || '';
    }

    function isPlaylistSearch() {
        return location.pathname === '/results' &&
            new URL(location.href).searchParams.get('sp') === 'EgIQAw==';
    }

    // -----------------------------------------------------
    // Draggable helper (from reference script)
    // -----------------------------------------------------
    function makeDraggable(element, handle, storageKey) {
        handle.style.cursor = 'move';
        handle.style.touchAction = 'none';
        handle.title = (handle.title ? handle.title + ' · ' : '') + 'Drag to move';

        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
            if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
                element.style.left = Math.max(0, Math.min(saved.left, window.innerWidth - 60)) + 'px';
                element.style.top = Math.max(0, Math.min(saved.top, window.innerHeight - 50)) + 'px';
                element.style.right = 'auto';
            }
        } catch (e) {}

        let drag = null;
        handle.addEventListener('pointerdown', function (event) {
            if (event.button !== 0 || event.target.closest('button, input, textarea, select, a')) return;
            const rect = element.getBoundingClientRect();
            drag = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                left: rect.left,
                top: rect.top
            };
            element.style.left = rect.left + 'px';
            element.style.top = rect.top + 'px';
            element.style.right = 'auto';
            handle.setPointerCapture(event.pointerId);
            event.preventDefault();
        });

        handle.addEventListener('pointermove', function (event) {
            if (!drag || drag.pointerId !== event.pointerId) return;
            const rect = element.getBoundingClientRect();
            const left = Math.max(0, Math.min(
                window.innerWidth - rect.width,
                drag.left + event.clientX - drag.x
            ));
            const top = Math.max(0, Math.min(
                window.innerHeight - Math.min(rect.height, window.innerHeight),
                drag.top + event.clientY - drag.y
            ));
            element.style.left = left + 'px';
            element.style.top = top + 'px';
        });

        function finishDrag(event) {
            if (!drag || drag.pointerId !== event.pointerId) return;
            drag = null;
            try {
                const rect = element.getBoundingClientRect();
                localStorage.setItem(storageKey, JSON.stringify({
                    left: rect.left,
                    top: rect.top
                }));
            } catch (e) {}
        }
        handle.addEventListener('pointerup', finishDrag);
        handle.addEventListener('pointercancel', finishDrag);
    }

    // -----------------------------------------------------
    // Panel — fully inline styled, exactly like the reference
    // -----------------------------------------------------
    function makePanel() {
        let panel = document.getElementById(PANEL_ID);
        if (panel) return panel;
        if (!document.body) return null;

        panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = `
            position:fixed !important;
            top:90px !important;
            right:18px !important;
            width:440px !important;
            max-height:78vh !important;
            overflow-y:auto !important;
            padding:0 !important;
            background:${YELLOW} !important;
            background-color:${YELLOW} !important;
            color:#161616 !important;
            border:3px solid #d5a900 !important;
            border-radius:12px !important;
            box-shadow:0 8px 28px rgba(0,0,0,.5) !important;
            z-index:2147483647 !important;
            font-family:Arial,sans-serif !important;
            font-size:14px !important;
            box-sizing:border-box !important;
            margin:0 !important;
        `;

        // ---- header (also the drag handle) ----
        const header = document.createElement('div');
        header.style.cssText = `
            position:sticky !important;
            top:0 !important;
            background:${YELLOW} !important;
            background-color:${YELLOW} !important;
            padding:12px !important;
            border-bottom:1px solid #ccc !important;
            z-index:10 !important;
            box-sizing:border-box !important;
        `;

        const title = document.createElement('div');
        title.textContent = '📚 Longest matching playlists';
        title.style.cssText = `
            font-size:17px !important;
            font-weight:900 !important;
            color:#161616 !important;
        `;
        header.appendChild(title);

        // ---- controls row ----
        const controls = document.createElement('div');
        controls.style.cssText = `
            display:flex !important;
            gap:6px !important;
            margin-top:9px !important;
        `;

        const input = document.createElement('input');
        input.type = 'search';
        input.placeholder = 'Playlist title, e.g. الجذور';
        input.setAttribute('aria-label', 'Search title');
        input.style.cssText = `
            min-width:0 !important;
            flex:1 !important;
            padding:8px !important;
            border:1px solid #888 !important;
            border-radius:6px !important;
            font-size:14px !important;
            background:#fff !important;
            color:#000 !important;
            box-sizing:border-box !important;
        `;
        try { input.value = localStorage.getItem(STORAGE_KEY) || getQuery(); } catch (_) { input.value = getQuery(); }
        controls.appendChild(input);

        const searchButton = document.createElement('button');
        searchButton.type = 'button';
        searchButton.textContent = 'Search';
        searchButton.style.cssText = `
            padding:7px 10px !important;
            border:0 !important;
            border-radius:6px !important;
            background:#c00 !important;
            color:#fff !important;
            font-weight:bold !important;
            cursor:pointer !important;
            box-sizing:border-box !important;
        `;
        controls.appendChild(searchButton);

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = '×';
        closeButton.title = 'Close';
        closeButton.style.cssText = `
            padding:7px 10px !important;
            border:0 !important;
            border-radius:6px !important;
            background:#444 !important;
            color:#fff !important;
            font-weight:bold !important;
            cursor:pointer !important;
            box-sizing:border-box !important;
        `;
        controls.appendChild(closeButton);

        header.appendChild(controls);

        const status = document.createElement('div');
        status.className = 'status';
        status.textContent = 'Enter a title, then Search. Results are ranked by video count.';
        status.style.cssText = `
            margin-top:8px !important;
            color:#555 !important;
            font-size:13px !important;
            line-height:1.4 !important;
        `;
        header.appendChild(status);

        panel.appendChild(header);

        // ---- results container ----
        const results = document.createElement('div');
        results.className = 'results';
        results.style.cssText = 'padding:0 !important;margin:0 !important;';
        panel.appendChild(results);

        document.body.appendChild(panel);

        makeDraggable(panel, header, POSITION_KEY);

        searchButton.addEventListener('click', () => startSearch(input.value));
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                startSearch(input.value);
            }
        });
        closeButton.addEventListener('click', () => panel.remove());

        return panel;
    }

    function startSearch(rawQuery) {
        const query = cleanText(rawQuery);
        if (!query) return;
        try { localStorage.setItem(STORAGE_KEY, query); } catch (_) {}
        const url = new URL('https://www.youtube.com/results');
        url.searchParams.set('search_query', query);
        url.searchParams.set('sp', 'EgIQAw==');
        location.assign(url.toString());
    }

    // -----------------------------------------------------
    // Playlist extraction
    // -----------------------------------------------------
    function findPlaylistCards() {
        const selectors = [
            'ytd-playlist-renderer',
            'ytd-radio-renderer',
            'ytd-grid-playlist-renderer'
        ];
        return Array.from(document.querySelectorAll(selectors.join(',')));
    }

    function extractPlaylist(card) {
        const link = card.querySelector('a[href*="list="]');
        if (!link) return null;
        const href = new URL(link.href, location.origin);
        const listId = href.searchParams.get('list');
        if (!listId) return null;

        const titleNode = card.querySelector('#video-title, #title, h3 a, a[title]');
        const title = cleanText(titleNode && (titleNode.textContent || titleNode.getAttribute('title')));
        if (!title) return null;

        const metadata = cleanText(card.innerText);
        let count = null;
        const countNodes = card.querySelectorAll('#video-count, .video-count, ytd-thumbnail-overlay-side-panel-renderer, yt-formatted-string');
        for (const node of countNodes) {
            count = parseCount(node.textContent);
            if (count !== null) break;
        }
        if (count === null) {
            const match = metadata.match(/(?:^|\n)\s*([0-9][0-9,.\s]*)\s*(?:videos?|vidéos?|فيديو(?:هات)?)/i);
            if (match) count = parseCount(match[1]);
        }
        return {
            title,
            count,
            url: 'https://www.youtube.com/playlist?list=' + encodeURIComponent(listId),
            owner: cleanText(card.querySelector('#channel-name, ytd-channel-name')?.innerText || '')
        };
    }

    function updateResults() {
        if (!document.body) return;
        const panel = makePanel();
        if (!panel) return;

        const query = getQuery();
        const input = panel.querySelector('input');
        if (query && input && !input.value) input.value = query;

        const cards = findPlaylistCards();
        const unique = new Map();
        for (const card of cards) {
            const item = extractPlaylist(card);
            if (!item) continue;
            if (!unique.has(item.url) || (item.count || 0) > (unique.get(item.url).count || 0)) {
                unique.set(item.url, item);
            }
        }
        const ranked = Array.from(unique.values()).sort((a, b) => (b.count ?? -1) - (a.count ?? -1));

        const status = panel.querySelector('.status');
        const isFiltered = isPlaylistSearch();
        const statusText = isFiltered
            ? `${ranked.length} playlist(s) found on this page. Scroll down to load more, then wait for the ranking to refresh.`
            : 'Enter a title and press Search. YouTube playlist results are ranked by their displayed video counts.';
        if (status.textContent !== statusText) status.textContent = statusText;

        const resultsHtml = ranked.map((item, index) => `
          <div class="item" style="padding:10px 12px !important;border-bottom:1px solid #ddd !important;">
            <div><strong>${index + 1}.</strong> <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" style="font-weight:bold !important;color:#0645ad !important;text-decoration:none !important;">${escapeHtml(item.title)}</a></div>
            <div style="margin-top:4px !important;color:#444 !important;">${item.count === null ? 'Video count unavailable' : `${item.count.toLocaleString()} videos`}${item.owner ? ` · ${escapeHtml(item.owner)}` : ''}</div>
          </div>`).join('') || (isFiltered ? '<div style="padding:10px 12px !important;">No playlist cards loaded yet. Scroll the YouTube results page to load them.</div>' : '');

        const results = panel.querySelector('.results');
        if (results.innerHTML !== resultsHtml) results.innerHTML = resultsHtml;
    }

    function scheduleUpdate() {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(updateResults, 500);
    }

    function initialize() {
        if (!document.body) {
            if (startupAttempts++ < 60) setTimeout(initialize, 500);
            return;
        }
        makePanel();
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            const query = getQuery();
            if (isPlaylistSearch() && query) {
                const input = document.querySelector(`#${PANEL_ID} input`);
                if (input) input.value = query;
            }
        }
        updateResults();
    }

    // -----------------------------------------------------
    // Re-injection (from reference script)
    // -----------------------------------------------------
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('yt-navigate-finish', initialize);
    window.addEventListener('popstate', initialize);

    const reattachTimer = setInterval(() => {
        if (!document.getElementById(PANEL_ID) && document.body) initialize();
    }, 1000);

    setTimeout(initialize, 300);
    setTimeout(initialize, 1200);
    setTimeout(initialize, 3000);
})();
