const http = require('http');

const sites = [
    {
        name: 'Peoria Creek Homestead',
        description: 'Ranch compound with stock pond and fenced field along cottonwood-lined creek bottom. Buildings visible on satellite. Classic homestead layout with water source, corrals, and irrigated field. Off S Peoria Xing Rd / CR-201.',
        latitude: 39.649,
        longitude: -104.100,
        land_type: 'private',
        permission_status: 'not_requested',
        site_status: 'identified',
        priority: 4,
        tags: 'homestead,creek,stock-pond,cottonwoods,corral,satellite-verified'
    },
    {
        name: 'Rd 162 Creek Ranch',
        description: 'Isolated ranch on creek with stock pond and buildings. Dirt road access only. Green creek drainage through open grassland. Remote private rangeland south of I-70.',
        latitude: 39.455,
        longitude: -104.055,
        land_type: 'private',
        permission_status: 'not_requested',
        site_status: 'identified',
        priority: 3,
        tags: 'ranch,creek,stock-pond,isolated,rangeland,satellite-verified'
    },
    {
        name: 'Ridge Rd Old Windbreak Ranch',
        description: 'Established ranch compound with dense mature tree windbreak (cottonwoods/elms) and multiple outbuildings. Contour-plowed fields surround the homestead. Near Ridge Rd and Rd 122. Classic 1800s homestead tree planting pattern.',
        latitude: 39.300,
        longitude: -104.210,
        land_type: 'private',
        permission_status: 'not_requested',
        site_status: 'identified',
        priority: 4,
        tags: 'homestead,windbreak,trees,old-ranch,contour-plow,satellite-verified'
    },
    {
        name: 'Creek Confluence Rangeland',
        description: 'Wild broken rangeland with multiple creek drainages converging. Stock pond visible. Small structure near creek junction. Very remote - no visible roads. Deeply eroded terrain with green creek bottoms.',
        latitude: 39.255,
        longitude: -103.990,
        land_type: 'private',
        permission_status: 'not_requested',
        site_status: 'identified',
        priority: 3,
        tags: 'creek,confluence,stock-pond,remote,rangeland,satellite-verified'
    },
    {
        name: 'Horseshoe Creek Windbreak Homestead',
        description: 'Ranch with dense mature tree windbreak grove near Horseshoe Creek. White buildings and stock pond visible. Contour-plowed fields. Rd 189 access. Mature trees suggest 1800s establishment. Eroded creek terrain to west.',
        latitude: 39.260,
        longitude: -103.790,
        land_type: 'private',
        permission_status: 'not_requested',
        site_status: 'identified',
        priority: 4,
        tags: 'homestead,windbreak,trees,stock-pond,creek,contour-plow,satellite-verified'
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
    console.log('\nAll Denver-east homestead sites added!');
})();
