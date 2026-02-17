#!/usr/bin/env node
/**
 * Migration: Phase D — Add cross-cutting legal topics.
 *
 * Adds beach/foreshore, rivers/waterways, reporting, exporting, insurance,
 * and ethics sections as national content for each supported country.
 *
 * Run with: node migrations/add-crosscutting-legal-content.js
 * On production: node migrations/add-crosscutting-legal-content.js --db data/tracker.db
 */
'use strict';

var path = require('path');
var Database = require('better-sqlite3');

var dbPath = path.join(__dirname, '..', 'data', 'tracker.db');
var args = process.argv.slice(2);
for (var i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
        dbPath = path.resolve(args[i + 1]);
    }
}

console.log('Using database:', dbPath);
var db = new Database(dbPath);

var insertLegal = db.prepare(
    'INSERT OR IGNORE INTO legal_content (country_code, region_code, language, section_key, section_title, content_html, severity, sort_order, source_url, last_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

var inserted = 0;

var txn = db.transaction(function () {

    // =================================================================
    // US — Cross-Cutting National Topics
    // =================================================================

    inserted += insertLegal.run('US', null, 'en', 'beach_foreshore_us', 'Beach & Foreshore Detecting',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Beach detecting rules vary by <strong>ownership of the beach</strong> — public, state, federal, or private</li>' +
        '<li><strong>Dry sand</strong> (above high tide line) is often municipal or private — check local ordinances</li>' +
        '<li><strong>Wet sand</strong> (intertidal zone) is generally public but varies by state</li>' +
        '<li>National seashores (e.g., Cape Cod, Padre Island) are <strong>federal land — ARPA applies</strong></li>' +
        '<li>State beaches may prohibit detecting — check with the state parks department</li>' +
        '<li>Shipwreck artifacts are protected under the <strong>Abandoned Shipwreck Act of 1987</strong></li>' +
        '<li>Popular beach detecting states include Florida, New Jersey, California, and the Carolinas</li>' +
        '<li>After storms and high tides is often the best time for beach detecting</li>' +
        '</ul></div>', 'caution', 95,
        'https://www.nps.gov/subjects/archeology/abandoned-shipwreck-act.htm',
        '2025-01-15').changes;

    inserted += insertLegal.run('US', null, 'en', 'rivers_waterways_us', 'River & Waterway Detecting',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Navigable waterways are generally public, but <strong>definitions of "navigable" vary by state</strong></li>' +
        '<li>Riverbeds may be public (state-owned) or private depending on the state</li>' +
        '<li>States like Montana and Utah grant public access to streambeds below the high-water mark</li>' +
        '<li>States like Colorado consider riverbeds private property even if the water is navigable</li>' +
        '<li>ARPA applies on federal waterways (Army Corps of Engineers managed land, federal reservoirs)</li>' +
        '<li>Gold panning in rivers is popular and often permitted — check for mining claim restrictions</li>' +
        '<li>Underwater detecting may require specific permits in some states</li>' +
        '<li>Never detect on dam structures, levees, or Army Corps of Engineers facilities</li>' +
        '</ul></div>', 'caution', 96,
        null,
        '2025-01-15').changes;

    inserted += insertLegal.run('US', null, 'en', 'reporting_finds_us', 'Reporting Significant Finds',
        '<div class="legal-card legal-ok"><ul>' +
        '<li>On <strong>private land</strong>, there is generally no legal requirement to report finds (but it\'s good practice)</li>' +
        '<li>On <strong>public land</strong>, significant finds should be reported to the land management agency</li>' +
        '<li>If you discover <strong>human remains</strong>, <strong>stop immediately</strong> and contact local law enforcement — this is required by law in all states</li>' +
        '<li>Native American artifacts and burial items are protected under <strong>NAGPRA</strong> on federal and tribal land</li>' +
        '<li>Many states have a State Archaeologist or State Historic Preservation Officer (SHPO) who welcomes reports</li>' +
        '<li>Consider reporting significant historical finds to local historical societies or museums</li>' +
        '<li>Documenting and photographing finds in situ (before removal) adds historical value</li>' +
        '</ul></div>', 'ok', 97,
        'https://www.nps.gov/subjects/nagpra/index.htm https://www.nps.gov/subjects/archeology/state-archeologists.htm',
        '2025-01-15').changes;

    // =================================================================
    // GB — Cross-Cutting National Topics
    // =================================================================

    inserted += insertLegal.run('GB', null, 'en', 'beach_foreshore_gb', 'Beach & Foreshore Detecting',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>The foreshore (between mean high and low water) is mostly owned by the <strong>Crown Estate</strong></li>' +
        '<li>The Crown Estate generally permits metal detecting on its foreshore for personal recreation</li>' +
        '<li>Some foreshore areas are leased to local authorities or private owners — check locally</li>' +
        '<li>Finds from the foreshore are still subject to the <strong>Treasure Act 1996</strong></li>' +
        '<li>Shipwreck material is protected under the <strong>Merchant Shipping Act 1995</strong> — report to the Receiver of Wreck</li>' +
        '<li>Protected wreck sites (designated under the Protection of Wrecks Act 1973) are strictly off-limits</li>' +
        '<li>Beach detecting is popular in Norfolk, Suffolk, Essex, Kent, and Devon</li>' +
        '<li>Scheduled Monuments on the foreshore have the same protections as inland sites</li>' +
        '</ul></div>', 'caution', 50,
        'https://www.thecrownestate.co.uk/our-business/marine https://www.gov.uk/report-wreck-material',
        '2025-01-15').changes;

    inserted += insertLegal.run('GB', null, 'en', 'exporting_finds_gb', 'Exporting Finds from the UK',
        '<div class="legal-card legal-warning"><ul>' +
        '<li>Objects over <strong>50 years old</strong> and valued above certain thresholds require an <strong>export licence</strong></li>' +
        '<li>The Arts Council England (Reviewing Committee on the Export of Works of Art) administers export controls</li>' +
        '<li>Treasure items cannot be exported until the Treasure process is complete and items are disclaimed</li>' +
        '<li>Items designated as being of national importance may be subject to a <strong>temporary export bar</strong> to allow a UK museum to raise funds to acquire them</li>' +
        '<li>This applies to selling to overseas buyers as well as personally taking items abroad</li>' +
        '<li>Archaeological objects from Scotland must also clear the Treasure Trove process before export</li>' +
        '<li>Penalties for illegal export include fines and seizure of objects</li>' +
        '</ul></div>', 'warning', 60,
        'https://www.artscouncil.org.uk/supporting-collections-and-cultural-property/export-controls https://www.legislation.gov.uk/ukpga/2003/6/contents',
        '2025-01-15').changes;

    inserted += insertLegal.run('GB', null, 'en', 'insurance_liability_gb', 'Insurance & Liability',
        '<div class="legal-card legal-ok"><ul>' +
        '<li><strong>Public liability insurance</strong> is strongly recommended for all metal detectorists</li>' +
        '<li>Both the <strong>NCMD</strong> and <strong>FID</strong> (Federation of Independent Detectorists) offer membership that includes public liability insurance</li>' +
        '<li>Insurance typically covers up to &pound;5-10 million for accidental damage to property or injury to third parties</li>' +
        '<li>Many landowners now require proof of insurance before granting permission</li>' +
        '<li>Organised detecting rallies typically require all participants to have insurance</li>' +
        '<li>Insurance does not cover intentional damage, trespass, or detecting on restricted sites</li>' +
        '<li>Some policies also include cover for personal accident and equipment</li>' +
        '</ul></div>', 'ok', 70,
        'https://www.ncmd.co.uk/ https://www.fid.org.uk/',
        '2025-01-15').changes;

    // =================================================================
    // AU — Cross-Cutting National Topics
    // =================================================================

    inserted += insertLegal.run('AU', null, 'en', 'beach_foreshore_au', 'Beach & Foreshore Detecting',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Beach access and detecting rules vary by <strong>state and local council</strong></li>' +
        '<li>Most beaches are managed by local councils — check their bylaws</li>' +
        '<li>Beaches within national parks or marine parks are <strong>off-limits</strong></li>' +
        '<li>Aboriginal heritage sites on beaches are strictly protected</li>' +
        '<li>Shipwreck artifacts are protected under the <strong>Historic Shipwrecks Act 1976</strong> (federal) and state equivalents</li>' +
        '<li>Protected zones around historic shipwrecks extend to 200 metres — detecting prohibited within these zones</li>' +
        '<li>Popular beach detecting areas include Gold Coast (QLD), Bondi (NSW), and St Kilda (VIC)</li>' +
        '<li>After storms and king tides is the best time for beach detecting</li>' +
        '</ul></div>', 'caution', 40,
        'https://www.dcceew.gov.au/parks-heritage/heritage/historic-shipwrecks',
        '2025-01-15').changes;

    inserted += insertLegal.run('AU', null, 'en', 'reporting_finds_au', 'Reporting Significant Finds',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Requirements to report finds vary by state — check your state\'s heritage legislation</li>' +
        '<li><strong>Aboriginal heritage objects</strong> must be reported to the relevant state authority in all states</li>' +
        '<li>Disturbing Aboriginal heritage items without authorisation is a <strong>criminal offence</strong> with severe penalties</li>' +
        '<li>Items that may be from <strong>shipwrecks</strong> must be reported under the Historic Shipwrecks Act</li>' +
        '<li>Gold nuggets found on Crown land must generally be declared under the terms of your Miner\'s Right or licence</li>' +
        '<li>If you find <strong>human remains</strong>, stop immediately and contact police</li>' +
        '<li>Consider reporting significant finds to your state museum or heritage council</li>' +
        '</ul></div>', 'caution', 50,
        'https://www.dcceew.gov.au/parks-heritage/heritage',
        '2025-01-15').changes;

    inserted += insertLegal.run('AU', null, 'en', 'ethics_au', 'Code of Conduct & Ethics',
        '<div class="legal-card legal-ok"><ul>' +
        '<li><strong>Always get permission</strong> before detecting on any land — verbal or written</li>' +
        '<li><strong>Fill all holes</strong> and leave the ground as you found it</li>' +
        '<li>Respect Aboriginal and Torres Strait Islander cultural heritage at all times</li>' +
        '<li>Pack out all rubbish — leave sites cleaner than you found them</li>' +
        '<li>Report significant finds to relevant authorities</li>' +
        '<li>Respect the bush — do not damage vegetation, disturb wildlife, or light fires</li>' +
        '<li>Join a local detecting club — they promote responsible practices and often organise group permissions</li>' +
        '<li>The <strong>Australian Metal Detecting Community</strong> promotes ethical detecting practices</li>' +
        '</ul></div>', 'ok', 60,
        null,
        '2025-01-15').changes;

    // =================================================================
    // CA — Cross-Cutting National Topics
    // =================================================================

    inserted += insertLegal.run('CA', null, 'en', 'beach_foreshore_ca', 'Beach & Foreshore Detecting',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Beach access and detecting rules vary by <strong>province and municipality</strong></li>' +
        '<li>Federal Crown foreshore is managed by the Department of Fisheries and Oceans — detecting may be restricted</li>' +
        '<li>Provincial and municipal beaches have their own rules — check local bylaws</li>' +
        '<li>Beaches within national or provincial parks are <strong>off-limits</strong></li>' +
        '<li>Shipwreck artifacts in Canadian waters are protected under the <strong>Canada Shipping Act</strong></li>' +
        '<li>Receiver of Wreck must be notified of any wreck material found</li>' +
        '<li>Popular beach detecting areas include the Maritimes, Great Lakes shoreline, and BC coast</li>' +
        '<li>First Nations cultural sites along coastlines are strictly protected</li>' +
        '</ul></div>', 'caution', 30,
        'https://laws-lois.justice.gc.ca/eng/acts/c-10.15/',
        '2025-01-15').changes;

    inserted += insertLegal.run('CA', null, 'en', 'reporting_finds_ca', 'Reporting Significant Finds',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Reporting requirements vary by province — check your provincial heritage legislation</li>' +
        '<li><strong>First Nations heritage objects</strong> must be reported to the relevant authority in all provinces</li>' +
        '<li>Disturbing First Nations heritage sites is a <strong>criminal offence</strong> under both federal and provincial law</li>' +
        '<li>Shipwreck material must be reported to the <strong>Receiver of Wreck</strong></li>' +
        '<li>If you find <strong>human remains</strong>, stop immediately and contact local police</li>' +
        '<li>Provincial archaeologists or heritage offices generally welcome reports of significant finds</li>' +
        '<li>Documenting and photographing finds in context adds historical value</li>' +
        '</ul></div>', 'caution', 40,
        'https://parks.canada.ca/ https://laws-lois.justice.gc.ca/eng/acts/h-4/',
        '2025-01-15').changes;

    inserted += insertLegal.run('CA', null, 'en', 'ethics_ca', 'Code of Conduct & Ethics',
        '<div class="legal-card legal-ok"><ul>' +
        '<li><strong>Always get permission</strong> before detecting on any land</li>' +
        '<li><strong>Fill all holes</strong> and leave the ground as you found it or better</li>' +
        '<li>Respect First Nations cultural heritage and sacred sites</li>' +
        '<li>Pack out all rubbish and junk targets</li>' +
        '<li>Follow all provincial park and conservation area rules</li>' +
        '<li>Report significant finds to local heritage authorities</li>' +
        '<li>Join the <strong>Canadian Metal Detecting community</strong> — local clubs promote responsible practices</li>' +
        '<li>Carry written permission when detecting on private land</li>' +
        '<li>Close gates, respect crops and livestock, and leave property as you found it</li>' +
        '</ul></div>', 'ok', 50,
        null,
        '2025-01-15').changes;

    // =================================================================
    // NZ — Cross-Cutting National Topics
    // =================================================================

    inserted += insertLegal.run('NZ', null, 'en', 'beach_foreshore_nz', 'Beach & Foreshore Detecting',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Most New Zealand beaches are <strong>public</strong> — the foreshore is generally Crown-owned</li>' +
        '<li>Beach detecting is one of the most popular forms of metal detecting in New Zealand</li>' +
        '<li>Beaches within DOC reserves or national parks are <strong>off-limits</strong></li>' +
        '<li>M\u0101ori cultural sites along the coast (middens, p\u0101 sites, w\u0101hi tapu) are <strong>strictly protected</strong></li>' +
        '<li>Shipwreck material is protected — report to Heritage New Zealand or Maritime New Zealand</li>' +
        '<li>Local council bylaws may restrict detecting on specific beaches</li>' +
        '<li>Popular beach detecting areas include Auckland beaches, Bay of Plenty, and Christchurch coast</li>' +
        '<li>Do not dig in sand dunes or disturb coastal vegetation</li>' +
        '</ul></div>', 'caution', 40,
        'https://www.doc.govt.nz/ https://www.heritage.org.nz/',
        '2025-01-15').changes;

    inserted += insertLegal.run('NZ', null, 'en', 'reporting_finds_nz', 'Reporting Finds',
        '<div class="legal-card legal-warning"><ul>' +
        '<li>All <strong>pre-1900 archaeological sites and objects</strong> are automatically protected under the Heritage New Zealand Pouhere Taonga Act 2014</li>' +
        '<li>Disturbing any archaeological site without authority from Heritage New Zealand is an <strong>offence</strong></li>' +
        '<li>If you find anything that appears to be pre-1900, <strong>stop and report</strong> to Heritage New Zealand</li>' +
        '<li>M\u0101ori cultural objects (taonga) must be reported — they may be subject to specific cultural protocols</li>' +
        '<li>If you find <strong>human remains</strong> (k\u014Diwi tangata), stop immediately and contact police — do not disturb the area</li>' +
        '<li>Shipwreck material must be reported to Maritime New Zealand</li>' +
        '<li>Heritage New Zealand maintains the <strong>New Zealand Heritage List</strong> — check it for known sites</li>' +
        '</ul></div>', 'warning', 50,
        'https://www.heritage.org.nz/ https://www.legislation.govt.nz/act/public/2014/0026/latest/whole.html',
        '2025-01-15').changes;

    inserted += insertLegal.run('NZ', null, 'en', 'ethics_nz', 'Code of Conduct & Ethics',
        '<div class="legal-card legal-ok"><ul>' +
        '<li><strong>Always get permission</strong> before detecting on any land — private or public</li>' +
        '<li><strong>Fill all holes</strong> and leave the ground as you found it</li>' +
        '<li>Respect M\u0101ori cultural heritage, w\u0101hi tapu, and k\u014Diwi tangata at all times</li>' +
        '<li>If in doubt about a find\'s age or significance, report it</li>' +
        '<li>Pack out all rubbish and leave detecting sites cleaner than you found them</li>' +
        '<li>Do not detect on DOC conservation land, even if there are no signs</li>' +
        '<li>Join the <strong>New Zealand Metal Detecting community</strong> for guidance and group permissions</li>' +
        '<li>Follow the principle of <strong>kaitiakitanga</strong> (guardianship) — care for the land and its heritage</li>' +
        '</ul></div>', 'ok', 60,
        'https://www.heritage.org.nz/ https://www.doc.govt.nz/',
        '2025-01-15').changes;

});

txn();
console.log('Inserted ' + inserted + ' new cross-cutting legal content rows.');
db.close();
