const http = require('http');

const sites = [
    {
        name: 'Crowley County Tree Cluster Homestead',
        description: 'Tree cluster with old structures visible on satellite. Faint two-track roads converge on this spot. Cleared/disturbed area nearby suggests old homestead pad or corral. Remote open rangeland.',
        latitude: 38.726,
        longitude: -103.135,
        land_type: 'private',
        permission_status: 'not_requested',
        site_status: 'identified',
        priority: 4,
        tags: 'tree-cluster,homestead,corral,rangeland,satellite-verified'
    },
    {
        name: 'Hwy 3 Creek Bottom Homestead',
        description: 'Flat creek bottom area west of Hwy 3 showing old rectangular field/corral outlines as soil marks. Creek meander nearby. Classic homestead location along road and water source.',
        latitude: 39.205,
        longitude: -103.112,
        land_type: 'private',
        permission_status: 'not_requested',
        site_status: 'identified',
        priority: 3,
        tags: 'creek,homestead,corral,soil-marks,road,satellite-verified'
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
    console.log('All verified sites added!');
})();
