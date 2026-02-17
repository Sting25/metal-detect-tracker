const https = require('https');
const fs = require('fs');
const path = require('path');

const sites = [
  { id: 18, lat: 39.62, lng: -103.95, name: "agate-ghost-town" },
  { id: 19, lat: 38.97, lng: -103.12, name: "boyero-railroad-town" },
  { id: 20, lat: 39.29, lng: -103.23, name: "arriba-town-site" },
  { id: 21, lat: 39.29, lng: -103.06, name: "flagler-old-town" },
  { id: 22, lat: 38.83, lng: -102.84, name: "wild-horse-town" },
  { id: 23, lat: 38.04, lng: -103.43, name: "bents-old-fort-area" },
  { id: 24, lat: 38.07, lng: -103.22, name: "las-animas-old-town" },
  { id: 25, lat: 37.99, lng: -103.55, name: "la-junta-old-town" },
  { id: 26, lat: 38.05, lng: -103.72, name: "rocky-ford-melon-fields" },
  { id: 27, lat: 37.82, lng: -103.72, name: "timpas-creek-crossing" },
  { id: 28, lat: 37.75, lng: -103.60, name: "vogel-canyon" },
  { id: 29, lat: 37.02, lng: -102.73, name: "picture-canyon" },
  { id: 30, lat: 39.10, lng: -103.85, name: "big-sandy-creek-north" },
  { id: 31, lat: 39.22, lng: -103.68, name: "big-sandy-creek-limon" },
  { id: 32, lat: 39.23, lng: -104.53, name: "kiowa-creek-elbert" },
  { id: 33, lat: 39.35, lng: -104.46, name: "kiowa-town-outskirts" },
  { id: 34, lat: 40.25, lng: -103.80, name: "fort-morgan-old-town" },
  { id: 35, lat: 40.23, lng: -104.07, name: "bijou-creek-wiggins" },
  { id: 36, lat: 40.39, lng: -104.17, name: "dearfield-ghost-town" },
  { id: 37, lat: 39.13, lng: -104.17, name: "ramah-town" },
  { id: 38, lat: 39.37, lng: -103.83, name: "matheson-area" },
  { id: 39, lat: 40.81, lng: -103.99, name: "pawnee-buttes" },
  { id: 40, lat: 40.70, lng: -104.06, name: "keota-ghost-town" },
  { id: 41, lat: 38.57, lng: -102.52, name: "sand-creek-homesteads" },
  { id: 42, lat: 38.48, lng: -102.78, name: "eads-town-outskirts" },
  { id: 43, lat: 38.22, lng: -103.76, name: "ordway-area-farms" },
  { id: 44, lat: 38.24, lng: -103.66, name: "sugar-city-ghost-town" },
  { id: 45, lat: 40.16, lng: -103.22, name: "akron-area-homesteads" },
  { id: 46, lat: 40.07, lng: -102.22, name: "wray-old-town" },
  { id: 47, lat: 39.93, lng: -102.16, name: "beecher-island-area" },
];

const dir = path.join(__dirname, 'uploads', 'sites');

function downloadImage(site) {
  return new Promise((resolve, reject) => {
    const offset = 0.01;
    const bbox = `${site.lng - offset},${site.lat - offset},${site.lng + offset},${site.lat + offset}`;
    const url = `https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&size=800,600&format=jpg&f=image`;
    const filePath = path.join(dir, site.name + '.jpg');

    const file = fs.createWriteStream(filePath);
    https.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filePath);
      });
    }).on('error', (err) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
  });
}

async function main() {
  console.log('Downloading ' + sites.length + ' satellite images...');
  for (let i = 0; i < sites.length; i++) {
    try {
      await downloadImage(sites[i]);
      console.log('  [' + (i + 1) + '/' + sites.length + '] Downloaded: ' + sites[i].name + '.jpg');
    } catch (err) {
      console.log('  [' + (i + 1) + '/' + sites.length + '] ERROR: ' + sites[i].name + ' - ' + err.message);
    }
  }
  console.log('\nAll downloads complete!');

  // Now update DB
  const db = require('./database.js');
  const stmt = db.prepare("UPDATE sites SET image_path = ?, updated_at = datetime('now') WHERE id = ?");
  sites.forEach(s => {
    const imgPath = 'uploads/sites/' + s.name + '.jpg';
    stmt.run(imgPath, s.id);
    console.log('  DB updated: site ' + s.id + ' -> ' + imgPath);
  });
  console.log('\nDatabase updated!');
}

main();
