/**
 * Seed data — default app_settings, land type presets, and legal content.
 * All seeding is idempotent (checks for existing data before inserting).
 * Accepts a pg Pool instance.
 */
module.exports = async function runSeeds(pool) {

    // Seed default settings
    var existingNotifSetting = (await pool.query("SELECT key FROM app_settings WHERE key = 'notify_on_register'")).rows[0];
    if (!existingNotifSetting) {
        await pool.query("INSERT INTO app_settings (key, value) VALUES ('notify_on_register', 'false')");
    }

    // Seed land type presets (if table is empty)
    var landTypeCount = (await pool.query('SELECT COUNT(*) as cnt FROM land_types WHERE is_custom = false')).rows[0];
    if (parseInt(landTypeCount.cnt, 10) === 0) {
        async function insertLandType(code, label, countryCode, description, sortOrder) {
            await pool.query(
                'INSERT INTO land_types (code, label, country_code, description, sort_order) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
                [code, label, countryCode, description, sortOrder]
            );
        }
            // US presets
            await insertLandType('private', 'Private Land', 'US', 'Privately owned property — written permission required', 10);
            await insertLandType('blm', 'BLM (Bureau of Land Management)', 'US', 'Federal public land managed by BLM — casual detecting generally allowed', 20);
            await insertLandType('national_grassland', 'National Grassland', 'US', 'USFS-managed grassland — check with ranger district', 30);
            await insertLandType('state_trust', 'State Trust Land', 'US', 'State-managed land — rules vary by state', 40);
            await insertLandType('state_park', 'State Park', 'US', 'State park — detecting usually prohibited without permit', 50);
            await insertLandType('usfs', 'National Forest (USFS)', 'US', 'US Forest Service land — casual detecting generally allowed', 60);
            await insertLandType('county', 'County Land', 'US', 'County-managed property — check local ordinances', 70);
            await insertLandType('municipal', 'Municipal Land', 'US', 'City/town-managed property — check local ordinances', 80);
            await insertLandType('magnet_fishing', 'Magnet Fishing Site', 'US', 'Waterway, bridge, dock, or pier for magnet fishing — check local regulations and waterway access rules', 85);
            await insertLandType('unknown', 'Unknown', 'US', 'Land ownership not yet determined', 999);

            // UK presets
            await insertLandType('private', 'Private Land', 'GB', 'Privately owned — landowner permission required', 10);
            await insertLandType('crown_land', 'Crown Land', 'GB', 'Crown Estate land — permission rarely granted', 20);
            await insertLandType('common_land', 'Common Land', 'GB', 'Common land — check with local council', 30);
            await insertLandType('national_trust', 'National Trust', 'GB', 'National Trust property — detecting not permitted', 40);
            await insertLandType('council', 'Council Land', 'GB', 'Local council property — permit may be required', 50);
            await insertLandType('beach_foreshore', 'Beach / Foreshore', 'GB', 'Tidal foreshore — Crown Estate permit may be needed', 60);
            await insertLandType('magnet_fishing', 'Magnet Fishing Site', 'GB', 'Canal, river, or dock for magnet fishing — check Canal & River Trust rules and local bylaws', 65);
            await insertLandType('unknown', 'Unknown', 'GB', 'Land ownership not yet determined', 999);

            // Australia presets
            await insertLandType('private', 'Private Land', 'AU', 'Privately owned — landowner permission required', 10);
            await insertLandType('crown_land', 'Crown Land', 'AU', 'Crown land — rules vary by state/territory', 20);
            await insertLandType('national_park', 'National Park', 'AU', 'National park — detecting generally prohibited', 30);
            await insertLandType('state_forest', 'State Forest', 'AU', 'State forest — check with state forestry authority', 40);
            await insertLandType('council', 'Council Land', 'AU', 'Local council property — permit may be required', 50);
            await insertLandType('magnet_fishing', 'Magnet Fishing Site', 'AU', 'Waterway, bridge, or dock for magnet fishing — check state waterway regulations and local council rules', 55);
            await insertLandType('unknown', 'Unknown', 'AU', 'Land ownership not yet determined', 999);
    }

    // Seed legal content (if table is empty)
    var legalCount = (await pool.query('SELECT COUNT(*) as cnt FROM legal_content')).rows[0];
    if (parseInt(legalCount.cnt, 10) === 0) {
        async function insertLegal(countryCode, regionCode, language, sectionKey, sectionTitle, contentHtml, severity, sortOrder, sourceUrl, lastVerified) {
            await pool.query(
                'INSERT INTO legal_content (country_code, region_code, language, section_key, section_title, content_html, severity, sort_order, source_url, last_verified) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING',
                [countryCode, regionCode, language, sectionKey, sectionTitle, contentHtml, severity, sortOrder, sourceUrl, lastVerified]
            );
        }
            // =====================================================
            // US NATIONAL CONTENT
            // =====================================================
            await insertLegal('US', null, 'en', 'federal_arpa', 'Federal Law - ARPA (Archaeological Resources Protection Act)', '<div class="legal-card legal-warning"><p><strong>ARPA is the #1 rule on public land.</strong> The Archaeological Resources Protection Act (16 U.S.C. 470aa-mm) makes it illegal to excavate, remove, or damage any archaeological resource on federal or state public land.</p><ul><li>Cannot remove man-made objects <strong>over 100 years old</strong> from federal or state public land</li><li>Applies to all federal land: BLM, USFS, National Parks, military land, etc.</li><li>First offense: up to <strong>$20,000 fine</strong> and <strong>1 year imprisonment</strong></li><li>Second offense: up to <strong>$100,000 fine</strong> and <strong>2 years imprisonment</strong></li><li>Artifacts can be seized along with your equipment</li><li>Modern items (coins, jewelry, etc. under 100 years old) are generally OK to recover on <em>some</em> public land</li></ul></div>', 'warning', 10, null, '2025-01-15');

            await insertLegal('US', null, 'en', 'blm_land', 'BLM Land (Bureau of Land Management)', '<div class="legal-card legal-ok"><p>BLM land is generally the <strong>most permissive public land</strong> for metal detecting.</p><ul><li>Modern items (under 100 years old) — OK to recover</li><li>Gold prospecting with metal detectors — generally allowed</li><li>No permit required for casual recreational use</li><li>ARPA still applies — do not remove items over 100 years old</li><li>Some areas may be closed or restricted — check with local BLM field office</li><li>Cannot use motorized equipment or cause significant ground disturbance</li><li>Always fill your holes and pack out trash</li></ul><p>Find your local BLM field office at <strong>blm.gov</strong>.</p></div>', 'ok', 20, null, '2025-01-15');

            await insertLegal('US', null, 'en', 'national_grassland', 'National Grasslands', '<div class="legal-card legal-caution"><p>National Grasslands are managed by the <strong>U.S. Forest Service (USFS)</strong>.</p><ul><li>Casual recreational metal detecting is generally allowed</li><li>No formal permit typically required</li><li>ARPA applies — no items over 100 years old</li><li>Prohibited near archaeological sites, cultural sites, and historical areas</li><li>Cannot cause significant surface disturbance</li><li>Contact the local USFS district office for area-specific rules</li></ul><p>National Grasslands can be excellent for detecting due to historical settlement and use.</p></div>', 'caution', 30, null, '2025-01-15');

            await insertLegal('US', null, 'en', 'state_parks', 'State Parks', '<div class="legal-card legal-danger"><p><strong>Metal detecting is generally prohibited in state parks.</strong></p><ul><li>Cannot remove objects of archaeological, geological, or historical value</li><li>Some states may allow use of a metal detector but <strong>cannot remove any finds</strong></li><li>Must request individual park manager permission in most cases</li><li>Penalties vary by state but can include fines and equipment confiscation</li><li>Some states have specific exceptions — always check the state\'s parks department website</li></ul><p>Rules vary significantly by state — see the state-specific sections below for details.</p></div>', 'danger', 50, null, '2025-01-15');

            await insertLegal('US', null, 'en', 'private_land', 'Private Land', '<div class="legal-card legal-ok"><p><strong>Private land with permission is the best option for metal detecting.</strong></p><ul><li>Most permissive — keep anything you find regardless of age</li><li>No ARPA restrictions on private property</li><li>Always get <strong>written permission</strong> from the landowner</li><li>Clarify find-sharing arrangements upfront</li><li>A simple written agreement protects both parties</li></ul><p><strong>Tips for getting permission:</strong></p><ul><li>Be polite and professional — dress neatly</li><li>Explain what you do and show examples of typical finds</li><li>Offer to share finds or give the landowner first pick</li><li>Promise to fill all holes and leave the property better than you found it</li><li>Carry liability insurance if possible</li><li>Provide your contact information and offer references</li></ul></div>', 'ok', 60, null, '2025-01-15');

            await insertLegal('US', null, 'en', 'county_municipal', 'County / Municipal Land', '<div class="legal-card legal-caution"><p>Rules for county and municipal land <strong>vary widely by jurisdiction</strong>.</p><ul><li>No universal rule — each county and city sets its own ordinances</li><li>Some city parks restrict or prohibit metal detecting</li><li>Some counties require a permit</li><li>Always check local ordinances before detecting</li><li>Contact the county or city parks department for current rules</li><li>School grounds are generally off-limits during school hours</li></ul></div>', 'caution', 70, null, '2025-01-15');

            await insertLegal('US', null, 'en', 'best_practices', 'Best Practices & Ethics', '<div class="legal-card"><p>Follow these best practices to protect the hobby and maintain good relationships:</p><ul><li><strong>Always get written permission</strong> before detecting on any land</li><li><strong>Fill all holes</strong> — leave the ground as you found it or better</li><li><strong>Pack out all trash</strong> — take everything you dig, including junk</li><li><strong>Report historically significant finds</strong> to local historical societies or museums</li><li><strong>Never detect in cemeteries</strong> — this is disrespectful and often illegal</li><li><strong>If you find human remains</strong>, stop immediately and contact local law enforcement</li><li><strong>Respect the land</strong> — don\'t damage crops, fences, or structures</li><li><strong>Follow the detectorist\'s code of ethics</strong> — be an ambassador for the hobby</li></ul></div>', null, 80, null, '2025-01-15');

            await insertLegal('US', null, 'en', 'land_type_summary', 'Quick Reference: Land Type Summary', '<div class="legal-card"><table class="table table-sm"><thead><tr><th>Land Type</th><th>Detecting OK?</th><th>Keep Finds?</th><th>Permission Needed?</th></tr></thead><tbody><tr><td>Private Land</td><td class="text-success"><strong>Yes</strong></td><td class="text-success"><strong>Yes (all)</strong></td><td>Landowner</td></tr><tr><td>BLM Land</td><td class="text-success"><strong>Yes</strong></td><td>Modern only (&lt;100yr)</td><td>None (casual use)</td></tr><tr><td>National Grassland</td><td class="text-success"><strong>Yes</strong></td><td>Modern only (&lt;100yr)</td><td>None (casual use)</td></tr><tr><td>USFS / National Forest</td><td class="text-warning"><strong>Varies</strong></td><td>Modern only (&lt;100yr)</td><td>Check local office</td></tr><tr><td>State Parks</td><td class="text-danger"><strong>Usually No</strong></td><td class="text-danger"><strong>No</strong></td><td>Park manager</td></tr><tr><td>National Parks</td><td class="text-danger"><strong>No</strong></td><td class="text-danger"><strong>No</strong></td><td>N/A — Prohibited</td></tr><tr><td>County/Municipal</td><td class="text-warning"><strong>Varies</strong></td><td class="text-warning"><strong>Varies</strong></td><td>Check local rules</td></tr></tbody></table></div>', null, 90, null, '2025-01-15');

            await insertLegal('US', null, 'en', 'beach_foreshore_us', 'Beach & Foreshore Detecting', '<div class="legal-card legal-caution"><ul><li>Beach detecting rules vary by <strong>ownership of the beach</strong> — public, state, federal, or private</li><li><strong>Dry sand</strong> (above high tide line) is often municipal or private — check local ordinances</li><li><strong>Wet sand</strong> (intertidal zone) is generally public but varies by state</li><li>National seashores (e.g., Cape Cod, Padre Island) are <strong>federal land — ARPA applies</strong></li><li>State beaches may prohibit detecting — check with the state parks department</li><li>Shipwreck artifacts are protected under the <strong>Abandoned Shipwreck Act of 1987</strong></li><li>Popular beach detecting states include Florida, New Jersey, California, and the Carolinas</li><li>After storms and high tides is often the best time for beach detecting</li></ul></div>', 'caution', 95, null, '2025-01-15');
            await insertLegal('US', null, 'en', 'rivers_waterways_us', 'River & Waterway Detecting', '<div class="legal-card legal-caution"><ul><li>Navigable waterways are generally public, but <strong>definitions of "navigable" vary by state</strong></li><li>Riverbeds may be public (state-owned) or private depending on the state</li><li>States like Montana and Utah grant public access to streambeds below the high-water mark</li><li>States like Colorado consider riverbeds private property even if the water is navigable</li><li>ARPA applies on federal waterways (Army Corps of Engineers managed land, federal reservoirs)</li><li>Gold panning in rivers is popular and often permitted — check for mining claim restrictions</li><li>Underwater detecting may require specific permits in some states</li><li>Never detect on dam structures, levees, or Army Corps of Engineers facilities</li></ul></div>', 'caution', 96, null, '2025-01-15');
            await insertLegal('US', null, 'en', 'reporting_finds_us', 'Reporting Significant Finds', '<div class="legal-card legal-ok"><ul><li>On <strong>private land</strong>, there is generally no legal requirement to report finds (but it\'s good practice)</li><li>On <strong>public land</strong>, significant finds should be reported to the land management agency</li><li>If you discover <strong>human remains</strong>, <strong>stop immediately</strong> and contact local law enforcement — this is required by law in all states</li><li>Native American artifacts and burial items are protected under <strong>NAGPRA</strong> on federal and tribal land</li><li>Many states have a State Archaeologist or State Historic Preservation Officer (SHPO) who welcomes reports</li><li>Consider reporting significant historical finds to local historical societies or museums</li><li>Documenting and photographing finds in situ (before removal) adds historical value</li></ul></div>', 'ok', 97, null, '2025-01-15');

            // =====================================================
            // US STATE CONTENT — All 50 States
            // =====================================================

            // Alabama (AL)
            await insertLegal('US', 'AL', 'en', 'state_overview', 'Alabama Overview', '<div class="legal-card legal-caution"><ul><li>State parks allow detecting with a permit in designated areas</li><li>Detecting on private land with landowner permission is legal</li><li>Historical sites are protected under the Alabama Historical Commission</li><li>No specific state metal detecting law — follows general property and trespassing laws</li><li>Rich Civil War and antebellum history provides many potential sites</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'AL', 'en', 'state_parks_al', 'Alabama State Parks', '<div class="legal-card legal-caution"><ul><li>Metal detecting is allowed in designated areas of some state parks with a free permit from the park office</li><li>Not allowed in nature preserves or historical areas within parks</li><li>Contact individual parks for current policies and designated detecting areas</li><li>Fill all holes and report significant finds to park staff</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Alaska (AK)
            await insertLegal('US', 'AK', 'en', 'state_overview', 'Alaska Overview', '<div class="legal-card legal-caution"><ul><li>State parks generally allow metal detecting</li><li>Federal lands (BLM, National Forest) follow standard ARPA rules</li><li>Native corporation lands require permission from the specific corporation</li><li>Gold prospecting with metal detectors is popular on state and BLM lands</li><li>Remote locations may require special preparation and permits</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'AK', 'en', 'state_lands', 'Alaska State Lands', '<div class="legal-card legal-ok"><ul><li>Alaska Department of Natural Resources manages state land</li><li>Casual metal detecting generally allowed on state land</li><li>Gold panning and prospecting is popular and widely permitted</li><li>Check for active mining claims before detecting in goldfield areas</li><li>Always respect Native corporation land boundaries</li></ul></div>', 'ok', 20, null, '2025-01-15');

            // Arizona (AZ)
            await insertLegal('US', 'AZ', 'en', 'state_overview', 'Arizona Overview', '<div class="legal-card legal-caution"><ul><li>Large amount of BLM and National Forest land available for detecting</li><li>State trust land requires a recreational permit</li><li>State parks generally prohibit metal detecting</li><li>Strong ARPA enforcement near archaeological sites</li><li>Arizona has extensive prehistoric and historic ruins — exercise extreme caution</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'AZ', 'en', 'state_trust_az', 'Arizona State Trust Land', '<div class="legal-card legal-warning"><ul><li>Recreational permit required from Arizona State Land Department ($15/individual)</li><li>Metal detecting may be restricted on certain parcels</li><li>Very important not to disturb archaeological sites which are common throughout the state</li><li>Permit does not authorize removal of archaeological resources</li></ul></div>', 'warning', 20, null, '2025-01-15');

            // Arkansas (AR)
            await insertLegal('US', 'AR', 'en', 'state_overview', 'Arkansas Overview', '<div class="legal-card legal-caution"><ul><li>State parks vary — some allow detecting, others prohibit it</li><li>Private land with permission is the best option</li><li>Rich Civil War history creates many productive detecting sites</li><li>National forests follow standard federal ARPA rules</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'AR', 'en', 'state_parks_ar', 'Arkansas State Parks', '<div class="legal-card legal-caution"><ul><li>Policies vary by individual park</li><li>Some parks allow metal detecting in designated areas</li><li>Contact individual park superintendent for current rules</li><li>Crater of Diamonds State Park has its own specific detecting and digging rules</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // California (CA)
            await insertLegal('US', 'CA', 'en', 'state_overview', 'California Overview', '<div class="legal-card legal-warning"><ul><li>State parks and beaches generally prohibit metal detecting</li><li>State law protects all archaeological resources on state land</li><li>BLM and National Forest land follows standard federal rules</li><li>Some county beaches allow detecting — check local rules</li><li>Gold prospecting popular in the Sierra Nevada foothills</li></ul></div>', 'warning', 10, null, '2025-01-15');
            await insertLegal('US', 'CA', 'en', 'state_parks_ca', 'California State Parks', '<div class="legal-card legal-danger"><ul><li>Metal detecting is <strong>NOT permitted</strong> in California State Parks, State Beaches, or State Historic Parks</li><li>This includes all state-managed beach areas</li><li>Violation can result in fines and equipment confiscation</li><li>County and city beaches may have different rules — check locally</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // Colorado (CO)
            await insertLegal('US', 'CO', 'en', 'state_overview', 'Colorado Overview', '<div class="legal-card legal-caution"><ul><li>Colorado has a mix of federal public land (BLM, USFS, National Grasslands) and restrictive state land</li><li>State trust lands are essentially closed to metal detecting</li><li>State parks are mostly prohibited</li><li>Best opportunities are BLM land, National Grasslands, and private land with permission</li><li>Rich mining and frontier history throughout the state</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'CO', 'en', 'state_trust', 'Colorado State Trust Land', '<div class="legal-card legal-danger"><ul><li>State trust lands are closed to the public without written permission from the State Land Board</li><li>Metal detecting is <strong>NOT allowed</strong> without explicit authorization</li><li>Getting permission is extremely rare</li><li>Trespassing on state trust land can result in fines</li></ul></div>', 'danger', 20, null, '2025-01-15');
            await insertLegal('US', 'CO', 'en', 'state_parks_co', 'Colorado State Parks', '<div class="legal-card legal-danger"><ul><li>Prohibited to remove any object of archaeological, geological, or historical value</li><li>May use a metal detector in some parks but <strong>cannot remove finds</strong></li><li>Must request individual park manager permission</li><li>Each park may have different specific rules</li></ul></div>', 'danger', 30, null, '2025-01-15');
            await insertLegal('US', 'CO', 'en', 'contacts_co', 'Colorado Key Contacts', '<div class="legal-card"><ul><li><strong>BLM Colorado State Office</strong> — (303) 239-3600</li><li><strong>Colorado State Land Board</strong> — slb.colorado.gov</li><li><strong>Colorado Parks and Wildlife</strong> — (303) 297-1192</li></ul></div>', null, 40, null, '2025-01-15');

            // Connecticut (CT)
            await insertLegal('US', 'CT', 'en', 'state_overview', 'Connecticut Overview', '<div class="legal-card legal-caution"><ul><li>State parks and forests generally allow metal detecting with limitations</li><li>Town-owned land varies by municipality</li><li>Rich colonial and Revolutionary War history</li><li>Always check with local parks department for current rules</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'CT', 'en', 'state_parks_ct', 'Connecticut State Parks', '<div class="legal-card legal-ok"><ul><li>DEEP (Department of Energy and Environmental Protection) generally allows metal detecting in state parks and forests</li><li>Cannot disturb protected areas or remove items of archaeological significance</li><li>No formal permit typically required for casual detecting</li><li>Respect posted closures and seasonal restrictions</li></ul></div>', 'ok', 20, null, '2025-01-15');

            // Delaware (DE)
            await insertLegal('US', 'DE', 'en', 'state_overview', 'Delaware Overview', '<div class="legal-card legal-caution"><ul><li>State parks have varying policies on metal detecting</li><li>Some beaches allow detecting</li><li>Rich colonial history with many potential private-land sites</li><li>Always get landowner permission for private property</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'DE', 'en', 'state_parks_de', 'Delaware State Parks', '<div class="legal-card legal-caution"><ul><li>Some Delaware state parks and beaches allow metal detecting</li><li>Contact individual park offices for current policies</li><li>Cape Henlopen State Park has specific rules for beach detecting</li><li>Cannot detect in historic or archaeological areas</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Florida (FL)
            await insertLegal('US', 'FL', 'en', 'state_overview', 'Florida Overview', '<div class="legal-card legal-caution"><ul><li>Beaches are popular detecting spots — rules vary by county</li><li>State parks generally prohibit metal detecting</li><li>State underwater archaeology laws protect submerged cultural resources</li><li>Private land with permission offers best opportunities</li><li>Spanish colonial and shipwreck history makes Florida a premier detecting state</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'FL', 'en', 'beaches_fl', 'Florida Beaches', '<div class="legal-card legal-ok"><ul><li>Many Florida beaches allow metal detecting below the high-water mark</li><li>Dry sand rules vary by county and municipality</li><li>Some beaches have seasonal restrictions during turtle nesting season (May–October)</li><li>Check with county or city beach management for specific rules</li><li>Popular areas include Treasure Coast, southwest Florida beaches, and the Keys</li></ul></div>', 'ok', 20, null, '2025-01-15');

            // Georgia (GA)
            await insertLegal('US', 'GA', 'en', 'state_overview', 'Georgia Overview', '<div class="legal-card legal-caution"><ul><li>State parks vary in their policies on metal detecting</li><li>Strong archaeology protection laws for state and federal land</li><li>Civil War sites are common but many are protected</li><li>Private land with permission is the best option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'GA', 'en', 'state_parks_ga', 'Georgia State Parks', '<div class="legal-card legal-caution"><ul><li>Policies vary by individual park</li><li>Some Georgia state parks allow detecting in designated areas</li><li>Cannot detect in historic areas or near historic structures</li><li>Contact the park manager for current policies</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Hawaii (HI)
            await insertLegal('US', 'HI', 'en', 'state_overview', 'Hawaii Overview', '<div class="legal-card legal-danger"><ul><li>Metal detecting is heavily restricted throughout Hawaii</li><li>State law protects Native Hawaiian cultural sites and burial grounds</li><li>State parks and beaches generally prohibit detecting</li><li>Federal lands follow ARPA rules</li><li>Very limited opportunities for metal detecting</li></ul></div>', 'danger', 10, null, '2025-01-15');
            await insertLegal('US', 'HI', 'en', 'cultural_protection', 'Cultural Resource Protection', '<div class="legal-card legal-danger"><ul><li>Hawaii has some of the strongest cultural resource protection laws in the US</li><li>Disturbance of any burial site or cultural artifact is a serious criminal offense</li><li>Native Hawaiian cultural sites are protected under state and federal law</li><li>Always respect Hawaiian cultural heritage and sacred sites</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // Idaho (ID)
            await insertLegal('US', 'ID', 'en', 'state_overview', 'Idaho Overview', '<div class="legal-card legal-ok"><ul><li>Generally favorable for metal detecting</li><li>Extensive BLM and National Forest land available</li><li>State endowment (trust) lands require a recreational use permit</li><li>Rich mining history provides many productive areas</li><li>Gold prospecting with metal detectors is popular</li></ul></div>', 'ok', 10, null, '2025-01-15');
            await insertLegal('US', 'ID', 'en', 'state_lands_id', 'Idaho State Endowment Lands', '<div class="legal-card legal-caution"><ul><li>Idaho Department of Lands manages state endowment lands</li><li>Recreational use permit may be required</li><li>Check with local IDL offices for specific areas and regulations</li><li>Cannot disturb archaeological or historical sites</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Illinois (IL)
            await insertLegal('US', 'IL', 'en', 'state_overview', 'Illinois Overview', '<div class="legal-card legal-caution"><ul><li>State parks and historic sites generally prohibit metal detecting</li><li>Rich history from Native American through Civil War era</li><li>Private land with permission is the primary option</li><li>Check county forest preserve rules individually</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'IL', 'en', 'state_parks_il', 'Illinois State Parks', '<div class="legal-card legal-danger"><ul><li>Illinois Department of Natural Resources prohibits metal detecting in state parks, historic sites, and nature preserves</li><li>Violation is a Class B misdemeanor</li><li>County forest preserves have their own rules — check with each district</li><li>Private land with landowner permission is the best alternative</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // Indiana (IN)
            await insertLegal('US', 'IN', 'en', 'state_overview', 'Indiana Overview', '<div class="legal-card legal-caution"><ul><li>State forests allow casual metal detecting</li><li>State parks have varying policies</li><li>Rich history from pioneer era through Civil War</li><li>Private land with permission is the best option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'IN', 'en', 'state_parks_in', 'Indiana State Parks & Forests', '<div class="legal-card legal-caution"><ul><li>Indiana state forests generally allow casual metal detecting</li><li>State parks have varying policies — contact individual park offices</li><li>Cannot detect in nature preserves or areas with archaeological significance</li><li>Fill all holes and practice responsible detecting</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Iowa (IA)
            await insertLegal('US', 'IA', 'en', 'state_overview', 'Iowa Overview', '<div class="legal-card legal-caution"><ul><li>State parks and preserves generally prohibit metal detecting</li><li>Some county parks allow it with conditions</li><li>Rich Native American and pioneer history</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'IA', 'en', 'state_parks_ia', 'Iowa State Parks', '<div class="legal-card legal-danger"><ul><li>Iowa DNR generally does not allow metal detecting in state parks, preserves, or recreation areas</li><li>Some county conservation board lands may allow detecting — check locally</li><li>Cannot detect in areas with archaeological or historical significance</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // Kansas (KS)
            await insertLegal('US', 'KS', 'en', 'state_overview', 'Kansas Overview', '<div class="legal-card legal-ok"><ul><li>Generally favorable for metal detecting</li><li>State parks have varying policies</li><li>Extensive history from Santa Fe Trail, cattle drive era, and frontier settlement</li><li>Private land with permission offers best opportunities</li></ul></div>', 'ok', 10, null, '2025-01-15');
            await insertLegal('US', 'KS', 'en', 'state_parks_ks', 'Kansas State Parks', '<div class="legal-card legal-caution"><ul><li>Some Kansas state parks allow metal detecting in limited areas</li><li>Contact the Kansas Department of Wildlife and Parks for specific park policies</li><li>Cannot detect near historical structures or archaeological sites</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Kentucky (KY)
            await insertLegal('US', 'KY', 'en', 'state_overview', 'Kentucky Overview', '<div class="legal-card legal-caution"><ul><li>State parks and historic sites generally prohibit metal detecting</li><li>Daniel Boone National Forest follows federal ARPA rules</li><li>Rich Civil War and frontier history</li><li>Private land with permission is the best option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'KY', 'en', 'state_parks_ky', 'Kentucky State Parks', '<div class="legal-card legal-danger"><ul><li>Kentucky State Parks do not generally allow metal detecting</li><li>State historic sites are strictly off-limits</li><li>Contact individual park managers for any exceptions</li><li>National forest land follows federal ARPA rules</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // Louisiana (LA)
            await insertLegal('US', 'LA', 'en', 'state_overview', 'Louisiana Overview', '<div class="legal-card legal-caution"><ul><li>State parks vary in their policies</li><li>Rich history from French colonial era through Civil War</li><li>Strong archaeological protection for state lands</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'LA', 'en', 'state_parks_la', 'Louisiana State Parks', '<div class="legal-card legal-caution"><ul><li>Policies vary by park</li><li>Some Louisiana state parks allow detecting with a permit</li><li>Cannot detect in historic areas or nature preserves</li><li>Contact the park superintendent for current policies</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Maine (ME)
            await insertLegal('US', 'ME', 'en', 'state_overview', 'Maine Overview', '<div class="legal-card legal-caution"><ul><li>State parks have varying policies on metal detecting</li><li>Coastal areas are popular for beach detecting</li><li>Rich colonial and maritime history</li><li>Private land with permission is the best option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'ME', 'en', 'state_parks_me', 'Maine State Parks', '<div class="legal-card legal-caution"><ul><li>Some Maine state parks allow metal detecting with permission from the park manager</li><li>Cannot detect in historical or archaeological areas</li><li>Beach detecting rules vary by location</li><li>Contact individual park offices for current policies</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Maryland (MD)
            await insertLegal('US', 'MD', 'en', 'state_overview', 'Maryland Overview', '<div class="legal-card legal-caution"><ul><li>State parks generally prohibit metal detecting</li><li>Strong archaeological protection laws</li><li>Rich colonial, Revolutionary War, and Civil War history</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'MD', 'en', 'state_parks_md', 'Maryland State Parks', '<div class="legal-card legal-danger"><ul><li>Metal detecting is generally not permitted in Maryland state parks or forests</li><li>Maryland Historical Trust oversees archaeological protection</li><li>Violation of state archaeology laws can result in significant fines</li><li>Private land with permission is the recommended alternative</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // Massachusetts (MA)
            await insertLegal('US', 'MA', 'en', 'state_overview', 'Massachusetts Overview', '<div class="legal-card legal-caution"><ul><li>State parks and beaches have varying policies</li><li>Rich colonial and Revolutionary War history</li><li>Strong archaeological protection laws</li><li>Some town beaches allow metal detecting</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'MA', 'en', 'state_parks_ma', 'Massachusetts State Parks', '<div class="legal-card legal-caution"><ul><li>DCR (Department of Conservation and Recreation) policies vary by property</li><li>Some parks and beaches allow metal detecting</li><li>Cannot detect in historic districts or archaeological areas</li><li>Contact individual park offices for current policies</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Michigan (MI)
            await insertLegal('US', 'MI', 'en', 'state_overview', 'Michigan Overview', '<div class="legal-card legal-caution"><ul><li>State parks and recreation areas have varying policies</li><li>Great Lakes beaches can be productive detecting spots</li><li>Rich fur trade, logging, and mining history</li><li>National forests follow federal ARPA rules</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'MI', 'en', 'state_parks_mi', 'Michigan State Parks', '<div class="legal-card legal-caution"><ul><li>Some Michigan state parks and recreation areas allow metal detecting</li><li>Policies vary by park — contact individual park offices</li><li>Cannot detect in natural areas, historic sites, or designated wilderness</li><li>Great Lakes beaches are popular detecting locations</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Minnesota (MN)
            await insertLegal('US', 'MN', 'en', 'state_overview', 'Minnesota Overview', '<div class="legal-card legal-caution"><ul><li>State parks generally do not allow metal detecting</li><li>State forests may have different policies</li><li>Rich fur trade and pioneer history</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'MN', 'en', 'state_parks_mn', 'Minnesota State Parks', '<div class="legal-card legal-danger"><ul><li>Minnesota DNR does not allow metal detecting in state parks</li><li>State forest policies may vary — check with local offices</li><li>Contact DNR for specific regulations on state-managed lands</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // Mississippi (MS)
            await insertLegal('US', 'MS', 'en', 'state_overview', 'Mississippi Overview', '<div class="legal-card legal-caution"><ul><li>State parks have varying policies</li><li>Rich Civil War history with many potential detecting sites</li><li>Strong archaeological protection for public lands</li><li>Private land with permission offers best opportunities</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'MS', 'en', 'state_parks_ms', 'Mississippi State Parks', '<div class="legal-card legal-caution"><ul><li>Some Mississippi state parks may allow detecting with permission</li><li>Civil War battlefields (both state and federal) are strictly protected</li><li>Contact individual park managers for current policies</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Missouri (MO)
            await insertLegal('US', 'MO', 'en', 'state_overview', 'Missouri Overview', '<div class="legal-card legal-caution"><ul><li>State parks generally prohibit metal detecting</li><li>Mark Twain National Forest follows federal ARPA rules</li><li>Rich Civil War and frontier history</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'MO', 'en', 'state_parks_mo', 'Missouri State Parks', '<div class="legal-card legal-danger"><ul><li>Metal detecting is not allowed in Missouri state parks or historic sites</li><li>Conservation areas managed by MDC may have different rules</li><li>Contact MDC for specific area policies</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // Montana (MT)
            await insertLegal('US', 'MT', 'en', 'state_overview', 'Montana Overview', '<div class="legal-card legal-ok"><ul><li>Generally favorable for metal detecting</li><li>Extensive BLM and National Forest land available</li><li>Gold prospecting popular in western Montana</li><li>State trust lands may require permission</li><li>Mining ghost towns are popular detecting destinations</li></ul></div>', 'ok', 10, null, '2025-01-15');
            await insertLegal('US', 'MT', 'en', 'state_lands_mt', 'Montana State Trust Lands', '<div class="legal-card legal-caution"><ul><li>Montana DNRC manages state trust lands</li><li>Recreational use generally allowed but verify for specific parcels</li><li>Gold panning and prospecting popular on both state and federal land</li><li>Cannot disturb archaeological or historical sites</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Nebraska (NE)
            await insertLegal('US', 'NE', 'en', 'state_overview', 'Nebraska Overview', '<div class="legal-card legal-caution"><ul><li>State parks and recreation areas have varying policies</li><li>Rich Oregon Trail and frontier history</li><li>Some National Grassland areas available for detecting</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'NE', 'en', 'state_parks_ne', 'Nebraska State Parks', '<div class="legal-card legal-caution"><ul><li>Policies vary by individual park and recreation area</li><li>Contact the Nebraska Game and Parks Commission for specific park policies</li><li>Cannot detect in historical or archaeological areas</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Nevada (NV)
            await insertLegal('US', 'NV', 'en', 'state_overview', 'Nevada Overview', '<div class="legal-card legal-ok"><ul><li>Very favorable for detecting due to extensive BLM land (over 80% of the state)</li><li>Gold prospecting is popular throughout the state</li><li>Mining ghost towns provide many detecting opportunities</li><li>State parks generally prohibit detecting</li><li>BLM land follows federal ARPA rules</li></ul></div>', 'ok', 10, null, '2025-01-15');
            await insertLegal('US', 'NV', 'en', 'blm_nv', 'Nevada BLM Land', '<div class="legal-card legal-ok"><ul><li>Nevada has more BLM land than any other state</li><li>Casual metal detecting for modern items generally allowed</li><li>Gold prospecting popular especially in northern Nevada</li><li>Check with local BLM office for area closures or active mining claims</li><li>ARPA applies — do not remove items over 100 years old</li></ul></div>', 'ok', 20, null, '2025-01-15');

            // New Hampshire (NH)
            await insertLegal('US', 'NH', 'en', 'state_overview', 'New Hampshire Overview', '<div class="legal-card legal-caution"><ul><li>State parks have varying policies on metal detecting</li><li>Rich colonial and Revolutionary War history</li><li>Some beaches allow detecting</li><li>Private land with permission is the best option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'NH', 'en', 'state_parks_nh', 'New Hampshire State Parks', '<div class="legal-card legal-caution"><ul><li>Some NH state parks allow metal detecting with conditions</li><li>Contact NH Division of Parks and Recreation for specific park policies</li><li>Cannot detect in historic or archaeological areas</li><li>Beach detecting may be allowed in some coastal areas</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // New Jersey (NJ)
            await insertLegal('US', 'NJ', 'en', 'state_overview', 'New Jersey Overview', '<div class="legal-card legal-caution"><ul><li>State parks generally prohibit metal detecting</li><li>Many beaches allow detecting below the high water mark</li><li>Rich colonial and Revolutionary War history</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'NJ', 'en', 'beaches_nj', 'New Jersey Beaches', '<div class="legal-card legal-ok"><ul><li>Many NJ beaches allow metal detecting</li><li>Rules vary by municipality — check local ordinances</li><li>Some beaches restrict detecting during summer months</li><li>Check with local beach management for specific rules and permitted hours</li></ul></div>', 'ok', 20, null, '2025-01-15');

            // New Mexico (NM)
            await insertLegal('US', 'NM', 'en', 'state_overview', 'New Mexico Overview', '<div class="legal-card legal-warning"><ul><li>Strong archaeological protection — numerous ancient and historic sites</li><li>State trust land requires a recreational use permit</li><li>BLM land follows federal ARPA rules</li><li>Very sensitive area for ARPA violations due to abundant archaeological resources</li><li>Exercise extreme caution when detecting anywhere in New Mexico</li></ul></div>', 'warning', 10, null, '2025-01-15');
            await insertLegal('US', 'NM', 'en', 'cultural_nm', 'New Mexico Cultural Resources', '<div class="legal-card legal-danger"><ul><li>New Mexico has some of the most significant archaeological sites in North America</li><li>The Cultural Properties Act protects archaeological resources on state and private land</li><li>Heavy ARPA enforcement on federal land</li><li>Be extremely careful about any finds that may be of archaeological significance</li><li>When in doubt, report finds and do not remove them</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // New York (NY)
            await insertLegal('US', 'NY', 'en', 'state_overview', 'New York Overview', '<div class="legal-card legal-caution"><ul><li>State parks generally prohibit metal detecting</li><li>Some beaches allow detecting</li><li>Rich colonial and Revolutionary War history</li><li>Private land with permission is the primary option</li><li>NYC parks have specific rules prohibiting detecting</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'NY', 'en', 'state_parks_ny', 'New York State Parks', '<div class="legal-card legal-danger"><ul><li>Metal detecting is not permitted in New York State Parks</li><li>NYC parks generally prohibit detecting</li><li>Some Long Island and upstate beaches may allow detecting</li><li>Check with local parks departments for specific rules</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // North Carolina (NC)
            await insertLegal('US', 'NC', 'en', 'state_overview', 'North Carolina Overview', '<div class="legal-card legal-caution"><ul><li>State parks have varying policies</li><li>Rich colonial and Civil War history</li><li>Beaches are popular metal detecting spots</li><li>Private land with permission offers best opportunities</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'NC', 'en', 'beaches_nc', 'North Carolina Beaches', '<div class="legal-card legal-ok"><ul><li>Many NC beaches allow metal detecting</li><li>Check with local municipalities for specific rules</li><li>Popular areas include the Outer Banks</li><li>May need to verify rules for specific beach access points</li></ul></div>', 'ok', 20, null, '2025-01-15');

            // North Dakota (ND)
            await insertLegal('US', 'ND', 'en', 'state_overview', 'North Dakota Overview', '<div class="legal-card legal-caution"><ul><li>State parks have varying policies</li><li>Theodore Roosevelt National Park and other federal lands follow ARPA</li><li>Rich frontier and Native American history</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'ND', 'en', 'state_parks_nd', 'North Dakota State Parks', '<div class="legal-card legal-caution"><ul><li>Contact North Dakota Parks and Recreation for specific policies at individual parks</li><li>Cannot detect in historic or archaeological areas</li><li>National Grasslands in ND follow federal rules</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Ohio (OH)
            await insertLegal('US', 'OH', 'en', 'state_overview', 'Ohio Overview', '<div class="legal-card legal-caution"><ul><li>State parks have varying policies</li><li>Rich pre-Civil War and Underground Railroad history</li><li>Strong protection for Native American mound sites</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'OH', 'en', 'state_parks_oh', 'Ohio State Parks', '<div class="legal-card legal-caution"><ul><li>Some Ohio state parks allow metal detecting with conditions</li><li>Cannot detect in nature preserves or historic/archaeological areas</li><li>Contact individual park offices for current policies</li><li>Mound sites and Native American earthworks are strictly protected</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Oklahoma (OK)
            await insertLegal('US', 'OK', 'en', 'state_overview', 'Oklahoma Overview', '<div class="legal-card legal-caution"><ul><li>State parks have varying policies</li><li>Rich frontier, Trail of Tears, and land rush history</li><li>Some BLM and Army Corps of Engineers land available</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'OK', 'en', 'state_parks_ok', 'Oklahoma State Parks', '<div class="legal-card legal-caution"><ul><li>Policies vary by park</li><li>Some Oklahoma state parks allow detecting with permission</li><li>Cannot detect in historical areas</li><li>Army Corps of Engineers lake lands have their own rules — contact individual lake offices</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Oregon (OR)
            await insertLegal('US', 'OR', 'en', 'state_overview', 'Oregon Overview', '<div class="legal-card legal-caution"><ul><li>State parks generally prohibit metal detecting</li><li>Extensive BLM and National Forest land follows federal rules</li><li>Gold prospecting popular in southern Oregon</li><li>Oregon beaches are public but may have restrictions</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'OR', 'en', 'state_parks_or', 'Oregon State Parks', '<div class="legal-card legal-danger"><ul><li>Oregon Parks and Recreation Department generally does not allow metal detecting in state parks</li><li>Oregon beaches are publicly owned up to the vegetation line</li><li>BLM and USFS land in southern Oregon is popular for gold prospecting</li><li>Check with local land managers for current rules</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // Pennsylvania (PA)
            await insertLegal('US', 'PA', 'en', 'state_overview', 'Pennsylvania Overview', '<div class="legal-card legal-caution"><ul><li>State parks and forests have varying policies</li><li>Rich colonial, Revolutionary War, and Civil War history</li><li>State game lands generally prohibit detecting</li><li>Private land with permission is the best option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'PA', 'en', 'state_parks_pa', 'Pennsylvania State Parks & Forests', '<div class="legal-card legal-caution"><ul><li>Some PA state parks and forests allow metal detecting in limited areas</li><li>Contact DCNR for specific policies</li><li>State game lands managed by the Game Commission generally prohibit detecting</li><li>Cannot detect in historic or archaeological areas</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Rhode Island (RI)
            await insertLegal('US', 'RI', 'en', 'state_overview', 'Rhode Island Overview', '<div class="legal-card legal-caution"><ul><li>State parks and beaches have varying policies</li><li>Rich colonial and maritime history</li><li>Some beaches allow metal detecting</li><li>Small state with many potential private-land sites</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'RI', 'en', 'state_parks_ri', 'Rhode Island State Parks', '<div class="legal-card legal-caution"><ul><li>DEM (Department of Environmental Management) policies vary by property</li><li>Some state beaches and parks allow metal detecting</li><li>Contact individual facilities for current rules</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // South Carolina (SC)
            await insertLegal('US', 'SC', 'en', 'state_overview', 'South Carolina Overview', '<div class="legal-card legal-warning"><ul><li>Strong underwater archaeology and artifact laws</li><li>SC Underwater Antiquities Act regulates artifact recovery</li><li>State parks have varying policies</li><li>Rich colonial and Civil War history</li><li>Private land with permission is the primary option</li></ul></div>', 'warning', 10, null, '2025-01-15');
            await insertLegal('US', 'SC', 'en', 'artifact_law_sc', 'South Carolina Artifact Laws', '<div class="legal-card legal-warning"><ul><li>SC has specific laws about artifact recovery on state lands and waterways</li><li>Hobby license may be required for underwater artifact recovery</li><li>Report significant historical finds to authorities</li><li>Contact SC Institute of Archaeology and Anthropology for guidance</li></ul></div>', 'warning', 20, null, '2025-01-15');

            // South Dakota (SD)
            await insertLegal('US', 'SD', 'en', 'state_overview', 'South Dakota Overview', '<div class="legal-card legal-caution"><ul><li>State parks and recreation areas have varying policies</li><li>Rich frontier and gold rush history (Black Hills)</li><li>Custer State Park has specific rules</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'SD', 'en', 'state_parks_sd', 'South Dakota State Parks', '<div class="legal-card legal-caution"><ul><li>Policies vary by park</li><li>Some SD parks and recreation areas may allow detecting</li><li>Black Hills National Forest follows federal ARPA rules</li><li>Contact individual park offices for current policies</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Tennessee (TN)
            await insertLegal('US', 'TN', 'en', 'state_overview', 'Tennessee Overview', '<div class="legal-card legal-caution"><ul><li>State parks generally prohibit metal detecting</li><li>Rich Civil War history with many significant sites</li><li>National forests (Cherokee) follow federal rules</li><li>Private land with permission is the best option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'TN', 'en', 'state_parks_tn', 'Tennessee State Parks', '<div class="legal-card legal-danger"><ul><li>Tennessee State Parks do not generally allow metal detecting</li><li>Civil War battlefields are strictly protected (both state and federal)</li><li>Contact TDEC (Tennessee Department of Environment and Conservation) for specific regulations</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // Texas (TX)
            await insertLegal('US', 'TX', 'en', 'state_overview', 'Texas Overview', '<div class="legal-card legal-ok"><ul><li>Generally favorable for detecting on private land</li><li>Texas has vast amounts of private land available with permission</li><li>State parks have restrictions</li><li>Rich history from Spanish colonial through Republic of Texas era</li><li>Beach rules vary by local jurisdiction</li></ul></div>', 'ok', 10, null, '2025-01-15');
            await insertLegal('US', 'TX', 'en', 'state_parks_tx', 'Texas State Parks', '<div class="legal-card legal-caution"><ul><li>TPWD (Texas Parks and Wildlife Department) policies vary by park</li><li>Some parks may allow limited detecting in designated areas</li><li>Cannot detect in historic or archaeological areas</li><li>Contact individual park superintendents for current policies</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Utah (UT)
            await insertLegal('US', 'UT', 'en', 'state_overview', 'Utah Overview', '<div class="legal-card legal-warning"><ul><li>Strong ARPA enforcement due to numerous archaeological sites</li><li>Extensive BLM land but many sensitive cultural areas</li><li>State parks generally prohibit detecting</li><li>Be very careful about Native American sites and artifacts</li></ul></div>', 'warning', 10, null, '2025-01-15');
            await insertLegal('US', 'UT', 'en', 'cultural_ut', 'Utah Cultural Resources', '<div class="legal-card legal-danger"><ul><li>Utah has extensive prehistoric and historic archaeological sites</li><li>ARPA is heavily enforced on federal land</li><li>The Antiquities section of the Utah Code provides additional state-level protection</li><li>Extremely important to avoid any site that could have archaeological significance</li><li>When in doubt, do not dig</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // Vermont (VT)
            await insertLegal('US', 'VT', 'en', 'state_overview', 'Vermont Overview', '<div class="legal-card legal-caution"><ul><li>State parks and forests have varying policies</li><li>Rich colonial and Revolutionary War history</li><li>Some state forests may allow casual detecting</li><li>Private land with permission is the best option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'VT', 'en', 'state_parks_vt', 'Vermont State Parks', '<div class="legal-card legal-caution"><ul><li>Vermont Department of Forests, Parks and Recreation policies vary</li><li>Some state forests may allow casual detecting</li><li>Cannot detect in historic or archaeological areas</li><li>Contact individual facilities for current rules</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Virginia (VA)
            await insertLegal('US', 'VA', 'en', 'state_overview', 'Virginia Overview', '<div class="legal-card legal-caution"><ul><li>State parks generally prohibit metal detecting</li><li>Extremely rich history from colonial era through Civil War</li><li>Many Civil War battlefields are protected</li><li>National forests follow federal ARPA rules</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'VA', 'en', 'state_parks_va', 'Virginia State Parks', '<div class="legal-card legal-danger"><ul><li>Virginia DCR does not generally allow metal detecting in state parks</li><li>Civil War battlefield parks are strictly protected</li><li>George Washington and Jefferson National Forests follow federal ARPA rules</li><li>Private land with landowner permission is the recommended alternative</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // Washington (WA)
            await insertLegal('US', 'WA', 'en', 'state_overview', 'Washington Overview', '<div class="legal-card legal-caution"><ul><li>State parks generally prohibit metal detecting</li><li>Extensive National Forest and BLM land follows federal rules</li><li>Rich gold rush and pioneer history</li><li>Beaches may have restrictions</li><li>Private land with permission is the best option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'WA', 'en', 'state_parks_wa', 'Washington State Parks', '<div class="legal-card legal-danger"><ul><li>Washington State Parks generally do not allow metal detecting</li><li>Some DNR-managed lands may have different policies</li><li>Check with individual land managers for current rules</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // West Virginia (WV)
            await insertLegal('US', 'WV', 'en', 'state_overview', 'West Virginia Overview', '<div class="legal-card legal-caution"><ul><li>State parks and forests have varying policies</li><li>Rich Civil War and coal mining history</li><li>Monongahela National Forest follows federal ARPA rules</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'WV', 'en', 'state_parks_wv', 'West Virginia State Parks', '<div class="legal-card legal-caution"><ul><li>Policies vary by park and forest</li><li>Some WV state parks and forests may allow detecting in limited areas</li><li>Contact individual park superintendents for current rules</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Wisconsin (WI)
            await insertLegal('US', 'WI', 'en', 'state_overview', 'Wisconsin Overview', '<div class="legal-card legal-caution"><ul><li>State parks and forests have varying policies</li><li>Rich fur trade, logging, and mining history</li><li>Effigy mounds and Native American sites are strictly protected</li><li>Private land with permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('US', 'WI', 'en', 'state_parks_wi', 'Wisconsin State Parks', '<div class="legal-card legal-caution"><ul><li>Wisconsin DNR policies vary by property</li><li>Some parks and forests may allow limited detecting</li><li>Effigy mounds and Native American burial sites are strictly protected under Wisconsin law</li><li>Contact individual park offices for current policies</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Wyoming (WY)
            await insertLegal('US', 'WY', 'en', 'state_overview', 'Wyoming Overview', '<div class="legal-card legal-ok"><ul><li>Generally favorable for metal detecting</li><li>Extensive BLM and National Forest land available</li><li>Gold prospecting popular in various areas</li><li>State trust lands may require permits</li><li>Rich frontier, mining, and ranching history</li></ul></div>', 'ok', 10, null, '2025-01-15');
            await insertLegal('US', 'WY', 'en', 'state_lands_wy', 'Wyoming State Lands', '<div class="legal-card legal-caution"><ul><li>Wyoming Office of State Lands and Investments manages trust lands</li><li>Recreational use policies vary by parcel</li><li>BLM and National Forest land is extensive and follows federal ARPA rules</li><li>Check for active mining claims before detecting</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // =====================================================
            // GB (GREAT BRITAIN) NATIONAL CONTENT
            // =====================================================
            await insertLegal('GB', null, 'en', 'treasure_act', 'Treasure Act 1996', '<div class="legal-card legal-warning"><p><strong>Key law for England, Wales &amp; Northern Ireland.</strong></p><ul><li>Any find qualifying as <strong>Treasure</strong> must be reported to the local coroner within <strong>14 days</strong></li><li>Treasure includes objects over 300 years old with 10%+ precious metal content</li><li>Hoards of coins over 300 years old also qualify as Treasure</li><li>Failure to report is a <strong>criminal offence</strong> — up to 3 months imprisonment or a fine</li><li>Museums may acquire Treasure items, with reward shared between finder and landowner</li><li>The reward is based on the full market value of the item</li></ul></div>', 'warning', 10, null, '2025-01-15');

            await insertLegal('GB', null, 'en', 'pas_scheme', 'Portable Antiquities Scheme (PAS)', '<div class="legal-card"><p>The PAS is a voluntary recording scheme run by the British Museum (England &amp; Wales).</p><ul><li>Encouraged to record <strong>all</strong> archaeological finds, not just those qualifying as Treasure</li><li>Your local Finds Liaison Officer (FLO) can identify and record finds for free</li><li>The PAS database is a major archaeological resource used by researchers</li><li>Recording finds helps build our understanding of British history</li><li>Find your local FLO at <strong>finds.org.uk</strong></li></ul></div>', null, 20, null, '2025-01-15');

            await insertLegal('GB', null, 'en', 'permissions_land', 'Permissions & Land Access', '<div class="legal-card legal-caution"><ul><li><strong>Always get landowner permission</strong> before detecting on any land</li><li><strong>Scheduled Monuments</strong> are strictly protected — detecting is illegal without consent from the relevant heritage body (Historic England, Cadw, or Historic Environment Scotland)</li><li>Sites of Special Scientific Interest (SSSI) may have additional restrictions</li><li>Many detectorists use a written finds agreement with landowners to clarify sharing arrangements</li><li>Beach below mean high water is generally permitted but check local bylaws</li><li>Crown Estate foreshore may require permission for organised events</li></ul></div>', 'caution', 30, null, '2025-01-15');

            await insertLegal('GB', null, 'en', 'scotland_law', 'Scotland', '<div class="legal-card legal-caution"><p><strong>Scotland has a different legal framework from England and Wales.</strong></p><ul><li>The Treasure Act does not apply in Scotland</li><li>All ownerless objects belong to the Crown (<em>bona vacantia</em>)</li><li>All finds of archaeological significance must be reported to the <strong>Treasure Trove Unit</strong></li><li>The Queen\'s and Lord Treasurer\'s Remembrancer (QLTR) decides allocation</li><li>Ex gratia rewards are paid to finders and landowners for claimed items</li><li>The system covers all archaeological finds, not just precious metals</li></ul></div>', 'caution', 40, null, '2025-01-15');

            await insertLegal('GB', null, 'en', 'beach_foreshore_gb', 'Beach & Foreshore Detecting', '<div class="legal-card legal-caution"><ul><li>The foreshore (between mean high and low water) is mostly owned by the <strong>Crown Estate</strong></li><li>The Crown Estate generally permits metal detecting on its foreshore for personal recreation</li><li>Some foreshore areas are leased to local authorities or private owners — check locally</li><li>Finds from the foreshore are still subject to the <strong>Treasure Act 1996</strong></li><li>Shipwreck material is protected under the <strong>Merchant Shipping Act 1995</strong> — report to the Receiver of Wreck</li><li>Protected wreck sites (designated under the Protection of Wrecks Act 1973) are strictly off-limits</li><li>Beach detecting is popular in Norfolk, Suffolk, Essex, Kent, and Devon</li><li>Scheduled Monuments on the foreshore have the same protections as inland sites</li></ul></div>', 'caution', 50, null, '2025-01-15');
            await insertLegal('GB', null, 'en', 'exporting_finds_gb', 'Exporting Finds from the UK', '<div class="legal-card legal-warning"><ul><li>Objects over <strong>50 years old</strong> and valued above certain thresholds require an <strong>export licence</strong></li><li>The Arts Council England (Reviewing Committee on the Export of Works of Art) administers export controls</li><li>Treasure items cannot be exported until the Treasure process is complete and items are disclaimed</li><li>Items designated as being of national importance may be subject to a <strong>temporary export bar</strong> to allow a UK museum to raise funds to acquire them</li><li>This applies to selling to overseas buyers as well as personally taking items abroad</li><li>Archaeological objects from Scotland must also clear the Treasure Trove process before export</li><li>Penalties for illegal export include fines and seizure of objects</li></ul></div>', 'warning', 60, null, '2025-01-15');
            await insertLegal('GB', null, 'en', 'insurance_liability_gb', 'Insurance & Liability', '<div class="legal-card legal-ok"><ul><li><strong>Public liability insurance</strong> is strongly recommended for all metal detectorists</li><li>Both the <strong>NCMD</strong> and <strong>FID</strong> (Federation of Independent Detectorists) offer membership that includes public liability insurance</li><li>Insurance typically covers up to &pound;5-10 million for accidental damage to property or injury to third parties</li><li>Many landowners now require proof of insurance before granting permission</li><li>Organised detecting rallies typically require all participants to have insurance</li><li>Insurance does not cover intentional damage, trespass, or detecting on restricted sites</li><li>Some policies also include cover for personal accident and equipment</li></ul></div>', 'ok', 70, null, '2025-01-15');

            // =====================================================
            // GB REGIONAL CONTENT
            // =====================================================

            // England (ENG)
            await insertLegal('GB', 'ENG', 'en', 'detecting_england', 'Detecting in England', '<div class="legal-card legal-ok"><ul><li>Metal detecting on private land with landowner permission is legal and widely practiced</li><li>Report Treasure finds to the local coroner within 14 days</li><li>Record finds with your local Finds Liaison Officer through the PAS</li><li>Follow the <strong>Code of Practice for Responsible Metal Detecting</strong> published by DCMS</li><li>Do not detect on Scheduled Monuments without consent from Historic England</li><li>England has one of the most supportive frameworks for responsible detecting in the world</li></ul></div>', 'ok', 10, null, '2025-01-15');

            // Scotland (SCT)
            await insertLegal('GB', 'SCT', 'en', 'detecting_scotland', 'Detecting in Scotland', '<div class="legal-card legal-caution"><ul><li>Different legal framework from England and Wales</li><li>All finds of archaeological significance must be reported to the <strong>Treasure Trove Unit</strong></li><li>Scottish Outdoor Access Code applies to land access</li><li>Permission from the landowner is still required specifically for metal detecting</li><li>Scheduled Monuments require consent from Historic Environment Scotland</li><li>Scottish Archaeological Finds Allocation Panel advises on disposition of finds</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // Wales (WLS)
            await insertLegal('GB', 'WLS', 'en', 'detecting_wales', 'Detecting in Wales', '<div class="legal-card legal-ok"><ul><li>Same Treasure Act framework as England</li><li>Report Treasure finds to the local coroner within 14 days</li><li>Amgueddfa Cymru / National Museum Wales is involved in the Treasure process</li><li>Follow the Code of Practice for Responsible Metal Detecting</li><li>Cadw manages Scheduled Monuments in Wales — detecting is prohibited without their consent</li><li>Record finds with your local Finds Liaison Officer</li></ul></div>', 'ok', 10, null, '2025-01-15');

            // Northern Ireland (NIR)
            await insertLegal('GB', 'NIR', 'en', 'detecting_nir', 'Detecting in Northern Ireland', '<div class="legal-card legal-caution"><ul><li>The Treasure Act applies but is administered differently from England and Wales</li><li>All archaeological objects must be reported under the Historic Monuments and Archaeological Objects (NI) Order 1995</li><li>More restrictive than England and Wales in practice</li><li>A licence may be required from the Department for Communities</li><li>Contact the Northern Ireland Environment Agency for guidance</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // --- England expanded ---
            await insertLegal('GB', 'ENG', 'en', 'code_of_practice_eng', 'Code of Practice for Responsible Metal Detecting', '<div class="legal-card legal-ok"><ul><li>The official <strong>Code of Practice for Responsible Metal Detecting in England and Wales</strong> was published by DCMS</li><li>Key principles: always get landowner permission, record finds with the PAS, report Treasure</li><li>Avoid Scheduled Monuments and other protected sites</li><li>Use a finds agreement with the landowner to clarify ownership and sharing of finds</li><li>Fill all holes, close gates, respect crops and livestock</li><li>The NCMD (National Council for Metal Detecting) promotes responsible detecting</li><li>Following the code helps protect the hobby and builds positive relationships with archaeologists</li></ul></div>', 'ok', 20, null, '2025-01-15');
            await insertLegal('GB', 'ENG', 'en', 'popular_areas_eng', 'Popular Detecting Areas in England', '<div class="legal-card legal-ok"><ul><li><strong>Norfolk &amp; Suffolk</strong> — consistently the highest PAS find counts; rich Roman, Saxon, and Viking history</li><li><strong>Hampshire &amp; Wiltshire</strong> — Roman roads, settlements, and medieval sites throughout</li><li><strong>Kent</strong> — Anglo-Saxon finds, Roman villas, and WWII military sites</li><li><strong>Lincolnshire</strong> — prolific for Roman and medieval coins and artefacts</li><li><strong>Yorkshire</strong> — Viking heritage, monastic sites, and Civil War battlefields</li><li><strong>Essex</strong> — Iron Age, Roman, and Saxon finds common</li><li>Always check that specific sites are not Scheduled Monuments before detecting</li><li>Organised detecting rallies are popular — clubs often arrange permission on large estates</li></ul></div>', 'ok', 30, null, '2025-01-15');
            await insertLegal('GB', 'ENG', 'en', 'scheduled_monuments_eng', 'Scheduled Monuments in England', '<div class="legal-card legal-danger"><ul><li>There are over <strong>19,800 Scheduled Monuments</strong> in England</li><li>It is a <strong>criminal offence</strong> to use a metal detector on a Scheduled Monument without consent from Historic England</li><li>Penalties include fines and imprisonment</li><li>Scheduled Monuments are not always visually obvious — they can be buried features with no surface markers</li><li>Check the <strong>National Heritage List for England</strong> at historicengland.org.uk before detecting in any new area</li><li>Consent is rarely granted for metal detecting on Scheduled Monuments</li></ul></div>', 'danger', 40, null, '2025-01-15');

            // --- Scotland expanded ---
            await insertLegal('GB', 'SCT', 'en', 'treasure_trove_process_sct', 'Treasure Trove Process in Scotland', '<div class="legal-card legal-warning"><ul><li>All ownerless objects found in Scotland belong to the Crown under <em>bona vacantia</em></li><li>Finders must report all archaeological objects to the <strong>Treasure Trove Unit</strong> (TTU)</li><li>The TTU assesses finds and the <strong>Scottish Archaeological Finds Allocation Panel</strong> (SAFAP) recommends allocation to museums</li><li>The Queen\'s and Lord Treasurer\'s Remembrancer (QLTR) makes the final decision</li><li>Ex gratia rewards are paid based on the circumstances of the find</li><li>Reporting is legally required — failure to report can result in prosecution</li><li>Report finds online at <strong>treasuretrovescotland.co.uk</strong></li></ul></div>', 'warning', 20, null, '2025-01-15');
            await insertLegal('GB', 'SCT', 'en', 'access_rights_sct', 'Land Access Rights in Scotland', '<div class="legal-card legal-caution"><ul><li>The <strong>Land Reform (Scotland) Act 2003</strong> provides a right of responsible access to most land</li><li>However, the right of access covers walking and recreation — it does <strong>not</strong> automatically include metal detecting</li><li>Landowner permission is still required specifically for metal detecting</li><li>The <strong>Scottish Outdoor Access Code</strong> provides guidance on responsible access</li><li>Scheduled Monuments require consent from <strong>Historic Environment Scotland</strong></li><li>Farmland should be avoided during growing and harvesting seasons unless the farmer agrees</li></ul></div>', 'caution', 30, null, '2025-01-15');

            // --- Wales expanded ---
            await insertLegal('GB', 'WLS', 'en', 'cadw_wls', 'Cadw & Scheduled Monuments in Wales', '<div class="legal-card legal-danger"><ul><li><strong>Cadw</strong> is the Welsh Government\'s historic environment service</li><li>Wales has over <strong>4,200 Scheduled Monuments</strong></li><li>Metal detecting on a Scheduled Monument without Cadw consent is a <strong>criminal offence</strong></li><li>The <strong>Coflein</strong> database (maintained by the Royal Commission on Ancient and Historical Monuments of Wales) records known sites</li><li>Hillforts, Roman forts, medieval castles, and burial mounds are commonly scheduled</li><li>Check with Cadw and Coflein before detecting in any new area in Wales</li></ul></div>', 'danger', 20, null, '2025-01-15');
            await insertLegal('GB', 'WLS', 'en', 'popular_areas_wls', 'Popular Detecting Areas in Wales', '<div class="legal-card legal-ok"><ul><li><strong>Vale of Glamorgan</strong> — Roman and medieval finds, good agricultural land</li><li><strong>Pembrokeshire</strong> — Viking, Norman, and medieval history; coastal finds</li><li><strong>Powys</strong> — extensive pastoral land with Roman road networks and medieval sites</li><li><strong>North Wales coast</strong> — medieval and post-medieval finds, beach detecting opportunities</li><li>Wales has a strong detecting community with active clubs and rallies</li><li>Record finds with the PAS — Wales has dedicated Finds Liaison Officers</li></ul></div>', 'ok', 30, null, '2025-01-15');

            // --- Northern Ireland expanded ---
            await insertLegal('GB', 'NIR', 'en', 'licensing_nir', 'Licensing Requirements in Northern Ireland', '<div class="legal-card legal-warning"><ul><li>Metal detecting in Northern Ireland may require a <strong>licence</strong> from the Department for Communities</li><li>The <strong>Historic Monuments and Archaeological Objects (NI) Order 1995</strong> is the key legislation</li><li>All archaeological objects found in Northern Ireland must be reported</li><li>Objects over 200 years old (or items associated with a protected site) must be reported within 14 days</li><li>The licensing system is more restrictive than England and Wales</li><li>Unlicensed detecting may result in prosecution</li><li>Contact the Historic Environment Division for current licensing requirements</li></ul></div>', 'warning', 20, null, '2025-01-15');
            await insertLegal('GB', 'NIR', 'en', 'protected_places_nir', 'Protected Places in Northern Ireland', '<div class="legal-card legal-danger"><ul><li>Northern Ireland has over <strong>1,900 Scheduled Historic Monuments</strong></li><li>Metal detecting on or near a Scheduled Monument without consent is a <strong>criminal offence</strong></li><li>Areas of Significant Archaeological Interest (ASAIs) provide additional protections</li><li>Northern Ireland Sites and Monuments Record (NISMR) lists known archaeological sites</li><li>Historic parks, gardens, and demesnes may have additional restrictions</li><li>The Giant\'s Causeway and surrounding areas are strictly protected</li><li>Always check with the Historic Environment Division before detecting in a new area</li></ul></div>', 'danger', 30, null, '2025-01-15');

            // =====================================================
            // AU (AUSTRALIA) NATIONAL CONTENT
            // =====================================================
            await insertLegal('AU', null, 'en', 'au_overview', 'General Overview', '<div class="legal-card legal-caution"><ul><li>Metal detecting laws are governed at the <strong>state and territory level</strong></li><li>Each state has its own heritage protection legislation</li><li>Aboriginal and Torres Strait Islander heritage is protected under both state and federal law</li><li>Gold prospecting with metal detectors is popular in Victoria, Western Australia, and Queensland</li><li>Always check state-specific rules before detecting</li></ul></div>', 'caution', 10, null, '2025-01-15');

            await insertLegal('AU', null, 'en', 'au_protected', 'Protected Areas', '<div class="legal-card legal-danger"><ul><li><strong>National parks and nature reserves</strong> — metal detecting is prohibited in all states</li><li><strong>Aboriginal heritage sites</strong> — strictly protected under state and federal law</li><li><strong>Historic heritage sites</strong> on Commonwealth or state registers are off-limits</li><li><strong>Shipwreck sites</strong> — protected under the Historic Shipwrecks Act 1976</li><li>Penalties for violations can be severe, including imprisonment</li></ul></div>', 'danger', 20, null, '2025-01-15');

            await insertLegal('AU', null, 'en', 'au_state_differences', 'Key State Differences', '<div class="legal-card legal-caution"><ul><li><strong>Victoria</strong> — requires a Miner\'s Right for Crown land gold prospecting</li><li><strong>Western Australia</strong> — requires a Miner\'s Right; some areas need additional permits</li><li><strong>Queensland</strong> — needs a fossicking licence for detecting on certain land</li><li><strong>NSW</strong> — no specific licence for private land with permission; national parks prohibited</li><li><strong>South Australia</strong> — permit required for fossicking on Crown land</li><li><strong>Tasmania</strong> — mineral exploration regulations apply</li><li>Other states and territories vary — always check locally</li></ul></div>', 'caution', 30, null, '2025-01-15');

            await insertLegal('AU', null, 'en', 'beach_foreshore_au', 'Beach & Foreshore Detecting', '<div class="legal-card legal-caution"><ul><li>Beach access and detecting rules vary by <strong>state and local council</strong></li><li>Most beaches are managed by local councils — check their bylaws</li><li>Beaches within national parks or marine parks are <strong>off-limits</strong></li><li>Aboriginal heritage sites on beaches are strictly protected</li><li>Shipwreck artifacts are protected under the <strong>Historic Shipwrecks Act 1976</strong> (federal) and state equivalents</li><li>Protected zones around historic shipwrecks extend to 200 metres — detecting prohibited within these zones</li><li>Popular beach detecting areas include Gold Coast (QLD), Bondi (NSW), and St Kilda (VIC)</li><li>After storms and king tides is the best time for beach detecting</li></ul></div>', 'caution', 40, null, '2025-01-15');
            await insertLegal('AU', null, 'en', 'reporting_finds_au', 'Reporting Significant Finds', '<div class="legal-card legal-caution"><ul><li>Requirements to report finds vary by state — check your state\'s heritage legislation</li><li><strong>Aboriginal heritage objects</strong> must be reported to the relevant state authority in all states</li><li>Disturbing Aboriginal heritage items without authorisation is a <strong>criminal offence</strong> with severe penalties</li><li>Items that may be from <strong>shipwrecks</strong> must be reported under the Historic Shipwrecks Act</li><li>Gold nuggets found on Crown land must generally be declared under the terms of your Miner\'s Right or licence</li><li>If you find <strong>human remains</strong>, stop immediately and contact police</li><li>Consider reporting significant finds to your state museum or heritage council</li></ul></div>', 'caution', 50, null, '2025-01-15');
            await insertLegal('AU', null, 'en', 'ethics_au', 'Code of Conduct & Ethics', '<div class="legal-card legal-ok"><ul><li><strong>Always get permission</strong> before detecting on any land — verbal or written</li><li><strong>Fill all holes</strong> and leave the ground as you found it</li><li>Respect Aboriginal and Torres Strait Islander cultural heritage at all times</li><li>Pack out all rubbish — leave sites cleaner than you found them</li><li>Report significant finds to relevant authorities</li><li>Respect the bush — do not damage vegetation, disturb wildlife, or light fires</li><li>Join a local detecting club — they promote responsible practices and often organise group permissions</li><li>The <strong>Australian Metal Detecting Community</strong> promotes ethical detecting practices</li></ul></div>', 'ok', 60, null, '2025-01-15');

            // =====================================================
            // AU REGIONAL CONTENT
            // =====================================================

            // Victoria (VIC)
            await insertLegal('AU', 'VIC', 'en', 'detecting_vic', 'Detecting in Victoria', '<div class="legal-card legal-ok"><ul><li><strong>Miner\'s Right</strong> required for gold prospecting on Crown land (available from Earth Resources)</li><li>Allows searching with a metal detector and hand tools on Crown land</li><li>Cannot detect in national parks, state parks, or reference areas</li><li>Private land requires landowner permission</li><li>Victoria\'s goldfields region is one of the most popular detecting areas in Australia</li><li>Heritage sites and Aboriginal cultural heritage sites are strictly protected</li></ul></div>', 'ok', 10, null, '2025-01-15');

            // Western Australia (WA)
            await insertLegal('AU', 'WA', 'en', 'detecting_wa', 'Detecting in Western Australia', '<div class="legal-card legal-ok"><ul><li><strong>Miner\'s Right</strong> required for prospecting on Crown land</li><li>Very popular gold prospecting areas in the Goldfields-Esperance region</li><li>Some areas require additional exploration licences</li><li>Cannot detect in national parks or Aboriginal heritage sites</li><li>Check for pastoral lease requirements in remote areas</li><li>WA has some of the best gold detecting opportunities in the world</li></ul></div>', 'ok', 10, null, '2025-01-15');

            // Queensland (QLD)
            await insertLegal('AU', 'QLD', 'en', 'detecting_qld', 'Detecting in Queensland', '<div class="legal-card legal-caution"><ul><li><strong>Fossicking licence</strong> required for metal detecting on certain land types</li><li>Available from the Department of Resources</li><li>Designated fossicking areas are available throughout Queensland</li><li>Cannot detect in national parks or World Heritage areas</li><li>Gold prospecting popular in North Queensland</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // New South Wales (NSW)
            await insertLegal('AU', 'NSW', 'en', 'detecting_nsw', 'Detecting in New South Wales', '<div class="legal-card legal-caution"><ul><li>No specific licence required for detecting on private land with landowner permission</li><li>National parks and reserves are strictly prohibited</li><li>Heritage items are protected under the Heritage Act</li><li>Fossicking regulations apply on Crown land</li><li>State forests may have specific rules — check with Forestry Corporation of NSW</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // South Australia (SA)
            await insertLegal('AU', 'SA', 'en', 'detecting_sa', 'Detecting in South Australia', '<div class="legal-card legal-caution"><ul><li>Precious Stones Act regulates fossicking and prospecting</li><li>Permit required for fossicking on Crown land</li><li>Cannot detect in national parks, conservation parks, or Aboriginal heritage sites</li><li>Private land requires landowner permission</li><li>Some designated fossicking areas available</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // Tasmania (TAS)
            await insertLegal('AU', 'TAS', 'en', 'detecting_tas', 'Detecting in Tasmania', '<div class="legal-card legal-caution"><ul><li>Mineral exploration regulations apply to metal detecting</li><li>Cannot detect in national parks, reserves, or World Heritage areas</li><li>Aboriginal heritage is strictly protected under the Aboriginal Heritage Act</li><li>Private land with landowner permission is the best option</li><li>Check with Mineral Resources Tasmania for current regulations</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // =====================================================
            // CA (CANADA) NATIONAL CONTENT
            // =====================================================
            await insertLegal('CA', null, 'en', 'ca_overview', 'General Overview', '<div class="legal-card legal-caution"><ul><li>Metal detecting laws vary by <strong>province and territory</strong></li><li>Federal lands (national parks, national historic sites) strictly prohibit detecting</li><li>First Nations heritage sites are protected under both federal and provincial law</li><li>Provincial Crown land rules vary significantly</li><li>Private land with landowner permission is generally the safest option</li></ul></div>', 'caution', 10, null, '2025-01-15');

            await insertLegal('CA', null, 'en', 'ca_federal', 'Federal Protected Areas', '<div class="legal-card legal-danger"><ul><li>National parks and national historic sites — metal detecting is <strong>strictly prohibited</strong></li><li>Canada National Parks Act protects all natural and cultural resources</li><li>Heavy fines for violations</li><li>Parks Canada enforces regulations aggressively</li><li>All archaeological resources on federal land are protected</li></ul></div>', 'danger', 20, null, '2025-01-15');

            await insertLegal('CA', null, 'en', 'beach_foreshore_ca', 'Beach & Foreshore Detecting', '<div class="legal-card legal-caution"><ul><li>Beach access and detecting rules vary by <strong>province and municipality</strong></li><li>Federal Crown foreshore is managed by the Department of Fisheries and Oceans — detecting may be restricted</li><li>Provincial and municipal beaches have their own rules — check local bylaws</li><li>Beaches within national or provincial parks are <strong>off-limits</strong></li><li>Shipwreck artifacts in Canadian waters are protected under the <strong>Canada Shipping Act</strong></li><li>Receiver of Wreck must be notified of any wreck material found</li><li>Popular beach detecting areas include the Maritimes, Great Lakes shoreline, and BC coast</li><li>First Nations cultural sites along coastlines are strictly protected</li></ul></div>', 'caution', 30, null, '2025-01-15');
            await insertLegal('CA', null, 'en', 'reporting_finds_ca', 'Reporting Significant Finds', '<div class="legal-card legal-caution"><ul><li>Reporting requirements vary by province — check your provincial heritage legislation</li><li><strong>First Nations heritage objects</strong> must be reported to the relevant authority in all provinces</li><li>Disturbing First Nations heritage sites is a <strong>criminal offence</strong> under both federal and provincial law</li><li>Shipwreck material must be reported to the <strong>Receiver of Wreck</strong></li><li>If you find <strong>human remains</strong>, stop immediately and contact local police</li><li>Provincial archaeologists or heritage offices generally welcome reports of significant finds</li><li>Documenting and photographing finds in context adds historical value</li></ul></div>', 'caution', 40, null, '2025-01-15');
            await insertLegal('CA', null, 'en', 'ethics_ca', 'Code of Conduct & Ethics', '<div class="legal-card legal-ok"><ul><li><strong>Always get permission</strong> before detecting on any land</li><li><strong>Fill all holes</strong> and leave the ground as you found it or better</li><li>Respect First Nations cultural heritage and sacred sites</li><li>Pack out all rubbish and junk targets</li><li>Follow all provincial park and conservation area rules</li><li>Report significant finds to local heritage authorities</li><li>Join the <strong>Canadian Metal Detecting community</strong> — local clubs promote responsible practices</li><li>Carry written permission when detecting on private land</li><li>Close gates, respect crops and livestock, and leave property as you found it</li></ul></div>', 'ok', 50, null, '2025-01-15');

            // =====================================================
            // CA REGIONAL CONTENT
            // =====================================================

            // Ontario (ON)
            await insertLegal('CA', 'ON', 'en', 'detecting_on', 'Detecting in Ontario', '<div class="legal-card legal-caution"><ul><li>Ontario Heritage Act protects archaeological sites</li><li>Archaeological licence required for any systematic archaeological survey</li><li>Casual detecting on private land with permission is generally acceptable</li><li>Provincial parks prohibit metal detecting</li><li>Marine heritage is protected under Ontario law</li><li>Contact the Ministry of Citizenship and Multiculturalism for guidance</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // British Columbia (BC)
            await insertLegal('CA', 'BC', 'en', 'detecting_bc', 'Detecting in British Columbia', '<div class="legal-card legal-caution"><ul><li>Heritage Conservation Act protects archaeological sites</li><li>Provincial parks prohibit metal detecting</li><li>Crown land detecting may require mineral tenure or permit</li><li>Private land with landowner permission is the safest option</li><li>First Nations cultural sites are strictly protected</li><li>Gold panning popular in the Fraser River and Cariboo regions</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // Alberta (AB)
            await insertLegal('CA', 'AB', 'en', 'detecting_ab', 'Detecting in Alberta', '<div class="legal-card legal-caution"><ul><li>Historical Resources Act protects archaeological and palaeontological sites</li><li>Provincial parks prohibit metal detecting</li><li>Public land policies vary — check with the local land manager</li><li>Private land with landowner permission is the primary option</li><li>Report significant finds to Alberta Culture and Status of Women</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // Quebec (QC)
            await insertLegal('CA', 'QC', 'en', 'detecting_qc', 'Detecting in Quebec', '<div class="legal-card legal-caution"><ul><li>Cultural Heritage Act (<em>Loi sur le patrimoine culturel</em>) protects archaeological sites</li><li>Provincial parks prohibit metal detecting</li><li>Archaeological permit required for any excavation</li><li>Private land with landowner permission is the primary option</li><li>Rich French colonial history provides many potential sites</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // Manitoba (MB)
            await insertLegal('CA', 'MB', 'en', 'detecting_mb', 'Detecting in Manitoba', '<div class="legal-card legal-caution"><ul><li>The Heritage Resources Act protects archaeological sites and objects</li><li>Provincial parks and heritage sites prohibit metal detecting</li><li>Private land with landowner permission is the primary option</li><li>Crown land detecting may require permission from the provincial government</li><li>First Nations heritage sites are strictly protected</li><li>Report significant historical finds to the Historic Resources Branch</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('CA', 'MB', 'en', 'crown_land_mb', 'Manitoba Crown Land', '<div class="legal-card legal-caution"><ul><li>Manitoba has extensive Crown land, particularly in the north</li><li>Detecting on Crown land may require authorization from Manitoba Conservation</li><li>Wildlife Management Areas have additional restrictions</li><li>Gold prospecting is not a major activity in Manitoba</li><li>Always check for active mining claims or permits in the area</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Saskatchewan (SK)
            await insertLegal('CA', 'SK', 'en', 'detecting_sk', 'Detecting in Saskatchewan', '<div class="legal-card legal-caution"><ul><li>The Heritage Property Act protects archaeological sites and objects</li><li>Provincial parks prohibit metal detecting</li><li>Private land with landowner permission is the safest option</li><li>Crown land rules vary — check with the Ministry of Parks, Culture and Sport</li><li>First Nations heritage sites are protected under provincial and federal law</li><li>Saskatchewan\'s prairie history offers potential for homestead and settlement-era finds</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('CA', 'SK', 'en', 'crown_land_sk', 'Saskatchewan Crown Land', '<div class="legal-card legal-caution"><ul><li>Saskatchewan has significant Crown land in the northern regions</li><li>Southern agricultural Crown land is often leased to farmers — get leaseholder permission</li><li>Provincial forests and grasslands have their own regulations</li><li>Surface Rights Board may be relevant for Crown land access issues</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // Nova Scotia (NS)
            await insertLegal('CA', 'NS', 'en', 'detecting_ns', 'Detecting in Nova Scotia', '<div class="legal-card legal-caution"><ul><li>The Special Places Protection Act covers archaeological sites and objects</li><li>Heritage research permits are required for any archaeological work</li><li>Provincial parks prohibit metal detecting</li><li>Private land with landowner permission is the primary option</li><li>Rich maritime and colonial history — many potential sites from the 1600s onward</li><li>Oak Island and treasure hunting have a long history in the province</li><li>Beach detecting is popular but foreshore ownership varies</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('CA', 'NS', 'en', 'beaches_ns', 'Nova Scotia Beaches & Foreshore', '<div class="legal-card legal-caution"><ul><li>Beach detecting is popular along Nova Scotia\'s extensive coastline</li><li>Provincial beaches may have restrictions — check with Parks Nova Scotia</li><li>Foreshore (tidal zone) is generally Crown land</li><li>Shipwreck artifacts are protected under federal and provincial law</li><li>Report any finds that may be from shipwrecks to the Receiver of Wreck</li></ul></div>', 'caution', 20, null, '2025-01-15');

            // New Brunswick (NB)
            await insertLegal('CA', 'NB', 'en', 'detecting_nb', 'Detecting in New Brunswick', '<div class="legal-card legal-caution"><ul><li>The Heritage Conservation Act protects archaeological sites</li><li>Archaeological permits are required for excavation or systematic survey</li><li>Provincial parks prohibit metal detecting</li><li>Private land with landowner permission is the safest option</li><li>Crown land (about 50% of province) — check with the Department of Natural Resources</li><li>Bilingual province with rich Acadian and Loyalist history</li><li>Beach detecting popular along the Bay of Fundy coast</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // Prince Edward Island (PE)
            await insertLegal('CA', 'PE', 'en', 'detecting_pe', 'Detecting in Prince Edward Island', '<div class="legal-card legal-caution"><ul><li>The Archaeological Sites Protection Act protects known archaeological sites</li><li>Provincial parks prohibit metal detecting</li><li>Private land with landowner permission is the primary option</li><li>PEI is small but has significant colonial and Mi\'kmaq heritage</li><li>Beach detecting is popular — PEI has extensive sandy beaches</li><li>Respect protected areas and National Historic Sites (e.g., Province House)</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // Newfoundland and Labrador (NL)
            await insertLegal('CA', 'NL', 'en', 'detecting_nl', 'Detecting in Newfoundland and Labrador', '<div class="legal-card legal-warning"><ul><li>The Historic Resources Act provides strong protection for archaeological sites</li><li>All archaeological objects found on Crown land belong to the province</li><li>Provincial parks and protected areas strictly prohibit detecting</li><li>Private land with landowner permission is the safest option</li><li>Viking, Basque, and early colonial sites are heavily protected</li><li>L\'Anse aux Meadows and Red Bay are UNESCO World Heritage Sites — strictly off-limits</li><li>Report any significant finds to the Provincial Archaeology Office</li></ul></div>', 'warning', 10, null, '2025-01-15');
            await insertLegal('CA', 'NL', 'en', 'heritage_nl', 'Newfoundland Heritage Sites', '<div class="legal-card legal-danger"><ul><li>Newfoundland has some of the oldest European settlement sites in North America</li><li>UNESCO sites (L\'Anse aux Meadows, Red Bay) are strictly protected — no detecting</li><li>Numerous designated Provincial Historic Sites throughout the province</li><li>Indigenous heritage sites (Innu, Inuit, Mi\'kmaq, Beothuk) are strictly protected</li><li>Signal Hill, Cape Spear, and other national historic sites are federal land — prohibited</li></ul></div>', 'danger', 20, null, '2025-01-15');

            // Yukon (YT)
            await insertLegal('CA', 'YT', 'en', 'detecting_yt', 'Detecting in Yukon', '<div class="legal-card legal-caution"><ul><li>The Historic Resources Act protects archaeological sites and objects</li><li>Territorial parks and heritage sites prohibit metal detecting</li><li>First Nations Final Agreement lands require permission from the relevant First Nation</li><li>Crown land detecting may be possible — check with Yukon Heritage Resources</li><li>Klondike Gold Rush history makes the territory attractive for prospectors</li><li>Gold panning and small-scale prospecting are popular activities</li><li>Placer mining claims are common — do not detect on active claims without permission</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('CA', 'YT', 'en', 'gold_prospecting_yt', 'Yukon Gold Prospecting', '<div class="legal-card legal-ok"><ul><li>Recreational gold panning is permitted on most Crown land streams and rivers</li><li>Dawson City and the Klondike region are the most popular prospecting areas</li><li>A free miner\'s certificate may be required for more intensive prospecting</li><li>Must respect active mining claims — check the Yukon Mining Recorder</li><li>Metal detectors are commonly used for gold nugget hunting</li><li>Remote areas require bear safety awareness and preparation</li></ul></div>', 'ok', 20, null, '2025-01-15');

            // Northwest Territories (NT)
            await insertLegal('CA', 'NT', 'en', 'detecting_nt', 'Detecting in Northwest Territories', '<div class="legal-card legal-warning"><ul><li>The Archaeological Sites Regulations protect archaeological sites and objects</li><li>NWT is largely unsettled — very limited detecting opportunities</li><li>Indigenous heritage sites are strictly protected</li><li>Territorial parks and protected areas prohibit detecting</li><li>Land claim settlement areas require permission from the relevant Indigenous government</li><li>Yellowknife area has some gold prospecting history</li><li>Extreme remoteness and climate make detecting impractical in most areas</li></ul></div>', 'warning', 10, null, '2025-01-15');

            // Nunavut (NU)
            await insertLegal('CA', 'NU', 'en', 'detecting_nu', 'Detecting in Nunavut', '<div class="legal-card legal-danger"><ul><li>The Nunavut Archaeological and Palaeontological Sites Regulations protect all sites</li><li>Inuit heritage is paramount — Inuit Impact and Benefit Agreements may apply</li><li>Virtually all land is subject to the Nunavut Land Claims Agreement</li><li>Permits required for any archaeological activity from the Government of Nunavut</li><li>No public road system — access is by air or sea only</li><li>Extreme climate makes metal detecting impractical for most of the year</li><li>Respect for Inuit cultural heritage is essential in all activities</li></ul></div>', 'danger', 10, null, '2025-01-15');

            // =====================================================
            // NZ (NEW ZEALAND) NATIONAL CONTENT
            // =====================================================
            await insertLegal('NZ', null, 'en', 'nz_overview', 'General Overview', '<div class="legal-card legal-caution"><ul><li>Heritage New Zealand Pouhere Taonga Act 2014 protects archaeological sites</li><li>All <strong>pre-1900 archaeological sites</strong> are automatically protected regardless of land ownership</li><li>M\u0101ori heritage and w\u0101hi tapu (sacred places) are strictly protected</li><li>Department of Conservation (DOC) land generally prohibits detecting</li><li>Private land with landowner permission is the primary option</li></ul></div>', 'caution', 10, null, '2025-01-15');

            await insertLegal('NZ', null, 'en', 'nz_protected', 'Protected Areas & Heritage', '<div class="legal-card legal-danger"><ul><li>DOC-managed conservation land prohibits metal detecting</li><li>All archaeological sites (pre-1900) are protected regardless of land ownership</li><li>Disturbing any archaeological site without an authority from Heritage New Zealand is an offence</li><li>M\u0101ori cultural sites and burial grounds (<em>ur\u016bp\u0101</em>) are strictly protected</li><li>Penalties can include fines up to $300,000 and imprisonment</li></ul></div>', 'danger', 20, null, '2025-01-15');

            await insertLegal('NZ', null, 'en', 'nz_goldfields', 'Gold Prospecting', '<div class="legal-card legal-caution"><ul><li>Gold panning and prospecting is popular in Otago and West Coast regions</li><li>Mineral permits may be required on Crown land</li><li>Cannot prospect in conservation areas, national parks, or DOC reserves</li><li>Check with NZ Petroleum and Minerals for permit requirements</li><li>Historic goldfield areas may contain protected archaeological sites</li></ul></div>', 'caution', 30, null, '2025-01-15');

            await insertLegal('NZ', null, 'en', 'beach_foreshore_nz', 'Beach & Foreshore Detecting', '<div class="legal-card legal-caution"><ul><li>Most New Zealand beaches are <strong>public</strong> — the foreshore is generally Crown-owned</li><li>Beach detecting is one of the most popular forms of metal detecting in New Zealand</li><li>Beaches within DOC reserves or national parks are <strong>off-limits</strong></li><li>M\u0101ori cultural sites along the coast (middens, p\u0101 sites, w\u0101hi tapu) are <strong>strictly protected</strong></li><li>Shipwreck material is protected — report to Heritage New Zealand or Maritime New Zealand</li><li>Local council bylaws may restrict detecting on specific beaches</li><li>Popular beach detecting areas include Auckland beaches, Bay of Plenty, and Christchurch coast</li><li>Do not dig in sand dunes or disturb coastal vegetation</li></ul></div>', 'caution', 40, null, '2025-01-15');
            await insertLegal('NZ', null, 'en', 'reporting_finds_nz', 'Reporting Finds', '<div class="legal-card legal-warning"><ul><li>All <strong>pre-1900 archaeological sites and objects</strong> are automatically protected under the Heritage New Zealand Pouhere Taonga Act 2014</li><li>Disturbing any archaeological site without authority from Heritage New Zealand is an <strong>offence</strong></li><li>If you find anything that appears to be pre-1900, <strong>stop and report</strong> to Heritage New Zealand</li><li>M\u0101ori cultural objects (taonga) must be reported — they may be subject to specific cultural protocols</li><li>If you find <strong>human remains</strong> (k\u014Diwi tangata), stop immediately and contact police — do not disturb the area</li><li>Shipwreck material must be reported to Maritime New Zealand</li><li>Heritage New Zealand maintains the <strong>New Zealand Heritage List</strong> — check it for known sites</li></ul></div>', 'warning', 50, null, '2025-01-15');
            await insertLegal('NZ', null, 'en', 'ethics_nz', 'Code of Conduct & Ethics', '<div class="legal-card legal-ok"><ul><li><strong>Always get permission</strong> before detecting on any land — private or public</li><li><strong>Fill all holes</strong> and leave the ground as you found it</li><li>Respect M\u0101ori cultural heritage, w\u0101hi tapu, and k\u014Diwi tangata at all times</li><li>If in doubt about a find\'s age or significance, report it</li><li>Pack out all rubbish and leave detecting sites cleaner than you found them</li><li>Do not detect on DOC conservation land, even if there are no signs</li><li>Join the <strong>New Zealand Metal Detecting community</strong> for guidance and group permissions</li><li>Follow the principle of <strong>kaitiakitanga</strong> (guardianship) — care for the land and its heritage</li></ul></div>', 'ok', 60, null, '2025-01-15');

            // =====================================================
            // NZ REGIONAL CONTENT
            // =====================================================

            // Otago (OTA)
            await insertLegal('NZ', 'OTA', 'en', 'detecting_ota', 'Detecting in Otago', '<div class="legal-card legal-caution"><ul><li>Otago is New Zealand\'s most popular region for gold prospecting with metal detectors</li><li>The historic goldfields around Arrowtown, Cromwell, and the Shotover River attract prospectors worldwide</li><li>DOC-managed conservation land prohibits detecting — check land status carefully</li><li>Private land with landowner permission is the safest option</li><li>Many pre-1900 gold mining sites are <strong>automatically protected</strong> archaeological sites</li><li>Heritage New Zealand authority required before disturbing any archaeological site</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('NZ', 'OTA', 'en', 'goldfields_ota', 'Otago Goldfields', '<div class="legal-card legal-warning"><ul><li>The Central Otago goldfields are a significant heritage landscape</li><li>Many sites from the 1860s gold rush are protected archaeological sites (pre-1900)</li><li>Chinese miners\' settlements are particularly significant heritage sites</li><li>Some areas are designated heritage precincts with additional protections</li><li>Recreational gold panning may be permitted in some rivers — check with the regional council</li><li>Always verify land status before detecting — much of Central Otago is a mix of DOC, Crown pastoral lease, and private land</li></ul></div>', 'warning', 20, null, '2025-01-15');

            // West Coast (WTC)
            await insertLegal('NZ', 'WTC', 'en', 'detecting_wtc', 'Detecting on the West Coast', '<div class="legal-card legal-caution"><ul><li>The West Coast has a rich gold mining history dating from the 1860s</li><li>Large areas of DOC conservation land — detecting is <strong>prohibited</strong> on all DOC land</li><li>Private land with landowner permission is the primary option</li><li>Recreational gold panning is popular in rivers like the Grey, Buller, and their tributaries</li><li>Pre-1900 mining sites are protected archaeological sites — do not disturb</li><li>The West Coast is one of New Zealand\'s wettest regions — plan accordingly</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('NZ', 'WTC', 'en', 'goldfields_wtc', 'West Coast Goldfields', '<div class="legal-card legal-warning"><ul><li>Historic goldfields at Reefton, Ross, Greymouth, and Hokitika areas</li><li>Shantytown Heritage Park preserves gold rush history — detecting not permitted</li><li>Active mining operations exist — check for mining permits and licences in the area</li><li>Some rivers allow recreational gold panning under specific conditions</li><li>NZ Petroleum &amp; Minerals (NZP&amp;M) administers mineral permits on Crown land</li></ul></div>', 'warning', 20, null, '2025-01-15');

            // Canterbury (CAN)
            await insertLegal('NZ', 'CAN', 'en', 'detecting_can', 'Detecting in Canterbury', '<div class="legal-card legal-caution"><ul><li>Canterbury is New Zealand\'s largest region, with diverse detecting opportunities</li><li>Private farmland with permission is the primary option — Canterbury has extensive pastoral land</li><li>Christchurch and its surroundings have colonial-era history from the 1850s</li><li>Banks Peninsula has early whaling and colonial settlement sites — many are pre-1900 and protected</li><li>DOC land (including Arthur\'s Pass National Park) prohibits detecting</li><li>Beach detecting along the Canterbury coast is popular but check local council bylaws</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // Auckland (AUK)
            await insertLegal('NZ', 'AUK', 'en', 'detecting_auk', 'Detecting in Auckland', '<div class="legal-card legal-caution"><ul><li>Auckland is New Zealand\'s largest city — many urban parks and beaches for detecting</li><li>Auckland Council manages parks and reserves — check bylaws for each location</li><li>Beach detecting is popular on west coast beaches (Piha, Muriwai) and east coast beaches</li><li>M\u0101ori heritage sites and p\u0101 sites are numerous and strictly protected</li><li>Volcanic cones (maunga) are sacred to Ng\u0101 Mana Whenua and are <strong>off-limits</strong></li><li>Regional parks may have specific rules — check with Auckland Council beforehand</li><li>Hauraki Gulf islands are largely DOC-managed — detecting prohibited</li></ul></div>', 'caution', 10, null, '2025-01-15');
            await insertLegal('NZ', 'AUK', 'en', 'beaches_auk', 'Auckland Beach Detecting', '<div class="legal-card legal-ok"><ul><li>Auckland\'s many beaches are among the most popular detecting locations in New Zealand</li><li>Wet sand detecting after storms can be particularly productive</li><li>Mission Bay, Takapuna, and Orewa are popular beach detecting spots</li><li>Check Auckland Council bylaws — some beaches may have seasonal restrictions</li><li>Do not dig on dunes or disturb protected coastal vegetation</li><li>Always fill holes and remove all trash — leave the beach cleaner than you found it</li></ul></div>', 'ok', 20, null, '2025-01-15');

            // Bay of Plenty (BOP)
            await insertLegal('NZ', 'BOP', 'en', 'detecting_bop', 'Detecting in Bay of Plenty', '<div class="legal-card legal-caution"><ul><li>Bay of Plenty has popular beach detecting along Tauranga, Mount Maunganui, and Whakatane</li><li>M\u0101ori heritage is very significant in this region — many p\u0101 and w\u0101hi tapu sites</li><li>Mauao (Mount Maunganui) is a significant cultural landmark — detecting prohibited</li><li>DOC-managed areas including Te Urewera are off-limits</li><li>Private land with landowner permission is the safest option for inland detecting</li><li>Beach detecting after summer tourist season can yield interesting modern finds</li></ul></div>', 'caution', 10, null, '2025-01-15');

            // Southland (STL)
            await insertLegal('NZ', 'STL', 'en', 'detecting_stl', 'Detecting in Southland', '<div class="legal-card legal-caution"><ul><li>Southland has gold prospecting history, particularly around the Oreti River and surrounding areas</li><li>Fiordland National Park and other DOC land strictly prohibit detecting</li><li>Private farmland with permission is the primary detecting option</li><li>Stewart Island/Rakiura is largely DOC-managed — detecting prohibited</li><li>Early European settlement and whaling sites may be protected archaeological sites (pre-1900)</li><li>Invercargill and Bluff area have colonial-era history for potential detecting</li></ul></div>', 'caution', 10, null, '2025-01-15');
    }

    // Apply source URLs to legal content (runs on every startup, idempotent)
    var LEGAL_SOURCE_URLS = {
        'US||federal_arpa': 'https://www.nps.gov/subjects/archeology/archaeological-resources-protection-act.htm https://uscode.house.gov/view.xhtml?path=/prelim@title16/chapter1B&edition=prelim',
        'US||blm_land': 'https://www.blm.gov/programs/recreation',
        'US||national_grassland': 'https://www.fs.usda.gov/managing-land/national-forests-grasslands',
        'US||state_parks': 'https://www.nps.gov/subjects/archeology/state-archeologists.htm',
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
        'US|OH|state_overview': 'https://ohiodnr.gov/',
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
        'US||beach_foreshore_us': 'https://www.nps.gov/subjects/archeology/abandoned-shipwreck-act.htm',
        'US||reporting_finds_us': 'https://www.nps.gov/subjects/nagpra/index.htm https://www.nps.gov/subjects/archeology/state-archeologists.htm',
        'GB||treasure_act': 'https://www.legislation.gov.uk/ukpga/1996/24/contents https://finds.org.uk/treasure',
        'GB||pas_scheme': 'https://finds.org.uk/',
        'GB||permissions_land': 'https://historicengland.org.uk/advice/planning/consents/scheduled-monument-consent/',
        'GB||scotland_law': 'https://treasuretrovescotland.co.uk/ https://www.historicenvironment.scot/',
        'GB|ENG|detecting_england': 'https://finds.org.uk/ https://historicengland.org.uk/',
        'GB|SCT|detecting_scotland': 'https://treasuretrovescotland.co.uk/ https://www.historicenvironment.scot/',
        'GB|WLS|detecting_wales': 'https://cadw.gov.wales/ https://museum.wales/',
        'GB|NIR|detecting_nir': 'https://www.communities-ni.gov.uk/topics/historic-environment',
        'GB||beach_foreshore_gb': 'https://www.thecrownestate.co.uk/our-business/marine https://www.gov.uk/report-wreck-material',
        'GB||exporting_finds_gb': 'https://www.artscouncil.org.uk/supporting-collections-and-cultural-property/export-controls https://www.legislation.gov.uk/ukpga/2003/6/contents',
        'GB||insurance_liability_gb': 'https://www.ncmd.co.uk/ https://www.fid.org.uk/',
        'AU||au_overview': 'https://www.dcceew.gov.au/parks-heritage/heritage',
        'AU||au_protected': 'https://www.dcceew.gov.au/parks-heritage/national-parks',
        'AU|VIC|detecting_vic': 'https://earthresources.vic.gov.au/licensing-and-approvals/mineral-licences/miners-right https://www.parks.vic.gov.au/',
        'AU|WA_AU|detecting_wa': 'https://www.dmp.wa.gov.au/Minerals/Miners-Rights-6106.aspx https://www.dbca.wa.gov.au/',
        'AU|QLD|detecting_qld': 'https://www.resources.qld.gov.au/mining-resources/initiatives/fossicking https://parks.des.qld.gov.au/',
        'AU|NSW|detecting_nsw': 'https://www.heritage.nsw.gov.au/ https://www.nationalparks.nsw.gov.au/',
        'AU|SA|detecting_sa': 'https://www.energymining.sa.gov.au/ https://www.parks.sa.gov.au/',
        'AU|TAS|detecting_tas': 'https://www.mrt.tas.gov.au/ https://parks.tas.gov.au/',
        'AU||beach_foreshore_au': 'https://www.dcceew.gov.au/parks-heritage/heritage/historic-shipwrecks',
        'AU||reporting_finds_au': 'https://www.dcceew.gov.au/parks-heritage/heritage',
        'CA||ca_overview': 'https://parks.canada.ca/ https://laws-lois.justice.gc.ca/eng/acts/h-4/',
        'CA||ca_federal': 'https://parks.canada.ca/ https://laws-lois.justice.gc.ca/eng/acts/n-14.01/',
        'CA|ON|detecting_on': 'https://www.ontarioparks.ca/ https://www.ontario.ca/laws/statute/90o18',
        'CA|BC|detecting_bc': 'https://bcparks.ca/ https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96187_01',
        'CA|AB|detecting_ab': 'https://www.albertaparks.ca/ https://www.alberta.ca/historical-resources-act',
        'CA|QC|detecting_qc': 'https://www.sepaq.com/ https://www.quebec.ca/en/culture/cultural-heritage',
        'CA|MB|detecting_mb': 'https://www.gov.mb.ca/chc/hrb/ https://www.gov.mb.ca/sd/parks/',
        'CA|MB|crown_land_mb': 'https://www.gov.mb.ca/sd/parks/',
        'CA|SK|detecting_sk': 'https://www.saskatchewan.ca/residents/parks-culture-heritage/heritage-conservation https://www.tourismsaskatchewan.com/provincial-parks',
        'CA|SK|crown_land_sk': 'https://www.saskatchewan.ca/residents/parks-culture-heritage',
        'CA|NS|detecting_ns': 'https://cch.novascotia.ca/exploring-our-past/heritage https://parks.novascotia.ca/',
        'CA|NS|beaches_ns': 'https://parks.novascotia.ca/ https://cch.novascotia.ca/',
        'CA|NB|detecting_nb': 'https://www2.gnb.ca/content/gnb/en/departments/thc/heritage.html https://www.tourismnewbrunswick.ca/provincial-parks',
        'CA|PE|detecting_pe': 'https://www.princeedwardisland.ca/en/topic/heritage-places https://www.tourismpei.com/provincial-parks',
        'CA|NL|detecting_nl': 'https://www.gov.nl.ca/tcar/archaeology/ https://www.gov.nl.ca/tcar/parks/',
        'CA|NL|heritage_nl': 'https://www.gov.nl.ca/tcar/archaeology/ https://www.heritage.nf.ca/',
        'CA|YT|detecting_yt': 'https://yukon.ca/en/science-and-natural-resources/archaeology https://yukon.ca/en/outdoor-recreation-and-wildlife/parks',
        'CA|YT|gold_prospecting_yt': 'https://yukon.ca/en/science-and-natural-resources/mining https://yukon.ca/en/doing-business/licensing/apply-free-miners-certificate',
        'CA|NT|detecting_nt': 'https://www.gov.nt.ca/en/services/archaeology-and-heritage https://www.nwtparks.ca/',
        'CA|NU|detecting_nu': 'https://www.gov.nu.ca/culture-and-heritage https://nunavutparks.com/',
        'CA||beach_foreshore_ca': 'https://laws-lois.justice.gc.ca/eng/acts/c-10.15/',
        'CA||reporting_finds_ca': 'https://parks.canada.ca/ https://laws-lois.justice.gc.ca/eng/acts/h-4/',
        'NZ||nz_overview': 'https://www.doc.govt.nz/ https://www.heritage.org.nz/',
        'NZ||nz_protected': 'https://www.heritage.org.nz/ https://www.legislation.govt.nz/act/public/2014/0026/latest/whole.html',
        'NZ||nz_goldfields': 'https://www.doc.govt.nz/parks-and-recreation/things-to-do/gold-panning/ https://www.nzpam.govt.nz/',
        'NZ||beach_foreshore_nz': 'https://www.doc.govt.nz/ https://www.heritage.org.nz/',
        'NZ||reporting_finds_nz': 'https://www.heritage.org.nz/ https://www.legislation.govt.nz/act/public/2014/0026/latest/whole.html',
        'NZ||ethics_nz': 'https://www.heritage.org.nz/ https://www.doc.govt.nz/',
        'NZ|OTA|detecting_ota': 'https://www.doc.govt.nz/parks-and-recreation/places-to-go/otago/ https://www.heritage.org.nz/',
        'NZ|OTA|goldfields_ota': 'https://www.doc.govt.nz/parks-and-recreation/things-to-do/gold-panning/ https://www.heritage.org.nz/',
        'NZ|WTC|detecting_wtc': 'https://www.doc.govt.nz/parks-and-recreation/places-to-go/west-coast/ https://www.heritage.org.nz/',
        'NZ|WTC|goldfields_wtc': 'https://www.nzpam.govt.nz/ https://www.doc.govt.nz/parks-and-recreation/things-to-do/gold-panning/',
        'NZ|CAN|detecting_can': 'https://www.doc.govt.nz/parks-and-recreation/places-to-go/canterbury/ https://www.ecan.govt.nz/',
        'NZ|AUK|detecting_auk': 'https://www.aucklandcouncil.govt.nz/parks-recreation/ https://www.doc.govt.nz/',
        'NZ|AUK|beaches_auk': 'https://www.aucklandcouncil.govt.nz/parks-recreation/',
        'NZ|BOP|detecting_bop': 'https://www.doc.govt.nz/parks-and-recreation/places-to-go/bay-of-plenty/ https://www.boprc.govt.nz/',
        'NZ|STL|detecting_stl': 'https://www.doc.govt.nz/parks-and-recreation/places-to-go/southland/ https://www.heritage.org.nz/',
        'GB|ENG|code_of_practice_eng': 'https://www.gov.uk/government/publications/responsible-use-of-metal-detectors https://www.ncmd.co.uk/',
        'GB|ENG|popular_areas_eng': 'https://finds.org.uk/ https://historicengland.org.uk/',
        'GB|ENG|scheduled_monuments_eng': 'https://historicengland.org.uk/listing/the-list/ https://historicengland.org.uk/advice/planning/consents/scheduled-monument-consent/',
        'GB|SCT|treasure_trove_process_sct': 'https://treasuretrovescotland.co.uk/ https://www.nms.ac.uk/',
        'GB|SCT|access_rights_sct': 'https://www.outdooraccess-scotland.scot/ https://www.historicenvironment.scot/',
        'GB|WLS|cadw_wls': 'https://cadw.gov.wales/ https://coflein.gov.uk/',
        'GB|WLS|popular_areas_wls': 'https://museum.wales/ https://finds.org.uk/',
        'GB|NIR|licensing_nir': 'https://www.communities-ni.gov.uk/topics/historic-environment https://www.communities-ni.gov.uk/articles/archaeological-objects',
        'GB|NIR|protected_places_nir': 'https://www.communities-ni.gov.uk/topics/historic-environment https://www.communities-ni.gov.uk/services/historic-environment-map-viewer',
    };

    // Apply source URLs (idempotent, runs on every startup)
    var keys = Object.keys(LEGAL_SOURCE_URLS);
    for (var i = 0; i < keys.length; i++) {
        var parts = keys[i].split('|');
        var url = LEGAL_SOURCE_URLS[keys[i]];
        if (!url) continue;
        var country = parts[0];
        var region = parts[1] || null;
        var sectionKey = parts[2];
        await pool.query(
            'UPDATE legal_content SET source_url = $1 WHERE country_code = $2 AND (region_code IS NOT DISTINCT FROM $3) AND section_key = $4 AND (source_url IS NULL OR source_url != $1)',
            [url, country, region, sectionKey]
        );
    }

    // =====================================================
    // DEMO USER + SAMPLE DATA (for interactive demo mode)
    // =====================================================
    // Only seed if an admin exists (app has been set up) and demo user doesn't exist yet
    var adminExists = (await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1")).rows[0];
    var demoExists = (await pool.query("SELECT id FROM users WHERE email = 'demo@example.com'")).rows[0];

    if (adminExists && !demoExists) {
        // Create demo user
        var demoResult = await pool.query(
            "INSERT INTO users (email, password_hash, display_name, role, email_verified, country_code, unit_preference, is_demo) VALUES ($1, $2, $3, $4, true, 'US', 'imperial', true) RETURNING id",
            ['demo@example.com', '__NO_PASSWORD__', 'Demo User', 'user']
        );
        var demoUserId = demoResult.rows[0].id;

        // --- Sites (Ohio/Midwest themed, fictional) ---
        var s1 = await pool.query(
            'INSERT INTO sites (user_id, name, description, latitude, longitude, land_type, permission_status, site_status, priority, tags, permission_contact_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
            [demoUserId, 'Old Miller Homestead', 'Private farmland with 1820s homestead foundations. Landowner gave written permission.', 40.12, -81.47, 'private', 'granted', 'detecting', 5, 'homestead,canal-era,foundations', 'Tom Miller']
        );
        var s2 = await pool.query(
            'INSERT INTO sites (user_id, name, description, latitude, longitude, land_type, permission_status, site_status, priority, tags, permission_contact_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
            [demoUserId, 'Towpath Bend (Private Parcel)', 'Private lot adjacent to old canal towpath. Owner is history enthusiast.', 41.20, -81.55, 'private', 'granted', 'scouted', 4, 'canal,towpath,private-land', 'Jim Novak']
        );
        await pool.query(
            'INSERT INTO sites (user_id, name, description, latitude, longitude, land_type, permission_status, site_status, priority, tags, permission_contact_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [demoUserId, 'Wayne National Forest - Archers Fork', 'USFS land in Wayne National Forest. Casual detecting for modern items allowed per forest service rules.', 39.48, -81.46, 'usfs', 'not_required', 'identified', 3, 'national-forest,public-land,settlement-trail', null]
        );
        var s4 = await pool.query(
            'INSERT INTO sites (user_id, name, description, latitude, longitude, land_type, permission_status, site_status, priority, tags, permission_contact_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
            [demoUserId, 'Lakeshore Public Beach', 'Public beach with municipal access. No permit required for sand areas.', 41.53, -82.73, 'municipal', 'not_required', 'detecting', 4, 'beach,public-land,lake-erie', null]
        );
        var s5 = await pool.query(
            'INSERT INTO sites (user_id, name, description, latitude, longitude, land_type, permission_status, site_status, priority, tags, permission_contact_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
            [demoUserId, 'Henderson Property (Pending)', '1840s farmstead. Awaiting landowner response to permission letter.', 40.06, -82.40, 'private', 'requested', 'identified', 2, 'farmstead,private-land,civil-war', 'David Henderson']
        );
        var s6 = await pool.query(
            'INSERT INTO sites (user_id, name, description, latitude, longitude, land_type, permission_status, site_status, priority, tags, permission_contact_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
            [demoUserId, 'Y-Bridge — Zanesville', 'Historic Y-shaped bridge at the confluence of the Licking and Muskingum Rivers. Public access from Putnam Park and Linden Ave side. Great magnet fishing spot with 200+ years of bridge history.', 39.9403, -82.0132, 'magnet_fishing', 'not_required', 'detecting', 4, 'magnet-fishing,bridge,river,historic', null]
        );

        var siteId1 = s1.rows[0].id;
        var siteId2 = s2.rows[0].id;
        var siteId4 = s4.rows[0].id;
        var siteId5 = s5.rows[0].id;
        var siteId6 = s6.rows[0].id;

        // --- Finds (with demo photo paths) ---
        async function insertFind(userId, siteId, description, dateFound, material, depthCm, depthInches, condition, valueEstimate, photoPath, estimatedAge, lat, lng) {
            await pool.query(
                'INSERT INTO finds (user_id, site_id, description, date_found, material, depth_cm, depth_inches, condition, value_estimate, photo_path, estimated_age, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
                [userId, siteId, description, dateFound, material, depthCm, depthInches, condition, valueEstimate, photoPath, estimatedAge, lat, lng]
            );
        }
        await insertFind(demoUserId, siteId1, '1943 Steel Wheat Penny', '2025-11-15', 'zinc', 10.2, 4.0, 'good', 0.50, 'uploads/finds/demo-wheat-penny.jpg', '1943', 40.12, -81.47);
        await insertFind(demoUserId, siteId1, 'Mercury Dime (1941)', '2025-11-15', 'silver', 15.2, 6.0, 'excellent', 12.00, 'uploads/finds/demo-silver-dime.jpg', '1941', 40.121, -81.471);
        await insertFind(demoUserId, siteId1, 'Square nail cluster (hand-forged)', '2025-12-01', 'iron', 20.3, 8.0, 'fair', 0.00, 'uploads/finds/demo-square-nails.jpg', '1820s', 40.119, -81.469);
        await insertFind(demoUserId, siteId2, 'Brass overall button - canal worker', '2025-12-01', 'brass', 12.7, 5.0, 'good', 15.00, 'uploads/finds/demo-brass-button.jpg', '1850s', 41.20, -81.55);
        await insertFind(demoUserId, siteId2, 'Copper thimble (1850s era)', '2025-12-08', 'copper', 8.9, 3.5, 'good', 25.00, 'uploads/finds/demo-copper-thimble.jpg', '1850s', 41.201, -81.551);
        await insertFind(demoUserId, siteId4, 'Horseshoe fragment', '2026-01-05', 'iron', 5.1, 2.0, 'poor', 0.00, 'uploads/finds/demo-horseshoe.jpg', null, 41.53, -82.73);
        await insertFind(demoUserId, siteId4, 'Lead musket ball (.69 cal)', '2026-01-05', 'lead', 22.9, 9.0, 'fair', 10.00, 'uploads/finds/demo-musket-ball.jpg', 'Civil War era', 41.531, -82.731);
        await insertFind(demoUserId, siteId1, 'Indian Head Penny (1897)', '2026-01-20', 'copper', 17.8, 7.0, 'fair', 8.00, 'uploads/finds/demo-indian-head.jpg', '1897', 40.12, -81.472);
        await insertFind(demoUserId, siteId6, 'Rusty padlock — magnet fishing', '2026-02-01', 'iron', null, null, 'poor', 0.00, 'uploads/finds/demo-padlock.jpg', null, 39.9403, -82.0132);
        await insertFind(demoUserId, siteId6, 'Railroad spike — magnet fishing', '2026-02-01', 'iron', null, null, 'fair', 0.00, 'uploads/finds/demo-railroad-spike.jpg', null, 39.9404, -82.0131);

        // --- Permissions (private land only, fictional contacts) ---
        async function insertPerm(userId, siteId, landType, agencyOrOwner, contactName, status, dateRequested, dateGranted) {
            await pool.query(
                'INSERT INTO permissions (user_id, site_id, land_type, agency_or_owner, contact_name, status, date_requested, date_granted) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [userId, siteId, landType, agencyOrOwner, contactName, status, dateRequested, dateGranted]
            );
        }
        await insertPerm(demoUserId, siteId1, 'private', 'Tom Miller (landowner)', 'Tom Miller', 'approved', '2025-10-01', '2025-10-05');
        await insertPerm(demoUserId, siteId2, 'private', 'Jim Novak (landowner)', 'Jim Novak', 'approved', '2025-10-15', '2025-10-20');
        await insertPerm(demoUserId, siteId5, 'private', 'David Henderson', 'David Henderson', 'pending', '2026-01-25', null);
    }
};
