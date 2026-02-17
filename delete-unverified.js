const db = require('./database.js');
const fs = require('fs');
const path = require('path');

// Delete sites 18-47 (the 30 unverified ones)
for (let id = 18; id <= 47; id++) {
    const row = db.prepare('SELECT image_path FROM sites WHERE id = ?').get(id);
    if (row && row.image_path) {
        const imgPath = path.join(__dirname, row.image_path);
        try { fs.unlinkSync(imgPath); } catch (e) {}
    }
    db.prepare('DELETE FROM sites WHERE id = ?').run(id);
    console.log('Deleted site ' + id);
}
console.log('Done. Deleted IDs 18-47.');
