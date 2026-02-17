const db = require('./database.js');

const updates = [
    { id: 13, img: 'uploads/sites/boggsville-historic-site.jpg' },
    { id: 14, img: 'uploads/sites/karval-town-outskirts.jpg' },
    { id: 15, img: 'uploads/sites/homestead-farms-beedy.jpg' },
    { id: 16, img: 'uploads/sites/cedar-point-settlement.jpg' },
    { id: 17, img: 'uploads/sites/purgatoire-state-wildlife-area.jpg' }
];

const stmt = db.prepare("UPDATE sites SET image_path = ?, updated_at = datetime('now') WHERE id = ?");

updates.forEach(u => {
    stmt.run(u.img, u.id);
    console.log('Updated site', u.id, '->', u.img);
});

console.log('All done!');
