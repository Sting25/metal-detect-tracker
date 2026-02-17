const db = require('./database.js');

// Map sites to their counties based on coordinates
const countyUpdates = [
    { id: 2, county: 'Lincoln County', assessor_url: 'https://lincolncountyco.us/assessor' },
    { id: 3, county: 'Kiowa County', assessor_url: 'https://kiowacountyco.gov/assessor' },
    { id: 4, county: 'Kiowa County', assessor_url: 'https://kiowacountyco.gov/assessor' },
    { id: 5, county: 'Cheyenne County', assessor_url: 'https://cheyennecounty.net' },
    { id: 6, county: 'Kiowa County', assessor_url: 'https://kiowacountyco.gov/assessor' },
    { id: 7, county: 'Prowers County', assessor_url: 'https://prowerscounty.net' },
    { id: 8, county: 'Arapahoe County', assessor_url: 'https://gis.arapahoegov.com' },
    { id: 9, county: 'Arapahoe County', assessor_url: 'https://gis.arapahoegov.com' },
    { id: 10, county: 'Arapahoe County', assessor_url: 'https://gis.arapahoegov.com' },
    { id: 11, county: 'Arapahoe County', assessor_url: 'https://gis.arapahoegov.com' },
    { id: 12, county: 'Arapahoe County', assessor_url: 'https://gis.arapahoegov.com' },
    { id: 48, county: 'Lincoln County', assessor_url: 'https://lincolncountyco.us/assessor' },
    { id: 49, county: 'Crowley County', assessor_url: 'https://crowleycounty.net' },
    { id: 50, county: 'Lincoln County', assessor_url: 'https://lincolncountyco.us/assessor' },
    { id: 51, county: 'Cheyenne County', assessor_url: 'https://cheyennecounty.net' },
    { id: 52, county: 'Lincoln County', assessor_url: 'https://lincolncountyco.us/assessor' },
    { id: 53, county: 'Lincoln County', assessor_url: 'https://lincolncountyco.us/assessor' },
    { id: 54, county: 'Cheyenne County', assessor_url: 'https://cheyennecounty.net' },
    { id: 55, county: 'Cheyenne County', assessor_url: 'https://cheyennecounty.net' },
    { id: 56, county: 'Cheyenne County', assessor_url: 'https://cheyennecounty.net' },
    { id: 57, county: 'Arapahoe County', assessor_url: 'https://gis.arapahoegov.com' },
    { id: 58, county: 'Elbert County', assessor_url: 'https://www.elbertcounty-co.gov/assessor' },
    { id: 59, county: 'Elbert County', assessor_url: 'https://www.elbertcounty-co.gov/assessor' },
    { id: 60, county: 'Elbert County', assessor_url: 'https://www.elbertcounty-co.gov/assessor' },
    { id: 61, county: 'Lincoln County', assessor_url: 'https://lincolncountyco.us/assessor' }
];

// Add county info to legal_notes and notes fields
const stmt = db.prepare("UPDATE sites SET legal_notes = ?, updated_at = datetime('now') WHERE id = ?");

countyUpdates.forEach(u => {
    const note = 'County: ' + u.county + ' | Assessor: ' + u.assessor_url;
    stmt.run(note, u.id);
    console.log('Updated site ' + u.id + ' -> ' + u.county);
});

console.log('\nAll county info updated!');
console.log('\nTo look up property owners, visit:');
console.log('  Arapahoe County: https://gis.arapahoegov.com');
console.log('  Elbert County: https://www.elbertcounty-co.gov/assessor');
console.log('  Lincoln County: https://lincolncountyco.us/assessor');
console.log('  Cheyenne County: https://cheyennecounty.net');
console.log('  Kiowa County: https://kiowacountyco.gov/assessor');
console.log('  Crowley County: https://crowleycounty.net');
console.log('  Prowers County: https://prowerscounty.net');
