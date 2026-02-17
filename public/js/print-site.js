/**
 * Print Site Report logic
 * Generates a printable site information page with map, details, and finds.
 */
(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        Auth.requireAuth().then(() => {
            loadSiteReport();
        });
    });

    async function loadSiteReport() {
        const params = new URLSearchParams(window.location.search);
        const siteId = params.get('siteId');

        if (!siteId) {
            document.getElementById('report-content').innerHTML =
                '<p class="error-text">No site ID specified. Please access this page from the Sites page.</p>';
            return;
        }

        // Set report date
        const today = new Date();
        document.getElementById('report-date').textContent =
            'Generated: ' + today.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            });

        try {
            // Fetch site data
            const siteRes = await Auth.authedFetch('/api/sites/' + siteId);
            if (!siteRes.ok) throw new Error('Failed to fetch site');
            const siteJson = await siteRes.json();
            const site = siteJson.data;

            // Fetch finds for this site
            const findsRes = await Auth.authedFetch('/api/finds?site_id=' + siteId);
            const findsJson = findsRes.ok ? await findsRes.json() : { data: [] };
            const finds = findsJson.data || [];

            renderReport(site, finds);
        } catch (err) {
            console.error('Error loading site report:', err);
            document.getElementById('report-content').innerHTML =
                '<p class="error-text">Failed to load site data: ' + escapeHtml(err.message) + '</p>';
        }
    }

    function renderReport(site, finds) {
        const esc = escapeHtml;

        // Title
        document.getElementById('report-title').textContent = site.name || 'Site Report';
        document.title = 'Site Report - ' + (site.name || 'Unknown');

        // Overview
        document.getElementById('rpt-name').textContent = site.name || '-';
        document.getElementById('rpt-status').textContent = formatStatus(site.status || site.site_status);
        document.getElementById('rpt-priority').textContent = site.priority ? '\u2605'.repeat(site.priority) + '\u2606'.repeat(5 - site.priority) : '-';
        document.getElementById('rpt-land-type').textContent = formatLandType(site.land_type);
        document.getElementById('rpt-coords').textContent =
            site.latitude && site.longitude
                ? parseFloat(site.latitude).toFixed(6) + ', ' + parseFloat(site.longitude).toFixed(6)
                : '-';
        document.getElementById('rpt-perm-status').textContent = formatPermStatus(site.permission_status);

        // Image
        if (site.image_url) {
            document.getElementById('rpt-image').src = Auth.secureUrl(site.image_url);
            document.getElementById('section-image').style.display = '';
        }

        // Map
        if (site.latitude && site.longitude) {
            setTimeout(() => {
                const map = L.map('rpt-map', {
                    zoomControl: false,
                    attributionControl: false,
                    dragging: false,
                    scrollWheelZoom: false,
                    doubleClickZoom: false,
                });

                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

                const lat = parseFloat(site.latitude);
                const lng = parseFloat(site.longitude);
                map.setView([lat, lng], 15);
                L.marker([lat, lng]).addTo(map);

                // Add satellite layer
                L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    opacity: 0.5,
                }).addTo(map);

                // Force map to render for print
                setTimeout(() => map.invalidateSize(), 200);
            }, 100);
        } else {
            document.getElementById('section-map').style.display = 'none';
        }

        // Description
        document.getElementById('rpt-description').textContent = site.description || 'No description provided.';

        // Notes
        if (site.notes) {
            document.getElementById('rpt-notes').textContent = site.notes;
            document.getElementById('section-notes').style.display = '';
        }

        // Legal notes
        if (site.legal_notes) {
            document.getElementById('rpt-legal-notes').textContent = site.legal_notes;
            document.getElementById('section-legal').style.display = '';
        }

        // Contact info
        const hasContact = site.contact_name || site.permission_contact_name ||
                           site.contact_phone || site.permission_contact_phone ||
                           site.contact_email || site.permission_contact_email;
        if (hasContact) {
            document.getElementById('rpt-contact-name').textContent =
                site.contact_name || site.permission_contact_name || '-';
            document.getElementById('rpt-contact-phone').textContent =
                site.contact_phone || site.permission_contact_phone || '-';
            document.getElementById('rpt-contact-email').textContent =
                site.contact_email || site.permission_contact_email || '-';
            document.getElementById('section-contact').style.display = '';
        }

        // Tags
        if (site.tags) {
            const tagsArr = site.tags.split(',').map(t => t.trim()).filter(Boolean);
            if (tagsArr.length > 0) {
                document.getElementById('rpt-tags').innerHTML = tagsArr
                    .map(t => '<span class="badge">' + esc(t) + '</span>')
                    .join(' ');
                document.getElementById('section-tags').style.display = '';
            }
        }

        // Finds
        renderFinds(finds);
    }

    function renderFinds(finds) {
        const container = document.getElementById('rpt-finds-list');
        const esc = escapeHtml;

        if (!finds || finds.length === 0) {
            container.innerHTML = '<p class="empty-text">No finds recorded at this site.</p>';
            return;
        }

        let html = '<table class="admin-table print-finds-table">' +
            '<thead><tr>' +
            '<th>Date</th><th>Description</th><th>Material</th>' +
            '<th>Depth</th><th>Condition</th><th>Value</th>' +
            '</tr></thead><tbody>';

        finds.forEach(f => {
            const dateStr = f.date || f.date_found
                ? new Date(f.date || f.date_found).toLocaleDateString()
                : '-';
            const depth = f.depth_cm != null
                ? (window.AppConfig ? AppConfig.formatDepth(f.depth_cm) : f.depth_cm + ' cm')
                : (f.depth || f.depth_inches ? (f.depth || f.depth_inches) + '"' : '-');
            const value = f.value_estimate ? '$' + parseFloat(f.value_estimate).toFixed(2) : '-';

            html += '<tr>' +
                '<td>' + esc(dateStr) + '</td>' +
                '<td>' + esc(f.description || '-') + '</td>' +
                '<td>' + esc(f.material || '-') + '</td>' +
                '<td>' + esc(depth) + '</td>' +
                '<td>' + esc(f.condition || '-') + '</td>' +
                '<td>' + esc(value) + '</td>' +
                '</tr>';
        });

        html += '</tbody></table>';
        html += '<p class="print-finds-summary">Total finds: ' + finds.length + '</p>';

        container.innerHTML = html;
    }

    /* ------------------------------------------------------------------ */
    /*  Formatters                                                        */
    /* ------------------------------------------------------------------ */
    function formatStatus(status) {
        const map = {
            identified: 'Identified',
            scouted: 'Scouted',
            detecting: 'Detecting',
            exhausted: 'Exhausted',
        };
        return map[status] || status || '-';
    }

    function formatLandType(type) {
        if (window.AppConfig) return AppConfig.landTypeLabel(type);
        // Fallback if config not loaded
        var fallback = {
            private: 'Private',
            blm: 'BLM (Bureau of Land Management)',
            national_grassland: 'National Grassland',
            state_trust: 'State Trust Land',
            state_park: 'State Park',
            usfs: 'USFS (Forest Service)',
            county: 'County',
            municipal: 'Municipal',
            unknown: 'Unknown',
        };
        return fallback[type] || type || '-';
    }

    function formatPermStatus(status) {
        const map = {
            not_required: 'Not Required',
            not_requested: 'Not Requested',
            requested: 'Requested',
            granted: 'Granted',
            denied: 'Denied',
        };
        return map[status] || status || '-';
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(str)));
        return div.innerHTML;
    }
})();
