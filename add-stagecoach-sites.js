const http = require('http');

const sites = [
    {
        name: 'Old Wells Station (Smoky Hill Trail)',
        description: 'Butterfield Overland Despatch stagecoach station on the Smoky Hill Trail. Built from natural caves along south bluffs of Smoky Hill River with fresh water springs. About 5 miles north of present-day Cheyenne Wells. Trail split into north and south forks here. SE 1/4 Section 28-13-44.',
        latitude: 38.908,
        longitude: -102.365,
        land_type: 'private',
        permission_status: 'not_requested',
        site_status: 'identified',
        priority: 5,
        tags: 'stagecoach,smoky-hill-trail,butterfield,springs,caves,historic-trail,satellite-verified'
    },
    {
        name: 'Willow Springs Station (Smoky Hill Trail)',
        description: 'Butterfield Overland Dispatch stagecoach station at Willow Springs east of Hugo on Willow Creek. Lincoln County Fairgrounds now occupy part of the station site. East edge of fairgrounds is believed station location. Spring and small pools provided water.',
        latitude: 39.132,
        longitude: -103.445,
        land_type: 'private',
        permission_status: 'not_requested',
        site_status: 'identified',
        priority: 5,
        tags: 'stagecoach,smoky-hill-trail,butterfield,springs,willow-creek,satellite-verified'
    },
    {
        name: 'Lake Station / Hedingers Lake (Smoky Hill Trail)',
        description: 'Convergence of Butterfield Overland Dispatch and Republican Fork Trails where they crossed Big Sandy Creek. Later became railroad siding on Kansas Pacific. Stand of cottonwood trees marks the spot. Site of last major Indian attack in Eastern Colorado. Between Limon and Hugo near CR 23.',
        latitude: 39.170,
        longitude: -103.550,
        land_type: 'private',
        permission_status: 'not_requested',
        site_status: 'identified',
        priority: 5,
        tags: 'stagecoach,smoky-hill-trail,butterfield,railroad,ghost-town,creek-crossing,satellite-verified'
    },
    {
        name: 'Deering Wells Station (Smoky Hill Trail)',
        description: 'Stagecoach station on the North Trail, about 13 miles from Old Wells Station, halfway to Big Springs. NW 1/4 Section 20-13-46 in Cheyenne County. Along the Butterfield Overland route heading northwest toward Denver.',
        latitude: 38.945,
        longitude: -102.55,
        land_type: 'private',
        permission_status: 'not_requested',
        site_status: 'identified',
        priority: 4,
        tags: 'stagecoach,smoky-hill-trail,butterfield,wells,satellite-verified'
    },
    {
        name: 'Big Springs Station (Smoky Hill Trail)',
        description: 'Stagecoach station on east side of Big Springs Creek where creek curves around a hill. Hilltop barracks about 40 feet in diameter surrounded by trenches for protection. NE 1/4 Section 12-13-49 in Cheyenne County.',
        latitude: 39.00,
        longitude: -102.80,
        land_type: 'private',
        permission_status: 'not_requested',
        site_status: 'identified',
        priority: 5,
        tags: 'stagecoach,smoky-hill-trail,butterfield,barracks,trenches,creek,satellite-verified'
    },
    {
        name: 'Eureka Station (Smoky Hill Trail)',
        description: 'Stagecoach station on the South Trail, about 11 miles from Old Wells Station, southwest of Cheyenne Wells. A well was dug at this location near Big Sandy Creek. SW 1/3 Section 30-14-45 in Cheyenne County.',
        latitude: 38.78,
        longitude: -102.45,
        land_type: 'private',
        permission_status: 'not_requested',
        site_status: 'identified',
        priority: 4,
        tags: 'stagecoach,smoky-hill-trail,butterfield,well,big-sandy,satellite-verified'
    }
];

function addSite(site) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(site);
        const req = http.request({
            hostname: 'localhost',
            port: 3000,
            path: '/api/sites',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
        }, res => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                const result = JSON.parse(body);
                console.log('Added site ID ' + result.data.id + ': ' + result.data.name);
                resolve(result.data);
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

(async () => {
    for (const site of sites) {
        await addSite(site);
    }
    console.log('\nAll stagecoach stops added!');
})();
