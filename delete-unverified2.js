const db = require('./database.js');
const fs = require('fs');
const path = require('path');

// Delete sites 13-17 (the grid scan ones that weren't properly verified either)
for (let id = 13; id <= 17; id++) {
    const row = db.prepare('SELECT image_path FROM sites WHERE id = ?').get(id);
    if (row && row.image_path) {
        const imgPath = path.join(__dirname, row.image_path);
        try { fs.unlinkSync(imgPath); } catch (e) {}
    }
    db.prepare('DELETE FROM sites WHERE id = ?').run(id);
    console.log('Deleted site ' + id);
}

// Check what's left
const remaining = db.prepare('SELECT id, name FROM sites ORDER BY id').all();
console.log('\nRemaining sites:');
remaining.forEach(r => console.log('  ID ' + r.id + ': ' + r.name));
