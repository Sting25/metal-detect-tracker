const https = require('https');
const fs = require('fs');
const path = require('path');
const db = require('./database.js');

const sites = [
    { id: 57, lat: 39.649, lng: -104.100, file: 'peoria-creek-homestead.jpg' },
    { id: 58, lat: 39.455, lng: -104.055, file: 'rd162-creek-ranch.jpg' },
    { id: 59, lat: 39.300, lng: -104.210, file: 'ridge-rd-windbreak-ranch.jpg' },
    { id: 60, lat: 39.255, lng: -103.990, file: 'creek-confluence-rangeland.jpg' },
    { id: 61, lat: 39.260, lng: -103.790, file: 'horseshoe-creek-homestead.jpg' }
];

let completed = 0;
sites.forEach(s => {
    const bbox = (s.lng-0.01)+','+(s.lat-0.008)+','+(s.lng+0.01)+','+(s.lat+0.008);
    const url = 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox='+bbox+'&bboxSR=4326&size=800,600&format=jpg&f=image';
    const imgPath = 'uploads/sites/' + s.file;

    const dir = path.dirname(path.join(__dirname, imgPath));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive:true});

    https.get(url, res => {
        const file = fs.createWriteStream(path.join(__dirname, imgPath));
        res.pipe(file);
        file.on('finish', () => {
            file.close();
            db.prepare("UPDATE sites SET image_path = ?, updated_at = datetime('now') WHERE id = ?").run(imgPath, s.id);
            completed++;
            console.log('(' + completed + '/' + sites.length + ') Downloaded site ' + s.id + ' -> ' + imgPath);
        });
    });
});
