#!/usr/bin/env node
/**
 * Migration: Expand legal content.
 *
 * Phase 1: Canada — add missing provinces/territories (MB, SK, NS, NB, PE, NL, YT, NT, NU)
 * Phase 2: New Zealand — add regional content (OTA, WTC, CAN, AUK, BOP, STL)
 * Phase 3: Great Britain — deepen regional content (additional sections for ENG, SCT, WLS, NIR)
 *
 * Run with: node migrations/expand-legal-content.js
 * On production: node migrations/expand-legal-content.js --db data/tracker.db
 */
'use strict';

var path = require('path');
var Database = require('better-sqlite3');

// Allow specifying DB path via --db flag or default to data/tracker.db
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
    // PHASE 1 — CANADA: Missing Provinces & Territories
    // =================================================================

    // Manitoba (MB)
    inserted += insertLegal.run('CA', 'MB', 'en', 'detecting_mb', 'Detecting in Manitoba',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>The Heritage Resources Act protects archaeological sites and objects</li>' +
        '<li>Provincial parks and heritage sites prohibit metal detecting</li>' +
        '<li>Private land with landowner permission is the primary option</li>' +
        '<li>Crown land detecting may require permission from the provincial government</li>' +
        '<li>First Nations heritage sites are strictly protected</li>' +
        '<li>Report significant historical finds to the Historic Resources Branch</li>' +
        '</ul></div>', 'caution', 10,
        'https://www.gov.mb.ca/chc/hrb/ https://www.gov.mb.ca/sd/parks/',
        '2025-01-15').changes;

    inserted += insertLegal.run('CA', 'MB', 'en', 'crown_land_mb', 'Manitoba Crown Land',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Manitoba has extensive Crown land, particularly in the north</li>' +
        '<li>Detecting on Crown land may require authorization from Manitoba Conservation</li>' +
        '<li>Wildlife Management Areas have additional restrictions</li>' +
        '<li>Gold prospecting is not a major activity in Manitoba</li>' +
        '<li>Always check for active mining claims or permits in the area</li>' +
        '</ul></div>', 'caution', 20,
        'https://www.gov.mb.ca/sd/parks/',
        '2025-01-15').changes;

    // Saskatchewan (SK)
    inserted += insertLegal.run('CA', 'SK', 'en', 'detecting_sk', 'Detecting in Saskatchewan',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>The Heritage Property Act protects archaeological sites and objects</li>' +
        '<li>Provincial parks prohibit metal detecting</li>' +
        '<li>Private land with landowner permission is the safest option</li>' +
        '<li>Crown land rules vary — check with the Ministry of Parks, Culture and Sport</li>' +
        '<li>First Nations heritage sites are protected under provincial and federal law</li>' +
        '<li>Saskatchewan\'s prairie history offers potential for homestead and settlement-era finds</li>' +
        '</ul></div>', 'caution', 10,
        'https://www.saskatchewan.ca/residents/parks-culture-heritage/heritage-conservation https://www.tourismsaskatchewan.com/provincial-parks',
        '2025-01-15').changes;

    inserted += insertLegal.run('CA', 'SK', 'en', 'crown_land_sk', 'Saskatchewan Crown Land',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Saskatchewan has significant Crown land in the northern regions</li>' +
        '<li>Southern agricultural Crown land is often leased to farmers — get leaseholder permission</li>' +
        '<li>Provincial forests and grasslands have their own regulations</li>' +
        '<li>Surface Rights Board may be relevant for Crown land access issues</li>' +
        '</ul></div>', 'caution', 20,
        'https://www.saskatchewan.ca/residents/parks-culture-heritage',
        '2025-01-15').changes;

    // Nova Scotia (NS)
    inserted += insertLegal.run('CA', 'NS', 'en', 'detecting_ns', 'Detecting in Nova Scotia',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>The Special Places Protection Act covers archaeological sites and objects</li>' +
        '<li>Heritage research permits are required for any archaeological work</li>' +
        '<li>Provincial parks prohibit metal detecting</li>' +
        '<li>Private land with landowner permission is the primary option</li>' +
        '<li>Rich maritime and colonial history — many potential sites from the 1600s onward</li>' +
        '<li>Oak Island and treasure hunting have a long history in the province</li>' +
        '<li>Beach detecting is popular but foreshore ownership varies</li>' +
        '</ul></div>', 'caution', 10,
        'https://cch.novascotia.ca/exploring-our-past/heritage https://parks.novascotia.ca/',
        '2025-01-15').changes;

    inserted += insertLegal.run('CA', 'NS', 'en', 'beaches_ns', 'Nova Scotia Beaches & Foreshore',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Beach detecting is popular along Nova Scotia\'s extensive coastline</li>' +
        '<li>Provincial beaches may have restrictions — check with Parks Nova Scotia</li>' +
        '<li>Foreshore (tidal zone) is generally Crown land</li>' +
        '<li>Shipwreck artifacts are protected under federal and provincial law</li>' +
        '<li>Report any finds that may be from shipwrecks to the Receiver of Wreck</li>' +
        '</ul></div>', 'caution', 20,
        'https://parks.novascotia.ca/ https://cch.novascotia.ca/',
        '2025-01-15').changes;

    // New Brunswick (NB)
    inserted += insertLegal.run('CA', 'NB', 'en', 'detecting_nb', 'Detecting in New Brunswick',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>The Heritage Conservation Act protects archaeological sites</li>' +
        '<li>Archaeological permits are required for excavation or systematic survey</li>' +
        '<li>Provincial parks prohibit metal detecting</li>' +
        '<li>Private land with landowner permission is the safest option</li>' +
        '<li>Crown land (about 50% of province) — check with the Department of Natural Resources</li>' +
        '<li>Bilingual province with rich Acadian and Loyalist history</li>' +
        '<li>Beach detecting popular along the Bay of Fundy coast</li>' +
        '</ul></div>', 'caution', 10,
        'https://www2.gnb.ca/content/gnb/en/departments/thc/heritage.html https://www.tourismnewbrunswick.ca/provincial-parks',
        '2025-01-15').changes;

    // Prince Edward Island (PE)
    inserted += insertLegal.run('CA', 'PE', 'en', 'detecting_pe', 'Detecting in Prince Edward Island',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>The Archaeological Sites Protection Act protects known archaeological sites</li>' +
        '<li>Provincial parks prohibit metal detecting</li>' +
        '<li>Private land with landowner permission is the primary option</li>' +
        '<li>PEI is small but has significant colonial and Mi\'kmaq heritage</li>' +
        '<li>Beach detecting is popular — PEI has extensive sandy beaches</li>' +
        '<li>Respect protected areas and National Historic Sites (e.g., Province House)</li>' +
        '</ul></div>', 'caution', 10,
        'https://www.princeedwardisland.ca/en/topic/heritage-places https://www.tourismpei.com/provincial-parks',
        '2025-01-15').changes;

    // Newfoundland and Labrador (NL)
    inserted += insertLegal.run('CA', 'NL', 'en', 'detecting_nl', 'Detecting in Newfoundland and Labrador',
        '<div class="legal-card legal-warning"><ul>' +
        '<li>The Historic Resources Act provides strong protection for archaeological sites</li>' +
        '<li>All archaeological objects found on Crown land belong to the province</li>' +
        '<li>Provincial parks and protected areas strictly prohibit detecting</li>' +
        '<li>Private land with landowner permission is the safest option</li>' +
        '<li>Viking, Basque, and early colonial sites are heavily protected</li>' +
        '<li>L\'Anse aux Meadows and Red Bay are UNESCO World Heritage Sites — strictly off-limits</li>' +
        '<li>Report any significant finds to the Provincial Archaeology Office</li>' +
        '</ul></div>', 'warning', 10,
        'https://www.gov.nl.ca/tcar/archaeology/ https://www.gov.nl.ca/tcar/parks/',
        '2025-01-15').changes;

    inserted += insertLegal.run('CA', 'NL', 'en', 'heritage_nl', 'Newfoundland Heritage Sites',
        '<div class="legal-card legal-danger"><ul>' +
        '<li>Newfoundland has some of the oldest European settlement sites in North America</li>' +
        '<li>UNESCO sites (L\'Anse aux Meadows, Red Bay) are strictly protected — no detecting</li>' +
        '<li>Numerous designated Provincial Historic Sites throughout the province</li>' +
        '<li>Indigenous heritage sites (Innu, Inuit, Mi\'kmaq, Beothuk) are strictly protected</li>' +
        '<li>Signal Hill, Cape Spear, and other national historic sites are federal land — prohibited</li>' +
        '</ul></div>', 'danger', 20,
        'https://www.gov.nl.ca/tcar/archaeology/ https://www.heritage.nf.ca/',
        '2025-01-15').changes;

    // Yukon (YT)
    inserted += insertLegal.run('CA', 'YT', 'en', 'detecting_yt', 'Detecting in Yukon',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>The Historic Resources Act protects archaeological sites and objects</li>' +
        '<li>Territorial parks and heritage sites prohibit metal detecting</li>' +
        '<li>First Nations Final Agreement lands require permission from the relevant First Nation</li>' +
        '<li>Crown land detecting may be possible — check with Yukon Heritage Resources</li>' +
        '<li>Klondike Gold Rush history makes the territory attractive for prospectors</li>' +
        '<li>Gold panning and small-scale prospecting are popular activities</li>' +
        '<li>Placer mining claims are common — do not detect on active claims without permission</li>' +
        '</ul></div>', 'caution', 10,
        'https://yukon.ca/en/science-and-natural-resources/archaeology https://yukon.ca/en/outdoor-recreation-and-wildlife/parks',
        '2025-01-15').changes;

    inserted += insertLegal.run('CA', 'YT', 'en', 'gold_prospecting_yt', 'Yukon Gold Prospecting',
        '<div class="legal-card legal-ok"><ul>' +
        '<li>Recreational gold panning is permitted on most Crown land streams and rivers</li>' +
        '<li>Dawson City and the Klondike region are the most popular prospecting areas</li>' +
        '<li>A free miner\'s certificate may be required for more intensive prospecting</li>' +
        '<li>Must respect active mining claims — check the Yukon Mining Recorder</li>' +
        '<li>Metal detectors are commonly used for gold nugget hunting</li>' +
        '<li>Remote areas require bear safety awareness and preparation</li>' +
        '</ul></div>', 'ok', 20,
        'https://yukon.ca/en/science-and-natural-resources/mining https://yukon.ca/en/doing-business/licensing/apply-free-miners-certificate',
        '2025-01-15').changes;

    // Northwest Territories (NT)
    inserted += insertLegal.run('CA', 'NT', 'en', 'detecting_nt', 'Detecting in Northwest Territories',
        '<div class="legal-card legal-warning"><ul>' +
        '<li>The Archaeological Sites Regulations protect archaeological sites and objects</li>' +
        '<li>NWT is largely unsettled — very limited detecting opportunities</li>' +
        '<li>Indigenous heritage sites are strictly protected</li>' +
        '<li>Territorial parks and protected areas prohibit detecting</li>' +
        '<li>Land claim settlement areas require permission from the relevant Indigenous government</li>' +
        '<li>Yellowknife area has some gold prospecting history</li>' +
        '<li>Extreme remoteness and climate make detecting impractical in most areas</li>' +
        '</ul></div>', 'warning', 10,
        'https://www.gov.nt.ca/en/services/archaeology-and-heritage https://www.nwtparks.ca/',
        '2025-01-15').changes;

    // Nunavut (NU)
    inserted += insertLegal.run('CA', 'NU', 'en', 'detecting_nu', 'Detecting in Nunavut',
        '<div class="legal-card legal-danger"><ul>' +
        '<li>The Nunavut Archaeological and Palaeontological Sites Regulations protect all sites</li>' +
        '<li>Inuit heritage is paramount — Inuit Impact and Benefit Agreements may apply</li>' +
        '<li>Virtually all land is subject to the Nunavut Land Claims Agreement</li>' +
        '<li>Permits required for any archaeological activity from the Government of Nunavut</li>' +
        '<li>No public road system — access is by air or sea only</li>' +
        '<li>Extreme climate makes metal detecting impractical for most of the year</li>' +
        '<li>Respect for Inuit cultural heritage is essential in all activities</li>' +
        '</ul></div>', 'danger', 10,
        'https://www.gov.nu.ca/culture-and-heritage https://nunavutparks.com/',
        '2025-01-15').changes;


    // =================================================================
    // PHASE 2 — NEW ZEALAND: Regional Content
    // =================================================================

    // Otago (OTA)
    inserted += insertLegal.run('NZ', 'OTA', 'en', 'detecting_ota', 'Detecting in Otago',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Otago is New Zealand\'s most popular region for gold prospecting with metal detectors</li>' +
        '<li>The historic goldfields around Arrowtown, Cromwell, and the Shotover River attract prospectors worldwide</li>' +
        '<li>DOC-managed conservation land prohibits detecting — check land status carefully</li>' +
        '<li>Private land with landowner permission is the safest option</li>' +
        '<li>Many pre-1900 gold mining sites are <strong>automatically protected</strong> archaeological sites</li>' +
        '<li>Heritage New Zealand authority required before disturbing any archaeological site</li>' +
        '</ul></div>', 'caution', 10,
        'https://www.doc.govt.nz/parks-and-recreation/places-to-go/otago/ https://www.heritage.org.nz/',
        '2025-01-15').changes;

    inserted += insertLegal.run('NZ', 'OTA', 'en', 'goldfields_ota', 'Otago Goldfields',
        '<div class="legal-card legal-warning"><ul>' +
        '<li>The Central Otago goldfields are a significant heritage landscape</li>' +
        '<li>Many sites from the 1860s gold rush are protected archaeological sites (pre-1900)</li>' +
        '<li>Chinese miners\' settlements are particularly significant heritage sites</li>' +
        '<li>Some areas are designated heritage precincts with additional protections</li>' +
        '<li>Recreational gold panning may be permitted in some rivers — check with the regional council</li>' +
        '<li>Always verify land status before detecting — much of Central Otago is a mix of DOC, Crown pastoral lease, and private land</li>' +
        '</ul></div>', 'warning', 20,
        'https://www.doc.govt.nz/parks-and-recreation/things-to-do/gold-panning/ https://www.heritage.org.nz/',
        '2025-01-15').changes;

    // West Coast (WTC)
    inserted += insertLegal.run('NZ', 'WTC', 'en', 'detecting_wtc', 'Detecting on the West Coast',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>The West Coast has a rich gold mining history dating from the 1860s</li>' +
        '<li>Large areas of DOC conservation land — detecting is <strong>prohibited</strong> on all DOC land</li>' +
        '<li>Private land with landowner permission is the primary option</li>' +
        '<li>Recreational gold panning is popular in rivers like the Grey, Buller, and their tributaries</li>' +
        '<li>Pre-1900 mining sites are protected archaeological sites — do not disturb</li>' +
        '<li>The West Coast is one of New Zealand\'s wettest regions — plan accordingly</li>' +
        '</ul></div>', 'caution', 10,
        'https://www.doc.govt.nz/parks-and-recreation/places-to-go/west-coast/ https://www.heritage.org.nz/',
        '2025-01-15').changes;

    inserted += insertLegal.run('NZ', 'WTC', 'en', 'goldfields_wtc', 'West Coast Goldfields',
        '<div class="legal-card legal-warning"><ul>' +
        '<li>Historic goldfields at Reefton, Ross, Greymouth, and Hokitika areas</li>' +
        '<li>Shantytown Heritage Park preserves gold rush history — detecting not permitted</li>' +
        '<li>Active mining operations exist — check for mining permits and licences in the area</li>' +
        '<li>Some rivers allow recreational gold panning under specific conditions</li>' +
        '<li>NZ Petroleum &amp; Minerals (NZP&amp;M) administers mineral permits on Crown land</li>' +
        '</ul></div>', 'warning', 20,
        'https://www.nzpam.govt.nz/ https://www.doc.govt.nz/parks-and-recreation/things-to-do/gold-panning/',
        '2025-01-15').changes;

    // Canterbury (CAN)
    inserted += insertLegal.run('NZ', 'CAN', 'en', 'detecting_can', 'Detecting in Canterbury',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Canterbury is New Zealand\'s largest region, with diverse detecting opportunities</li>' +
        '<li>Private farmland with permission is the primary option — Canterbury has extensive pastoral land</li>' +
        '<li>Christchurch and its surroundings have colonial-era history from the 1850s</li>' +
        '<li>Banks Peninsula has early whaling and colonial settlement sites — many are pre-1900 and protected</li>' +
        '<li>DOC land (including Arthur\'s Pass National Park) prohibits detecting</li>' +
        '<li>Beach detecting along the Canterbury coast is popular but check local council bylaws</li>' +
        '</ul></div>', 'caution', 10,
        'https://www.doc.govt.nz/parks-and-recreation/places-to-go/canterbury/ https://www.ecan.govt.nz/',
        '2025-01-15').changes;

    // Auckland (AUK)
    inserted += insertLegal.run('NZ', 'AUK', 'en', 'detecting_auk', 'Detecting in Auckland',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Auckland is New Zealand\'s largest city — many urban parks and beaches for detecting</li>' +
        '<li>Auckland Council manages parks and reserves — check bylaws for each location</li>' +
        '<li>Beach detecting is popular on west coast beaches (Piha, Muriwai) and east coast beaches</li>' +
        '<li>M\u0101ori heritage sites and p\u0101 sites are numerous and strictly protected</li>' +
        '<li>Volcanic cones (maunga) are sacred to Ng\u0101 Mana Whenua and are <strong>off-limits</strong></li>' +
        '<li>Regional parks may have specific rules — check with Auckland Council beforehand</li>' +
        '<li>Hauraki Gulf islands are largely DOC-managed — detecting prohibited</li>' +
        '</ul></div>', 'caution', 10,
        'https://www.aucklandcouncil.govt.nz/parks-recreation/ https://www.doc.govt.nz/',
        '2025-01-15').changes;

    inserted += insertLegal.run('NZ', 'AUK', 'en', 'beaches_auk', 'Auckland Beach Detecting',
        '<div class="legal-card legal-ok"><ul>' +
        '<li>Auckland\'s many beaches are among the most popular detecting locations in New Zealand</li>' +
        '<li>Wet sand detecting after storms can be particularly productive</li>' +
        '<li>Mission Bay, Takapuna, and Orewa are popular beach detecting spots</li>' +
        '<li>Check Auckland Council bylaws — some beaches may have seasonal restrictions</li>' +
        '<li>Do not dig on dunes or disturb protected coastal vegetation</li>' +
        '<li>Always fill holes and remove all trash — leave the beach cleaner than you found it</li>' +
        '</ul></div>', 'ok', 20,
        'https://www.aucklandcouncil.govt.nz/parks-recreation/',
        '2025-01-15').changes;

    // Bay of Plenty (BOP)
    inserted += insertLegal.run('NZ', 'BOP', 'en', 'detecting_bop', 'Detecting in Bay of Plenty',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Bay of Plenty has popular beach detecting along Tauranga, Mount Maunganui, and Whakatane</li>' +
        '<li>M\u0101ori heritage is very significant in this region — many p\u0101 and w\u0101hi tapu sites</li>' +
        '<li>Mauao (Mount Maunganui) is a significant cultural landmark — detecting prohibited</li>' +
        '<li>DOC-managed areas including Te Urewera are off-limits</li>' +
        '<li>Private land with landowner permission is the safest option for inland detecting</li>' +
        '<li>Beach detecting after summer tourist season can yield interesting modern finds</li>' +
        '</ul></div>', 'caution', 10,
        'https://www.doc.govt.nz/parks-and-recreation/places-to-go/bay-of-plenty/ https://www.boprc.govt.nz/',
        '2025-01-15').changes;

    // Southland (STL)
    inserted += insertLegal.run('NZ', 'STL', 'en', 'detecting_stl', 'Detecting in Southland',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>Southland has gold prospecting history, particularly around the Oreti River and surrounding areas</li>' +
        '<li>Fiordland National Park and other DOC land strictly prohibit detecting</li>' +
        '<li>Private farmland with permission is the primary detecting option</li>' +
        '<li>Stewart Island/Rakiura is largely DOC-managed — detecting prohibited</li>' +
        '<li>Early European settlement and whaling sites may be protected archaeological sites (pre-1900)</li>' +
        '<li>Invercargill and Bluff area have colonial-era history for potential detecting</li>' +
        '</ul></div>', 'caution', 10,
        'https://www.doc.govt.nz/parks-and-recreation/places-to-go/southland/ https://www.heritage.org.nz/',
        '2025-01-15').changes;


    // =================================================================
    // PHASE 3 — GREAT BRITAIN: Deepened Regional Content
    // =================================================================

    // --- England (ENG) — additional sections ---
    inserted += insertLegal.run('GB', 'ENG', 'en', 'code_of_practice_eng', 'Code of Practice for Responsible Metal Detecting',
        '<div class="legal-card legal-ok"><ul>' +
        '<li>The official <strong>Code of Practice for Responsible Metal Detecting in England and Wales</strong> was published by DCMS</li>' +
        '<li>Key principles: always get landowner permission, record finds with the PAS, report Treasure</li>' +
        '<li>Avoid Scheduled Monuments and other protected sites</li>' +
        '<li>Use a finds agreement with the landowner to clarify ownership and sharing of finds</li>' +
        '<li>Fill all holes, close gates, respect crops and livestock</li>' +
        '<li>The NCMD (National Council for Metal Detecting) promotes responsible detecting</li>' +
        '<li>Following the code helps protect the hobby and builds positive relationships with archaeologists</li>' +
        '</ul></div>', 'ok', 20,
        'https://www.gov.uk/government/publications/responsible-use-of-metal-detectors https://www.ncmd.co.uk/',
        '2025-01-15').changes;

    inserted += insertLegal.run('GB', 'ENG', 'en', 'popular_areas_eng', 'Popular Detecting Areas in England',
        '<div class="legal-card legal-ok"><ul>' +
        '<li><strong>Norfolk &amp; Suffolk</strong> — consistently the highest PAS find counts; rich Roman, Saxon, and Viking history</li>' +
        '<li><strong>Hampshire &amp; Wiltshire</strong> — Roman roads, settlements, and medieval sites throughout</li>' +
        '<li><strong>Kent</strong> — Anglo-Saxon finds, Roman villas, and WWII military sites</li>' +
        '<li><strong>Lincolnshire</strong> — prolific for Roman and medieval coins and artefacts</li>' +
        '<li><strong>Yorkshire</strong> — Viking heritage, monastic sites, and Civil War battlefields</li>' +
        '<li><strong>Essex</strong> — Iron Age, Roman, and Saxon finds common</li>' +
        '<li>Always check that specific sites are not Scheduled Monuments before detecting</li>' +
        '<li>Organised detecting rallies are popular — clubs often arrange permission on large estates</li>' +
        '</ul></div>', 'ok', 30,
        'https://finds.org.uk/ https://historicengland.org.uk/',
        '2025-01-15').changes;

    inserted += insertLegal.run('GB', 'ENG', 'en', 'scheduled_monuments_eng', 'Scheduled Monuments in England',
        '<div class="legal-card legal-danger"><ul>' +
        '<li>There are over <strong>19,800 Scheduled Monuments</strong> in England</li>' +
        '<li>It is a <strong>criminal offence</strong> to use a metal detector on a Scheduled Monument without consent from Historic England</li>' +
        '<li>Penalties include fines and imprisonment</li>' +
        '<li>Scheduled Monuments are not always visually obvious — they can be buried features with no surface markers</li>' +
        '<li>Check the <strong>National Heritage List for England</strong> at historicengland.org.uk before detecting in any new area</li>' +
        '<li>Consent is rarely granted for metal detecting on Scheduled Monuments</li>' +
        '</ul></div>', 'danger', 40,
        'https://historicengland.org.uk/listing/the-list/ https://historicengland.org.uk/advice/planning/consents/scheduled-monument-consent/',
        '2025-01-15').changes;

    // --- Scotland (SCT) — additional sections ---
    inserted += insertLegal.run('GB', 'SCT', 'en', 'treasure_trove_process_sct', 'Treasure Trove Process in Scotland',
        '<div class="legal-card legal-warning"><ul>' +
        '<li>All ownerless objects found in Scotland belong to the Crown under <em>bona vacantia</em></li>' +
        '<li>Finders must report all archaeological objects to the <strong>Treasure Trove Unit</strong> (TTU)</li>' +
        '<li>The TTU assesses finds and the <strong>Scottish Archaeological Finds Allocation Panel</strong> (SAFAP) recommends allocation to museums</li>' +
        '<li>The Queen\'s and Lord Treasurer\'s Remembrancer (QLTR) makes the final decision</li>' +
        '<li>Ex gratia rewards are paid based on the circumstances of the find</li>' +
        '<li>Reporting is legally required — failure to report can result in prosecution</li>' +
        '<li>Report finds online at <strong>treasuretrovescotland.co.uk</strong></li>' +
        '</ul></div>', 'warning', 20,
        'https://treasuretrovescotland.co.uk/ https://www.nms.ac.uk/',
        '2025-01-15').changes;

    inserted += insertLegal.run('GB', 'SCT', 'en', 'access_rights_sct', 'Land Access Rights in Scotland',
        '<div class="legal-card legal-caution"><ul>' +
        '<li>The <strong>Land Reform (Scotland) Act 2003</strong> provides a right of responsible access to most land</li>' +
        '<li>However, the right of access covers walking and recreation — it does <strong>not</strong> automatically include metal detecting</li>' +
        '<li>Landowner permission is still required specifically for metal detecting</li>' +
        '<li>The <strong>Scottish Outdoor Access Code</strong> provides guidance on responsible access</li>' +
        '<li>Scheduled Monuments require consent from <strong>Historic Environment Scotland</strong></li>' +
        '<li>Farmland should be avoided during growing and harvesting seasons unless the farmer agrees</li>' +
        '</ul></div>', 'caution', 30,
        'https://www.outdooraccess-scotland.scot/ https://www.historicenvironment.scot/',
        '2025-01-15').changes;

    // --- Wales (WLS) — additional sections ---
    inserted += insertLegal.run('GB', 'WLS', 'en', 'cadw_wls', 'Cadw & Scheduled Monuments in Wales',
        '<div class="legal-card legal-danger"><ul>' +
        '<li><strong>Cadw</strong> is the Welsh Government\'s historic environment service</li>' +
        '<li>Wales has over <strong>4,200 Scheduled Monuments</strong></li>' +
        '<li>Metal detecting on a Scheduled Monument without Cadw consent is a <strong>criminal offence</strong></li>' +
        '<li>The <strong>Coflein</strong> database (maintained by the Royal Commission on Ancient and Historical Monuments of Wales) records known sites</li>' +
        '<li>Hillforts, Roman forts, medieval castles, and burial mounds are commonly scheduled</li>' +
        '<li>Check with Cadw and Coflein before detecting in any new area in Wales</li>' +
        '</ul></div>', 'danger', 20,
        'https://cadw.gov.wales/ https://coflein.gov.uk/',
        '2025-01-15').changes;

    inserted += insertLegal.run('GB', 'WLS', 'en', 'popular_areas_wls', 'Popular Detecting Areas in Wales',
        '<div class="legal-card legal-ok"><ul>' +
        '<li><strong>Vale of Glamorgan</strong> — Roman and medieval finds, good agricultural land</li>' +
        '<li><strong>Pembrokeshire</strong> — Viking, Norman, and medieval history; coastal finds</li>' +
        '<li><strong>Powys</strong> — extensive pastoral land with Roman road networks and medieval sites</li>' +
        '<li><strong>North Wales coast</strong> — medieval and post-medieval finds, beach detecting opportunities</li>' +
        '<li>Wales has a strong detecting community with active clubs and rallies</li>' +
        '<li>Record finds with the PAS — Wales has dedicated Finds Liaison Officers</li>' +
        '</ul></div>', 'ok', 30,
        'https://museum.wales/ https://finds.org.uk/',
        '2025-01-15').changes;

    // --- Northern Ireland (NIR) — additional sections ---
    inserted += insertLegal.run('GB', 'NIR', 'en', 'licensing_nir', 'Licensing Requirements in Northern Ireland',
        '<div class="legal-card legal-warning"><ul>' +
        '<li>Metal detecting in Northern Ireland may require a <strong>licence</strong> from the Department for Communities</li>' +
        '<li>The <strong>Historic Monuments and Archaeological Objects (NI) Order 1995</strong> is the key legislation</li>' +
        '<li>All archaeological objects found in Northern Ireland must be reported</li>' +
        '<li>Objects over 200 years old (or items associated with a protected site) must be reported within 14 days</li>' +
        '<li>The licensing system is more restrictive than England and Wales</li>' +
        '<li>Unlicensed detecting may result in prosecution</li>' +
        '<li>Contact the Historic Environment Division for current licensing requirements</li>' +
        '</ul></div>', 'warning', 20,
        'https://www.communities-ni.gov.uk/topics/historic-environment https://www.communities-ni.gov.uk/articles/archaeological-objects',
        '2025-01-15').changes;

    inserted += insertLegal.run('GB', 'NIR', 'en', 'protected_places_nir', 'Protected Places in Northern Ireland',
        '<div class="legal-card legal-danger"><ul>' +
        '<li>Northern Ireland has over <strong>1,900 Scheduled Historic Monuments</strong></li>' +
        '<li>Metal detecting on or near a Scheduled Monument without consent is a <strong>criminal offence</strong></li>' +
        '<li>Areas of Significant Archaeological Interest (ASAIs) provide additional protections</li>' +
        '<li>Northern Ireland Sites and Monuments Record (NISMR) lists known archaeological sites</li>' +
        '<li>Historic parks, gardens, and demesnes may have additional restrictions</li>' +
        '<li>The Giant\'s Causeway and surrounding areas are strictly protected</li>' +
        '<li>Always check with the Historic Environment Division before detecting in a new area</li>' +
        '</ul></div>', 'danger', 30,
        'https://www.communities-ni.gov.uk/topics/historic-environment https://www.communities-ni.gov.uk/services/historic-environment-map-viewer',
        '2025-01-15').changes;

});

txn();
console.log('Inserted ' + inserted + ' new legal content rows.');
db.close();
