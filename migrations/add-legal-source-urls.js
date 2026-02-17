#!/usr/bin/env node
/**
 * Migration: Add source_url values to legal_content entries.
 *
 * Run with: node migrations/add-legal-source-urls.js
 *
 * On production: node migrations/add-legal-source-urls.js --db data/tracker.db
 */
'use strict';

var path = require('path');
var Database = require('better-sqlite3');

// Allow specifying DB path via --db flag or default to test db
var dbPath = path.join(__dirname, '..', 'data', 'tracker.db');
var args = process.argv.slice(2);
for (var i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
        dbPath = path.resolve(args[i + 1]);
    }
}

console.log('Using database:', dbPath);
var db = new Database(dbPath);

// Map of country_code|region_code|section_key -> source_url
// Multiple URLs separated by spaces
var SOURCE_URLS = {
    // ===== US NATIONAL =====
    'US||federal_arpa': 'https://www.nps.gov/subjects/archeology/archaeological-resources-protection-act.htm https://uscode.house.gov/view.xhtml?path=/prelim@title16/chapter1B&edition=prelim',
    'US||blm_land': 'https://www.blm.gov/programs/recreation',
    'US||national_grassland': 'https://www.fs.usda.gov/managing-land/national-forests-grasslands',
    'US||state_parks': 'https://www.nps.gov/subjects/archeology/state-archeologists.htm',
    'US||private_land': null,
    'US||county_municipal': null,
    'US||best_practices': null,
    'US||land_type_summary': null,

    // ===== US STATES =====
    'US|AL|state_overview': 'https://www.alapark.com/',
    'US|AL|state_parks_al': 'https://www.alapark.com/rules-regulations',
    'US|AK|state_overview': 'https://dnr.alaska.gov/parks/',
    'US|AK|state_lands': 'https://dnr.alaska.gov/mlw/',
    'US|AZ|state_overview': 'https://azstateparks.com/',
    'US|AZ|state_trust_az': 'https://land.az.gov/recreational-permit',
    'US|AR|state_overview': 'https://www.arkansasstateparks.com/',
    'US|AR|state_parks_ar': 'https://www.arkansasstateparks.com/',
    'US|CA|state_overview': 'https://www.parks.ca.gov/',
    'US|CA|state_parks_ca': 'https://www.parks.ca.gov/?page_id=21299',
    'US|CO|state_overview': 'https://cpw.state.co.us/',
    'US|CO|state_trust': 'https://slb.colorado.gov/',
    'US|CO|state_parks_co': 'https://cpw.state.co.us/aboutus/Pages/Regulations.aspx',
    'US|CO|contacts_co': 'https://www.blm.gov/office/colorado-state-office https://slb.colorado.gov/ https://cpw.state.co.us/',
    'US|CT|state_overview': 'https://portal.ct.gov/deep/state-parks',
    'US|CT|state_parks_ct': 'https://portal.ct.gov/deep/state-parks',
    'US|DE|state_overview': 'https://destateparks.com/',
    'US|DE|state_parks_de': 'https://destateparks.com/',
    'US|FL|state_overview': 'https://www.floridastateparks.org/',
    'US|FL|beaches_fl': 'https://dos.fl.gov/historical/archaeology/regulations/',
    'US|GA|state_overview': 'https://gastateparks.org/',
    'US|GA|state_parks_ga': 'https://gastateparks.org/Rules',
    'US|HI|state_overview': 'https://dlnr.hawaii.gov/dsp/',
    'US|HI|cultural_protection': 'https://dlnr.hawaii.gov/shpd/',
    'US|ID|state_overview': 'https://parksandrecreation.idaho.gov/',
    'US|ID|state_lands_id': 'https://www.idl.idaho.gov/',
    'US|IL|state_overview': 'https://dnr.illinois.gov/',
    'US|IL|state_parks_il': 'https://dnr.illinois.gov/',
    'US|IN|state_overview': 'https://www.in.gov/dnr/state-parks/',
    'US|IN|state_parks_in': 'https://www.in.gov/dnr/state-parks/',
    'US|IA|state_overview': 'https://www.iowadnr.gov/Places-to-Go/State-Parks',
    'US|IA|state_parks_ia': 'https://www.iowadnr.gov/Places-to-Go/State-Parks',
    'US|KS|state_overview': 'https://ksoutdoors.com/State-Parks',
    'US|KS|state_parks_ks': 'https://ksoutdoors.com/State-Parks',
    'US|KY|state_overview': 'https://parks.ky.gov/',
    'US|KY|state_parks_ky': 'https://parks.ky.gov/',
    'US|LA|state_overview': 'https://www.lastateparks.com/',
    'US|LA|state_parks_la': 'https://www.lastateparks.com/',
    'US|ME|state_overview': 'https://www.maine.gov/dacf/parks/',
    'US|ME|state_parks_me': 'https://www.maine.gov/dacf/parks/',
    'US|MD|state_overview': 'https://dnr.maryland.gov/publiclands/',
    'US|MD|state_parks_md': 'https://dnr.maryland.gov/publiclands/ https://mht.maryland.gov/',
    'US|MA|state_overview': 'https://www.mass.gov/orgs/department-of-conservation-and-recreation',
    'US|MA|state_parks_ma': 'https://www.mass.gov/orgs/department-of-conservation-and-recreation',
    'US|MI|state_overview': 'https://www.michigan.gov/dnr/places/state-parks',
    'US|MI|state_parks_mi': 'https://www.michigan.gov/dnr/places/state-parks',
    'US|MN|state_overview': 'https://www.dnr.state.mn.us/state_parks/index.html',
    'US|MN|state_parks_mn': 'https://www.dnr.state.mn.us/state_parks/rules.html',
    'US|MS|state_overview': 'https://www.mdwfp.com/parks-destinations/',
    'US|MS|state_parks_ms': 'https://www.mdwfp.com/parks-destinations/',
    'US|MO|state_overview': 'https://mostateparks.com/',
    'US|MO|state_parks_mo': 'https://mostateparks.com/',
    'US|MT|state_overview': 'https://fwp.mt.gov/stateparks',
    'US|MT|state_lands_mt': 'https://dnrc.mt.gov/',
    'US|NE|state_overview': 'https://outdoornebraska.gov/stateparks/',
    'US|NE|state_parks_ne': 'https://outdoornebraska.gov/stateparks/',
    'US|NV|state_overview': 'https://parks.nv.gov/',
    'US|NV|blm_nv': 'https://www.blm.gov/office/nevada-state-office',
    'US|NH|state_overview': 'https://www.nhstateparks.org/',
    'US|NH|state_parks_nh': 'https://www.nhstateparks.org/',
    'US|NJ|state_overview': 'https://www.nj.gov/dep/parksandforests/',
    'US|NJ|beaches_nj': 'https://www.nj.gov/dep/parksandforests/',
    'US|NM|state_overview': 'https://www.emnrd.nm.gov/spd/',
    'US|NM|cultural_nm': 'https://www.nmhistoricpreservation.org/',
    'US|NY|state_overview': 'https://parks.ny.gov/',
    'US|NY|state_parks_ny': 'https://parks.ny.gov/',
    'US|NC|state_overview': 'https://www.ncparks.gov/',
    'US|NC|beaches_nc': 'https://www.ncparks.gov/',
    'US|ND|state_overview': 'https://www.parkrec.nd.gov/',
    'US|ND|state_parks_nd': 'https://www.parkrec.nd.gov/',
    'US|OH|state_overview': 'https://ohiodnr.gov/go-and-do/plan-a-visit/find-a-property',
    'US|OH|state_parks_oh': 'https://ohiodnr.gov/',
    'US|OK|state_overview': 'https://www.travelok.com/state_parks',
    'US|OK|state_parks_ok': 'https://www.travelok.com/state_parks',
    'US|OR|state_overview': 'https://stateparks.oregon.gov/',
    'US|OR|state_parks_or': 'https://stateparks.oregon.gov/',
    'US|PA|state_overview': 'https://www.dcnr.pa.gov/StateParks/',
    'US|PA|state_parks_pa': 'https://www.dcnr.pa.gov/StateParks/',
    'US|RI|state_overview': 'https://riparks.com/',
    'US|RI|state_parks_ri': 'https://riparks.com/',
    'US|SC|state_overview': 'https://southcarolinaparks.com/',
    'US|SC|artifact_law_sc': 'https://scdah.sc.gov/historic-preservation/programs/archaeology',
    'US|SD|state_overview': 'https://gfp.sd.gov/state-parks/',
    'US|SD|state_parks_sd': 'https://gfp.sd.gov/state-parks/',
    'US|TN|state_overview': 'https://www.tn.gov/environment/parks.html',
    'US|TN|state_parks_tn': 'https://www.tn.gov/environment/parks.html',
    'US|TX|state_overview': 'https://tpwd.texas.gov/state-parks/',
    'US|TX|state_parks_tx': 'https://tpwd.texas.gov/state-parks/ https://www.thc.texas.gov/',
    'US|UT|state_overview': 'https://stateparks.utah.gov/',
    'US|UT|cultural_ut': 'https://stateparks.utah.gov/ https://history.utah.gov/',
    'US|VT|state_overview': 'https://fpr.vermont.gov/state-parks',
    'US|VT|state_parks_vt': 'https://fpr.vermont.gov/state-parks',
    'US|VA|state_overview': 'https://www.dcr.virginia.gov/state-parks/',
    'US|VA|state_parks_va': 'https://www.dcr.virginia.gov/state-parks/ https://www.dhr.virginia.gov/',
    'US|WA|state_overview': 'https://parks.wa.gov/',
    'US|WA|state_parks_wa': 'https://parks.wa.gov/ https://dahp.wa.gov/',
    'US|WV|state_overview': 'https://wvstateparks.com/',
    'US|WV|state_parks_wv': 'https://wvstateparks.com/',
    'US|WI|state_overview': 'https://dnr.wisconsin.gov/topic/parks',
    'US|WI|state_parks_wi': 'https://dnr.wisconsin.gov/topic/parks',
    'US|WY|state_overview': 'https://wyoparks.wyo.gov/',
    'US|WY|state_lands_wy': 'https://lands.wyo.gov/ https://wyoparks.wyo.gov/',

    // ===== GB NATIONAL =====
    'GB||treasure_act': 'https://www.legislation.gov.uk/ukpga/1996/24/contents https://finds.org.uk/treasure',
    'GB||pas_scheme': 'https://finds.org.uk/',
    'GB||permissions_land': 'https://historicengland.org.uk/advice/planning/consents/scheduled-monument-consent/',
    'GB||scotland_law': 'https://treasuretrovescotland.co.uk/ https://www.historicenvironment.scot/',

    // ===== GB REGIONAL =====
    'GB|ENG|detecting_england': 'https://finds.org.uk/ https://historicengland.org.uk/',
    'GB|SCT|detecting_scotland': 'https://treasuretrovescotland.co.uk/ https://www.historicenvironment.scot/',
    'GB|WLS|detecting_wales': 'https://cadw.gov.wales/ https://museum.wales/',
    'GB|NIR|detecting_nir': 'https://www.communities-ni.gov.uk/topics/historic-environment',

    // ===== AU NATIONAL =====
    'AU||au_overview': 'https://www.dcceew.gov.au/parks-heritage/heritage',
    'AU||au_protected': 'https://www.dcceew.gov.au/parks-heritage/national-parks',
    'AU||au_state_differences': null,

    // ===== AU REGIONAL =====
    'AU|VIC|detecting_vic': 'https://earthresources.vic.gov.au/licensing-and-approvals/mineral-licences/miners-right https://www.parks.vic.gov.au/',
    'AU|WA_AU|detecting_wa': 'https://www.dmp.wa.gov.au/Minerals/Miners-Rights-6106.aspx https://www.dbca.wa.gov.au/',
    'AU|QLD|detecting_qld': 'https://www.resources.qld.gov.au/mining-resources/initiatives/fossicking https://parks.des.qld.gov.au/',
    'AU|NSW|detecting_nsw': 'https://www.heritage.nsw.gov.au/ https://www.nationalparks.nsw.gov.au/',
    'AU|SA|detecting_sa': 'https://www.energymining.sa.gov.au/ https://www.parks.sa.gov.au/',
    'AU|TAS|detecting_tas': 'https://www.mrt.tas.gov.au/ https://parks.tas.gov.au/',

    // ===== CA NATIONAL =====
    'CA||ca_overview': 'https://parks.canada.ca/ https://laws-lois.justice.gc.ca/eng/acts/h-4/',
    'CA||ca_federal': 'https://parks.canada.ca/ https://laws-lois.justice.gc.ca/eng/acts/n-14.01/',

    // ===== CA REGIONAL =====
    'CA|ON|detecting_on': 'https://www.ontarioparks.ca/ https://www.ontario.ca/laws/statute/90o18',
    'CA|BC|detecting_bc': 'https://bcparks.ca/ https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96187_01',
    'CA|AB|detecting_ab': 'https://www.albertaparks.ca/ https://www.alberta.ca/historical-resources-act',
    'CA|QC|detecting_qc': 'https://www.sepaq.com/ https://www.quebec.ca/en/culture/cultural-heritage',

    // ===== NZ NATIONAL =====
    'NZ||nz_overview': 'https://www.doc.govt.nz/ https://www.heritage.org.nz/',
    'NZ||nz_protected': 'https://www.heritage.org.nz/ https://www.legislation.govt.nz/act/public/2014/0026/latest/whole.html',
    'NZ||nz_goldfields': 'https://www.doc.govt.nz/parks-and-recreation/things-to-do/gold-panning/ https://www.nzpam.govt.nz/',
};

// Build and run updates
var update = db.prepare(
    'UPDATE legal_content SET source_url = ? WHERE country_code = ? AND (region_code IS ? OR region_code = ?) AND section_key = ?'
);

var updated = 0;
var skipped = 0;

var txn = db.transaction(function () {
    var keys = Object.keys(SOURCE_URLS);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var url = SOURCE_URLS[key];
        if (!url) { skipped++; continue; }

        var parts = key.split('|');
        var country = parts[0];
        var region = parts[1] || null;
        var sectionKey = parts[2];

        var result = update.run(url, country, region, region, sectionKey);
        if (result.changes > 0) {
            updated += result.changes;
        } else {
            console.log('  No match for: ' + key);
        }
    }
});

txn();
console.log('Updated ' + updated + ' rows, skipped ' + skipped + ' null entries.');
db.close();
