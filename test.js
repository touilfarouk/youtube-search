// ==UserScript==
// @name         YouTube Channel Title Search - FULL SCANNER
// @namespace    youtube-channel-search
// @version      11.0
// @description  Search all loaded channel videos and display matching titles
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    console.log('YouTube Channel Search v10 started');

    // =========================================================
    // SETTINGS
    // =========================================================

    const TOOL_ID = 'YT_CHANNEL_SEARCH_TOOL_V10';
    const RESULTS_ID = 'YT_SEARCH_RESULTS_PANEL_V10';

    let currentChannel = 'prof_dekiche_alimath';
    let currentKeyword = 'الجذور';

    let allVideos = [];
    let collectedVideoURLs = new Set();
    let displayedResultURLs = new Set();
    let uploadDateQueue = [];
    let activeDateLookups = 0;

    let scanning = false;
    let stopScan = false;

    // =========================================================
    // NORMALIZE
    // =========================================================

    function normalize(text) {

        return String(text || '')
            .normalize('NFKC')
            .replace(/[\u061C\u0640\u064B-\u065F\u0670\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')
            .replace(/\s+/g, ' ')
            .toLowerCase()
            .trim();
    }

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

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[character];
        });
    }

    function titleHtmlWithHighlight(title, keyword) {
        const source = String(title || '');
        const index = source.toLocaleLowerCase().indexOf(String(keyword || '').toLocaleLowerCase());
        if (!keyword || index < 0) return escapeHtml(source);
        return escapeHtml(source.slice(0, index)) +
            '<mark>' + escapeHtml(source.slice(index, index + keyword.length)) + '</mark>' +
            escapeHtml(source.slice(index + keyword.length));
    }

    function exportSearchResults() {
        const videos = allVideos.filter(video => displayedResultURLs.has(video.url));
        if (!videos.length) return;

        const items = videos.map(function (video) {
            return '<li><a href="' + escapeHtml(video.url) + '">' +
                titleHtmlWithHighlight(video.title, currentKeyword) + '</a><div class="meta">' +
                'Durée : ' + escapeHtml(video.duration || 'indisponible') +
                ' · Date de création : ' +
                escapeHtml(video.uploadDate || (video.dateLookupDone ? 'indisponible' : 'chargement…')) +
                '</div></li>';
        }).join('');
        const html = [
            '<!doctype html>',
            '<html lang="fr"><head><meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            '<title>Résultats YouTube — ' + escapeHtml(currentKeyword) + '</title>',
            '<style>',
            'body{font:16px Arial,sans-serif;max-width:900px;margin:32px auto;padding:0 18px;color:#171717}',
            'h1{font-size:24px}.summary{color:#555;margin-bottom:22px}',
            'li{padding:14px;margin:10px 0;background:#f6f6f6;border:1px solid #ddd;border-radius:8px}',
            'a{color:#1558b0;font-weight:700;text-decoration:none}a:hover{text-decoration:underline}',
            'mark{background:#fff176;padding:1px 3px;border-radius:3px}.meta{margin-top:6px;color:#666;font-size:14px}',
            '</style></head><body>',
            '<h1>📋 SEARCH RESULTS</h1>',
            '<div class="summary">' + escapeHtml(currentKeyword) + ' — ' + videos.length +
                ' résultat(s) · ' + allVideos.length + ' vidéo(s) vérifiée(s)</div>',
            '<ol>' + items + '</ol></body></html>'
        ].join('\n');

        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const objectUrl = URL.createObjectURL(blob);
        const download = document.createElement('a');
        const safeKeyword = currentKeyword.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim().slice(0, 60) || 'search';
        download.href = objectUrl;
        download.download = 'youtube_search_' + safeKeyword + '_' + new Date().toISOString().slice(0, 10) + '.html';
        document.body.appendChild(download);
        download.click();
        download.remove();
        setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 30000);
    }

    // =========================================================
    // CREATE TOOL
    // =========================================================

    function createTool() {

        if (document.getElementById(TOOL_ID)) {
            return;
        }

        if (!document.body) {
            setTimeout(createTool, 500);
            return;
        }

        const box = document.createElement('div');

        box.id = TOOL_ID;

        box.style.cssText = `
            position:fixed !important;

            top:80px !important;
            left:20px !important;

            width:430px !important;

            padding:18px !important;

            background:#ffff00 !important;
            color:#000000 !important;

            border:5px solid #ff0000 !important;

            border-radius:14px !important;

            box-shadow:0 0 25px rgba(0,0,0,.8) !important;

            z-index:2147483647 !important;

            font-family:Arial,sans-serif !important;

            box-sizing:border-box !important;
        `;

        // =====================================================
        // TITLE
        // =====================================================

        const title = document.createElement('div');

        title.textContent =
            '🔎 YOUTUBE CHANNEL SEARCH';

        title.style.cssText = `
            font-size:22px;
            font-weight:900;
            margin-bottom:14px;
        `;

        box.appendChild(title);
        makeDraggable(box, title, 'YT_CHANNEL_SEARCH_TOOL_POSITION_V1');

        // =====================================================
        // CHANNEL
        // =====================================================

        const channelLabel = document.createElement('div');

        channelLabel.textContent =
            '1️⃣ Channel name / @handle';

        channelLabel.style.cssText = `
            font-size:14px;
            font-weight:bold;
            margin-bottom:5px;
        `;

        box.appendChild(channelLabel);

        const channelInput = document.createElement('input');

        channelInput.id =
            'YT_CHANNEL_INPUT_V10';

        channelInput.type =
            'text';

        channelInput.value =
            currentChannel;

        channelInput.placeholder =
            '@prof_dekiche_alimath';

        channelInput.style.cssText = `
            width:100%;
            box-sizing:border-box;

            padding:10px;

            font-size:17px;
            font-weight:bold;

            color:#000;
            background:#fff;

            border:3px solid #000;
            border-radius:7px;

            margin-bottom:10px;
        `;

        box.appendChild(channelInput);

        // =====================================================
        // KEYWORD
        // =====================================================

        const keywordLabel = document.createElement('div');

        keywordLabel.textContent =
            '2️⃣ Keyword';

        keywordLabel.style.cssText = `
            font-size:14px;
            font-weight:bold;
            margin-bottom:5px;
        `;

        box.appendChild(keywordLabel);

        const keywordInput = document.createElement('input');

        keywordInput.id =
            'YT_KEYWORD_INPUT_V10';

        keywordInput.type =
            'text';

        keywordInput.value =
            currentKeyword;

        keywordInput.placeholder =
            'الجذور';

        keywordInput.dir =
            'auto';

        keywordInput.style.cssText = `
            width:100%;
            box-sizing:border-box;

            padding:10px;

            font-size:18px;
            font-weight:bold;

            color:#000;
            background:#fff;

            border:3px solid #000;
            border-radius:7px;

            margin-bottom:10px;
        `;

        box.appendChild(keywordInput);

        // =====================================================
        // SEARCH
        // =====================================================

        const searchButton =
            document.createElement('button');

        searchButton.type = 'button';

        searchButton.textContent =
            '🔍 SEARCH ALL VIDEOS';

        searchButton.style.cssText = `
            width:100%;

            padding:12px;

            font-size:17px;
            font-weight:900;

            color:#fff;
            background:#000;

            border:3px solid #000;
            border-radius:7px;

            cursor:pointer;

            margin-bottom:7px;
        `;

        box.appendChild(searchButton);

        // =====================================================
        // STOP
        // =====================================================

        const stopButton =
            document.createElement('button');

        stopButton.type = 'button';

        stopButton.textContent =
            '⛔ STOP SCAN';

        stopButton.style.cssText = `
            width:100%;

            padding:9px;

            font-size:15px;
            font-weight:bold;

            color:#fff;
            background:#cc0000;

            border:3px solid #000;
            border-radius:7px;

            cursor:pointer;

            margin-bottom:7px;
        `;

        box.appendChild(stopButton);

        // =====================================================
        // OPEN CHANNEL
        // =====================================================

        const channelButton =
            document.createElement('button');

        channelButton.type = 'button';

        channelButton.textContent =
            '📺 OPEN CHANNEL VIDEOS';

        channelButton.style.cssText = `
            width:100%;

            padding:10px;

            font-size:15px;
            font-weight:bold;

            color:#fff;
            background:#0066ff;

            border:3px solid #000;
            border-radius:7px;

            cursor:pointer;

            margin-bottom:7px;
        `;

        box.appendChild(channelButton);

        // =====================================================
        // STATUS
        // =====================================================

        const status =
            document.createElement('div');

        status.id =
            'YT_SEARCH_STATUS_V10';

        status.textContent =
            'Ready';

        status.style.cssText = `
            padding:9px;

            background:#fff;

            color:#000;

            border:2px solid #000;

            border-radius:6px;

            font-size:14px;

            font-weight:bold;

            line-height:1.4;
        `;

        box.appendChild(status);

        document.body.appendChild(box);

        // =====================================================
        // SEARCH BUTTON
        // =====================================================

        searchButton.addEventListener(
            'click',
            function (event) {

                event.preventDefault();
                event.stopPropagation();

                currentChannel =
                    channelInput.value.trim();

                currentKeyword =
                    keywordInput.value.trim();

                if (!currentChannel) {
                    status.textContent =
                        '❌ Enter a channel name.';
                    return;
                }

                if (!currentKeyword) {
                    status.textContent =
                        '❌ Enter a keyword.';
                    return;
                }

                startSearch();

            },
            true
        );

        // =====================================================
        // ENTER
        // =====================================================

        keywordInput.addEventListener(
            'keydown',
            function (event) {

                if (event.key === 'Enter') {

                    event.preventDefault();

                    currentChannel =
                        channelInput.value.trim();

                    currentKeyword =
                        keywordInput.value.trim();

                    startSearch();
                }

            }
        );

        // =====================================================
        // STOP
        // =====================================================

        stopButton.addEventListener(
            'click',
            function (event) {

                event.preventDefault();
                event.stopPropagation();

                stopScan = true;

                status.textContent =
                    '⛔ Stopping scan...';

            },
            true
        );

        // =====================================================
        // OPEN CHANNEL
        // =====================================================

        channelButton.addEventListener(
            'click',
            function (event) {

                event.preventDefault();
                event.stopPropagation();

                const channel =
                    cleanChannel(
                        channelInput.value
                    );

                if (!channel) {
                    return;
                }

                window.location.href =
                    'https://www.youtube.com/@' +
                    channel +
                    '/videos';

            },
            true
        );
    }

    // =========================================================
    // CLEAN CHANNEL
    // =========================================================

    function cleanChannel(value) {

        let channel =
            String(value || '').trim();

        channel = channel.replace(
            /^https?:\/\/(www\.)?youtube\.com\//i,
            ''
        );

        channel = channel.replace(/^@/, '').replace(/\/.*$/, '').trim();

        try {
            return decodeURIComponent(channel);
        } catch (e) {
            return channel;
        }
    }

    // =========================================================
    // START SEARCH
    // =========================================================

    function startSearch() {

        const status =
            document.getElementById(
                'YT_SEARCH_STATUS_V10'
            );

        if (!currentChannel ||
            !currentKeyword) {

            return;
        }

        stopScan = false;

        allVideos = [];
        collectedVideoURLs = new Set();

        saveSearch();

        const channel =
            cleanChannel(
                currentChannel
            );

        const currentPath =
            window.location.pathname.replace(/\/$/, '');

        const match = currentPath.match(/^\/@([^/]+)(?:\/videos)?$/i);
        let routeChannel = match ? match[1] : '';
        try {
            routeChannel = decodeURIComponent(routeChannel);
        } catch (e) {}
        const correctChannel = Boolean(
            routeChannel && normalize(routeChannel) === normalize(channel)
        );

        const videosPage =
            /\/videos$/i.test(currentPath);

        // =====================================================
        // GO TO CHANNEL VIDEOS
        // =====================================================

        if (!correctChannel || !videosPage) {

            if (status) {
                status.textContent = '📺 Opening channel videos...';
            }

            window.location.href =
                'https://www.youtube.com/@' +
                channel +
                '/videos';

            return;
        }

        // =====================================================
        // START SCANNING
        // =====================================================

        scanChannel();

    }

    // =========================================================
    // SAVE SEARCH
    // =========================================================

    function saveSearch() {

        try {

            sessionStorage.setItem(
                'YT_SEARCH_CHANNEL_V10',
                currentChannel
            );

            sessionStorage.setItem(
                'YT_SEARCH_KEYWORD_V10',
                currentKeyword
            );

            sessionStorage.setItem(
                'YT_SEARCH_AUTOSTART_V10',
                '1'
            );

        } catch (e) {

            console.log(
                'sessionStorage unavailable'
            );
        }
    }

    // =========================================================
    // LOAD SAVED SEARCH
    // =========================================================

    function loadSavedSearch() {

        try {

            const channel =
                sessionStorage.getItem(
                    'YT_SEARCH_CHANNEL_V10'
                );

            const keyword =
                sessionStorage.getItem(
                    'YT_SEARCH_KEYWORD_V10'
                );

            if (channel) {
                currentChannel = channel;
            }

            if (keyword) {
                currentKeyword = keyword;
            }

        } catch (e) {}
    }

    // =========================================================
    // SHOULD AUTOSTART?
    // =========================================================

    function shouldAutoStart() {

        try {

            return (
                sessionStorage.getItem(
                    'YT_SEARCH_AUTOSTART_V10'
                ) === '1'
            );

        } catch (e) {

            return false;
        }
    }

    // =========================================================
    // CLEAR AUTOSTART
    // =========================================================

    function clearAutoStart() {

        try {

            sessionStorage.removeItem(
                'YT_SEARCH_AUTOSTART_V10'
            );

        } catch (e) {}
    }

    // =========================================================
    // FIND VIDEO CARDS
    // =========================================================

    function getVideoCards() {

        return Array.from(
            document.querySelectorAll(
                `
                ytd-rich-item-renderer,
                ytd-rich-grid-media,
                ytd-rich-grid-slim-media,
                ytd-grid-video-renderer,
                ytd-video-renderer,
                ytd-playlist-video-renderer,
                yt-lockup-view-model,
                a#video-title[href*='/watch'],
                a#video-title-link[href*='/watch']
                `
            )
        );

    }

    // =========================================================
    // GET VIDEO TITLE
    // =========================================================

    function getTitle(card) {

        const isDuration = value => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value.trim());

        if (card.matches && card.matches('a[href*="/watch"]')) {
            const ownTitle = (
                card.getAttribute('title') ||
                card.getAttribute('aria-label') ||
                card.textContent ||
                ''
            ).trim();
            if (ownTitle && !isDuration(ownTitle)) return ownTitle;
        }

        const selectors = [

            '#video-title',

            '#video-title-link',

            'yt-lockup-metadata-view-model h3 a[href*="/watch"]',

            'h3 a[href*="/watch"]',

            'yt-formatted-string#video-title'

        ];

        for (
            const selector of selectors
        ) {

            const element =
                card.querySelector(selector);

            if (!element) {
                continue;
            }

            const title =
                (
                    element.textContent ||
                    element.getAttribute('title') ||
                    element.getAttribute('aria-label') ||
                    ''
                ).trim();

            if (title && !isDuration(title)) {
                return title;
            }
        }

        for (const link of card.querySelectorAll('a[href*="/watch"]')) {
            const title = (
                link.getAttribute('title') ||
                link.getAttribute('aria-label') ||
                link.textContent ||
                ''
            ).trim();
            if (title && !isDuration(title)) return title;
        }

        return '';
    }

    // =========================================================
    // GET VIDEO URL
    // =========================================================

    function getURL(card) {

        const links = [];
        if (card.matches && card.matches('a[href*="/watch"]')) {
            links.push(card);
        }
        links.push(...card.querySelectorAll('a[href*="/watch"]'));

        for (const link of links) {

            try {
                const url = new URL(link.href, window.location.href);
                const videoId = url.searchParams.get('v');
                if (url.pathname === '/watch' && videoId) {
                    return 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId);
                }
            } catch (e) {}
        }

        return '';
    }

    // =========================================================
    // COLLECT CURRENT VIDEOS
    // =========================================================

    function getCardContainer(element) {
        const known = element.closest(
            'ytd-rich-item-renderer, ytd-rich-grid-media, ytd-rich-grid-slim-media, ' +
            'ytd-grid-video-renderer, ytd-video-renderer, ytd-playlist-video-renderer, ' +
            'yt-lockup-view-model'
        );
        let node = known || element;
        let best = node;

        for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
            const links = Array.from(node.querySelectorAll('a[href*="/watch?v="]'));
            if (node.matches && node.matches('a[href*="/watch?v="]')) links.push(node);
            const ids = new Set();
            for (const link of links) {
                try {
                    const id = new URL(link.href, window.location.href).searchParams.get('v');
                    if (id) ids.add(id);
                } catch (e) {}
            }
            if (ids.size > 1) break;
            if (ids.size === 1) {
                best = node;
                if (getDuration(node) && getUploadDate(node)) return node;
            }
        }
        return best;
    }

    function getDuration(card) {
        const durationPattern = /^\d{1,2}:\d{2}(?::\d{2})?$/;
        const selectors = [
            'ytd-thumbnail-overlay-time-status-renderer #text',
            'ytd-thumbnail-overlay-time-status-renderer span',
            'yt-thumbnail-badge-view-model .yt-badge-shape__text',
            '.badge-shape-wiz__text',
            '[aria-label*="duration"]'
        ];

        for (const selector of selectors) {
            for (const element of card.querySelectorAll(selector)) {
                const value = (element.innerText || element.textContent || element.getAttribute('aria-label') || '').trim();
                if (durationPattern.test(value)) return value;
            }
        }

        for (const link of card.querySelectorAll('a[href*="/watch"]')) {
            const label = [link.getAttribute('aria-label'), link.getAttribute('title'), link.textContent].filter(Boolean).join(' ');
            const match = label.match(/(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?)(?=\s|$)/);
            if (match) return match[1];
        }
        for (const element of card.querySelectorAll('span, [aria-label], [title]')) {
            const values = [element.innerText, element.textContent, element.getAttribute('aria-label'), element.getAttribute('title')];
            for (const candidate of values) {
                const match = String(candidate || '').trim().match(/^(\d{1,2}:\d{2}(?::\d{2})?)$/);
                if (match) return match[1];
            }
        }
        const cardText = card.innerText || card.textContent || '';
        const textMatch = cardText.match(/(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?)(?=\s|$)/);
        return textMatch ? textMatch[1] : '';
    }

    function getUploadDate(card) {
        const selectors = [
            '#metadata-line span',
            'ytd-video-meta-block #metadata-line span',
            'yt-content-metadata-view-model .inline-metadata-item',
            '.inline-metadata-item'
        ];
        const datePatterns = [
            /\b\d+\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?|[smhdwy])\s+ago\b/i,
            /\b(?:yesterday|today|streamed|premiered)\b/i,
            /\bil y a\s+\d+\s+(?:jours?|semaines?|mois|ans?)\b/i,
            /(?:منذ|قبل)\s*[0-9٠-٩۰-۹]+\s*(?:ثانية|دقيقة|ساعة|يوم|أيام|أسبوع|أسابيع|شهر|أشهر|سنة|سنوات|عام|أعوام)(?:ين|ان)?/i,
            /(?:منذ|قبل)\s*(?:يومين|أسبوعين|شهرين|سنتين|عامين|يوم|أسبوع|شهر|سنة|عام)/i,
            /\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/,
            /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+(?:19|20)\d{2}\b/i,
            /\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:19|20)\d{2}\b/i
        ];

        const candidates = [];
        for (const selector of selectors) {
            for (const element of card.querySelectorAll(selector)) {
                const value = (element.innerText || element.textContent || '').trim();
                if (value) candidates.push(value);
            }
        }
        candidates.push(card.innerText || card.textContent || '');

        for (const candidate of candidates) {
            for (const pattern of datePatterns) {
                const match = candidate.match(pattern);
                if (match) return match[0];
            }
        }
        return '';
    }

    function getSearchableText(card, title) {
        const parts = [
            title,
            card.textContent,
            card.innerText,
            card.getAttribute('title'),
            card.getAttribute('aria-label')
        ];

        for (const element of card.querySelectorAll('a[href*="/watch"], [title], [aria-label]')) {
            parts.push(
                element.textContent,
                element.getAttribute('title'),
                element.getAttribute('aria-label')
            );
        }

        return parts.filter(Boolean).join(' ');
    }

    function collectCurrentVideos() {

        const cards =
            getVideoCards();

        const addedVideos = [];

        for (const card of cards) {
            const container = getCardContainer(card);
            const title = getTitle(container) || getTitle(card);
            const url = getURL(container) || getURL(card);

            if (!title || !url) {
                continue;
            }

            if (!collectedVideoURLs.has(url)) {
                collectedVideoURLs.add(url);
                const video = {
                    title,
                    url,
                    duration: getDuration(container),
                    uploadDate: getUploadDate(container),
                    searchText: getSearchableText(container, title)
                };
                allVideos.push(video);
                addedVideos.push(video);
            }
        }

        return addedVideos;
    }

    // =========================================================
    // WAIT
    // =========================================================

    function wait(ms) {

        return new Promise(
            resolve =>
                setTimeout(resolve, ms)
        );

    }

    // =========================================================
    // SCROLL TO BOTTOM
    // =========================================================

    function scrollDown() {

        window.scrollTo(
            0,
            document.documentElement.scrollHeight
        );

    }

    // =========================================================
    // SCAN CHANNEL
    // =========================================================

    async function scanChannel() {

        if (scanning) {
            return;
        }

        scanning = true;
        stopScan = false;

        const status =
            document.getElementById(
                'YT_SEARCH_STATUS_V10'
            );

        if (status) {

            status.textContent =
                '🔎 Starting scan...';

        }

        // Show the results panel immediately, then populate it while scanning.
        displayResults([], false, true);

        // Give YouTube time to render
        await wait(2000);

        let noNewRounds = 0;

        let lastHeight = 0;

        let round = 0;

        const MAX_ROUNDS = 200;

        while (
            !stopScan &&
            round < MAX_ROUNDS
        ) {

            round++;

            // ---------------------------------------------
            // COLLECT
            // ---------------------------------------------

            const addedVideos = collectCurrentVideos();
            const added = addedVideos.length;
            const keyword = normalize(currentKeyword);
            const newMatches = addedVideos.filter(video =>
                normalize(video.searchText || video.title).includes(keyword)
            );

            // Show each match as soon as it is discovered.
            displayResults(newMatches, false);

            // ---------------------------------------------
            // STATUS
            // ---------------------------------------------

            if (status) {

                status.textContent =
                    '🔎 Scanning channel... ' +
                    'Round ' +
                    round +
                    ' | ' +
                    allVideos.length +
                    ' videos collected';

            }

            // ---------------------------------------------
            // CHECK NEW CONTENT
            // ---------------------------------------------

            if (added > 0) {
                noNewRounds = 0;
            } else {
                noNewRounds++;
            }

            // ---------------------------------------------
            // SCROLL
            // ---------------------------------------------

            scrollDown();

            await wait(1800);

            // ---------------------------------------------
            // HEIGHT
            // ---------------------------------------------

            const height =
                document.documentElement.scrollHeight;

            // ---------------------------------------------
            // END CONDITION
            // ---------------------------------------------

            const pageGrew = height > lastHeight;
            lastHeight = height;

            /*
             * YouTube sometimes needs several rounds
             * before loading more videos.
             */

            if (noNewRounds >= 8 && !pageGrew) {
                break;
            }

        }

        // Collect and display anything loaded during the final wait.
        const finalVideos = collectCurrentVideos();
        const keyword = normalize(currentKeyword);
        const finalMatches = finalVideos.filter(video =>
            normalize(video.searchText || video.title).includes(keyword)
        );
        displayResults(finalMatches, true);

        scanning = false;
        const matchCount = displayedResultURLs.size;

        if (status) {

            if (stopScan) {

                status.textContent =
                    '⛔ Scan stopped — ' +
                    allVideos.length +
                    ' videos collected — ' +
                    matchCount +
                    ' match(es)';

            } else {

                status.textContent =
                    '✅ Scan complete — ' +
                    allVideos.length +
                    ' videos scanned — ' +
                    matchCount +
                    ' match(es)';

            }

        }

        clearAutoStart();

    }

    // =========================================================
    // HIGHLIGHT TITLE
    // =========================================================

    function createHighlightedTitle(title, keyword) {
        const container = document.createElement('span');
        const source = String(title || '');
        const ignored = /[\u061C\u0640\u064B-\u065F\u0670\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
        const needle = normalize(keyword).toLocaleLowerCase();
        let normalized = '';
        const starts = [];
        const ends = [];

        for (let offset = 0; offset < source.length;) {
            const point = String.fromCodePoint(source.codePointAt(offset));
            const end = offset + point.length;
            const part = point.normalize('NFKC').replace(ignored, '').toLocaleLowerCase();
            for (let i = 0; i < part.length; i++) {
                const char = part[i];
                if (/\s/.test(char)) {
                    if (normalized && !normalized.endsWith(' ')) {
                        normalized += ' ';
                        starts.push(offset);
                        ends.push(end);
                    }
                } else {
                    normalized += char;
                    starts.push(offset);
                    ends.push(end);
                }
            }
            offset = end;
        }

        const trimmed = normalized.trim();
        const leading = normalized.length - normalized.trimStart().length;
        normalized = trimmed;
        starts.splice(0, leading);
        ends.splice(0, leading);
        while (normalized.endsWith(' ')) {
            normalized = normalized.slice(0, -1);
            starts.pop();
            ends.pop();
        }

        if (!needle) {
            container.textContent = source;
            return container;
        }

        let sourceCursor = 0;
        let searchCursor = 0;
        let found = false;
        let index = normalized.indexOf(needle, searchCursor);
        while (index !== -1) {
            const sourceStart = starts[index];
            const sourceEnd = ends[index + needle.length - 1];
            if (sourceStart >= sourceCursor && sourceEnd > sourceStart) {
                container.appendChild(document.createTextNode(source.slice(sourceCursor, sourceStart)));
                const mark = document.createElement('mark');
                mark.textContent = source.slice(sourceStart, sourceEnd);
                mark.style.cssText = 'background:#ffff00 !important;color:#000 !important;font-weight:900 !important;padding:2px 4px;border-radius:3px;';
                container.appendChild(mark);
                sourceCursor = sourceEnd;
                found = true;
            }
            searchCursor = index + needle.length;
            index = normalized.indexOf(needle, searchCursor);
        }

        if (found) {
            container.appendChild(document.createTextNode(source.slice(sourceCursor)));
        } else {
            container.textContent = source;
        }
        return container;
    }

    function parsePublishedDate(html) {
        const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
        for (const tag of metaTags) {
            const itemprop = tag.match(/\bitemprop=["']([^"']+)["']/i);
            if (!itemprop || !/^(datePublished|uploadDate)$/i.test(itemprop[1])) continue;
            const content = tag.match(/\bcontent=["']([^"']+)["']/i);
            if (content && /^\d{4}-\d{2}-\d{2}/.test(content[1])) return content[1].slice(0, 10);
        }

        const match = html.match(/["'](?:datePublished|uploadDate|publishDate)["']\s*:\s*["'](\d{4}-\d{2}-\d{2})/i);
        return match ? match[1] : '';
    }

    async function fetchPublishedDate(video) {
        try {
            const videoURL = new URL(video.url, window.location.origin);
            const response = await fetch(videoURL.pathname + videoURL.search, { credentials: 'same-origin' });
            if (!response.ok) throw new Error('Video page request failed');
            const html = await response.text();
            video.uploadDate = parsePublishedDate(html) || video.uploadDate || '';
        } catch (e) {
            // Keep YouTube's relative upload date from the channel card if page lookup fails.
        }
        video.dateLookupDone = true;

        const videoId = new URL(video.url).searchParams.get('v');
        const metadata = document.getElementById('YT_RESULT_META_' + videoId);
        if (metadata) {
            metadata.textContent = [
                video.duration ? 'Durée : ' + video.duration : 'Durée : indisponible',
                'Date de création : ' + (video.uploadDate || (video.dateLookupDone ? 'Date indisponible' : 'chargement…'))
            ].join(' · ');
        }
    }

    function processUploadDateQueue() {
        while (activeDateLookups < 3 && uploadDateQueue.length) {
            const video = uploadDateQueue.shift();
            activeDateLookups++;
            fetchPublishedDate(video).finally(function () {
                activeDateLookups--;
                processUploadDateQueue();
            });
        }
    }

    function queueUploadDateLookup(video) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(video.uploadDate || '') || video.dateLookupQueued) return;
        video.dateLookupQueued = true;
        uploadDateQueue.push(video);
        processUploadDateQueue();
    }

    // =========================================================
    // DISPLAY RESULTS
    // =========================================================

    function displayResults(
        newMatches,
        scanFinished = false,
        reset = false,
        scannedCount = allVideos.length
    ) {

        let panel = document.getElementById(RESULTS_ID);

        if (reset || !panel) {
            if (panel) panel.remove();
            displayedResultURLs = new Set();

            panel = document.createElement('div');
            panel.id = RESULTS_ID;
            panel.style.cssText = `
                position:fixed !important;
                top:80px !important;
                right:20px !important;
                width:560px !important;
                max-height:82vh !important;
                overflow-y:auto !important;
                padding:15px !important;
                background:#ffffff !important;
                color:#000000 !important;
                border:4px solid #222 !important;
                border-radius:12px !important;
                box-shadow:0 5px 30px rgba(0,0,0,.7) !important;
                z-index:2147483646 !important;
                font-family:Arial,sans-serif !important;
                box-sizing:border-box !important;
            `;

            const header = document.createElement('div');
            header.style.cssText = `
                position:sticky; top:0; background:#fff; padding:10px;
                border-bottom:3px solid #000; margin-bottom:10px; z-index:10;
            `;

            const heading = document.createElement('div');
            heading.textContent = '📋 SEARCH RESULTS';
            heading.style.cssText = 'font-size:21px;font-weight:900;';

            const titleRow = document.createElement('div');
            titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;';
            titleRow.appendChild(heading);

            const exportButton = document.createElement('button');
            exportButton.id = 'YT_SEARCH_EXPORT_HTML_V11';
            exportButton.type = 'button';
            exportButton.textContent = '⬇ Export HTML';
            exportButton.style.cssText = 'padding:7px 10px;background:#176b35;color:#fff;border:1px solid #124d28;border-radius:6px;font-weight:bold;cursor:pointer;white-space:nowrap;';
            exportButton.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
            exportButton.addEventListener('click', function (event) {
                event.preventDefault();
                event.stopPropagation();
                exportSearchResults();
            });
            titleRow.appendChild(exportButton);
            header.appendChild(titleRow);

            const info = document.createElement('div');
            info.id = 'YT_SEARCH_RESULTS_INFO_V10';
            info.style.cssText = 'margin-top:5px;font-size:15px;font-weight:bold;';
            header.appendChild(info);
            panel.appendChild(header);
            makeDraggable(panel, header, 'YT_SEARCH_RESULTS_POSITION_V1');

            const empty = document.createElement('div');
            empty.id = 'YT_SEARCH_RESULTS_EMPTY_V10';
            empty.style.cssText = 'padding:20px;font-size:17px;font-weight:bold;';
            panel.appendChild(empty);

            const list = document.createElement('div');
            list.id = 'YT_SEARCH_RESULTS_LIST_V10';
            panel.appendChild(list);
            document.body.appendChild(panel);
        }

        const info = document.getElementById('YT_SEARCH_RESULTS_INFO_V10');
        const empty = document.getElementById('YT_SEARCH_RESULTS_EMPTY_V10');
        const list = document.getElementById('YT_SEARCH_RESULTS_LIST_V10');

        for (const video of newMatches) {
            if (displayedResultURLs.has(video.url)) continue;
            displayedResultURLs.add(video.url);

            const item = document.createElement('div');
            item.style.cssText = `
                padding:12px; margin-bottom:8px; background:#f5f5f5;
                border:1px solid #bbb; border-radius:8px;
            `;

            const number = document.createElement('span');
            number.textContent = displayedResultURLs.size + '. ';
            number.style.cssText = 'font-weight:900;color:#555;';
            item.appendChild(number);

            const link = document.createElement('a');
            link.href = video.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.style.cssText = `
                color:#0000cc; font-size:17px; font-weight:bold;
                line-height:1.5; text-decoration:none; cursor:pointer;
            `;
            link.appendChild(createHighlightedTitle(video.title, currentKeyword));
            item.appendChild(link);

            const videoId = new URL(video.url).searchParams.get('v');
            const metadata = document.createElement('div');
            metadata.id = 'YT_RESULT_META_' + videoId;
            metadata.textContent = [
                video.duration ? 'Durée : ' + video.duration : 'Durée : indisponible',
                'Date de création : ' + (video.uploadDate || (video.dateLookupDone ? 'Date indisponible' : 'chargement…'))
            ].join(' · ');
            metadata.style.cssText = 'margin-top:5px;color:#666;font-size:13px;';
            item.appendChild(metadata);

            list.appendChild(item);
            queueUploadDateLookup(video);
        }

        const count = displayedResultURLs.size;
        const exportButton = document.getElementById('YT_SEARCH_EXPORT_HTML_V11');
        if (exportButton) {
            exportButton.textContent = '⬇ Export HTML (' + count + ')';
            exportButton.disabled = count === 0;
            exportButton.style.opacity = count === 0 ? '0.55' : '1';
        }
        info.textContent = '"' + currentKeyword + '" — ' + count +
            ' result(s) from ' + scannedCount + ' video(s) checked' +
            (scanFinished ? ' — scan complete' : ' — scanning; results appear as found');

        if (count === 0) {
            empty.textContent = scanFinished
                ? '❌ No video title contains "' + currentKeyword + '".'
                : '🔎 Scanning… the first matching title will appear here.';
        } else if (empty) {
            empty.remove();
        }
    }

    // =========================================================
    // INITIALIZE
    // =========================================================

    loadSavedSearch();

    setTimeout(
        createTool,
        1000
    );

    setTimeout(
        createTool,
        3000
    );

    // =========================================================
    // AUTOMATIC CONTINUATION AFTER CHANNEL NAVIGATION
    // =========================================================

    setTimeout(
        function () {

            const savedChannel = cleanChannel(currentChannel);
            const route = window.location.pathname.replace(/\/$/, '');
            const routeMatch = route.match(/^\/@([^/]+)\/videos$/i);
            let routeChannel = routeMatch ? routeMatch[1] : '';
            try {
                routeChannel = decodeURIComponent(routeChannel);
            } catch (e) {}

            if (
                shouldAutoStart() &&
                routeChannel &&
                normalize(routeChannel) === normalize(savedChannel)
            ) {
                console.log('Auto-starting channel scan');
                scanChannel();
            }

        },
        3500
    );

})();
