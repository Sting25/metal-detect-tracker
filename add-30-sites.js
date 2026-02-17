const http = require('http');

const sites = [
  // === ALONG I-70 CORRIDOR (Historic Railroad Towns) ===
  {
    name: "Agate Ghost Town",
    description: "Former railroad town on the Union Pacific line, now nearly abandoned. Established 1870s. A few structures remain along the tracks. Old town grid still visible on satellite. Classic railroad ghost town with high artifact potential.",
    latitude: 39.62, longitude: -103.95,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 4,
    tags: "ghost_town,old_road,foundation", notes: "Along I-70 east of Deer Trail. Former UP railroad stop. Nearly abandoned."
  },
  {
    name: "Boyero Railroad Town",
    description: "Tiny surviving railroad town in Lincoln County on the UP mainline. Founded 1880s. Post office, grain elevator remnants. Surrounding area had numerous homesteads that failed during the Dust Bowl. Cemetery nearby.",
    latitude: 38.97, longitude: -103.12,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 4,
    tags: "ghost_town,foundation,old_road,homestead", notes: "Historic railroad town on UP line. Near Hwy 40/287. Lincoln County."
  },
  {
    name: "Arriba Town Site",
    description: "Small plains town on I-70 in Lincoln County. Founded 1880s as railroad stop. Historic downtown area with some abandoned buildings. Railroad-era artifacts likely in old lots and surrounding fields.",
    latitude: 39.29, longitude: -103.23,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "ghost_town,foundation,old_road", notes: "Along I-70. Lincoln County seat area. Railroad era town."
  },
  {
    name: "Flagler Old Town",
    description: "Small plains town on I-70 near Kansas border. Founded 1888 as Rock Island Railroad stop. Named after Henry Flagler. Old downtown with some vacant lots and abandoned buildings. Railroad era potential.",
    latitude: 39.29, longitude: -103.06,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "ghost_town,foundation,old_road", notes: "I-70 corridor near Kit Carson County. Rock Island Railroad town."
  },
  {
    name: "Wild Horse Town",
    description: "Tiny unincorporated community on US-40 in Cheyenne County. Named for wild mustangs. Post office since 1911. Very small cluster of buildings on open prairie. Surrounding homesteads largely abandoned.",
    latitude: 38.83, longitude: -102.84,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "ghost_town,homestead,windmill", notes: "Cheyenne County on US-40. Named for wild horses."
  },

  // === ARKANSAS RIVER CORRIDOR (Santa Fe Trail) ===
  {
    name: "Bents Old Fort NHS Area",
    description: "Surrounding area of Bents Old Fort National Historic Site. The fort was the most important trading post on the Santa Fe Trail (1833-1849). While the fort itself is NPS property, surrounding private land along the Arkansas River has immense Santa Fe Trail artifact potential.",
    latitude: 38.04, longitude: -103.43,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 5,
    tags: "old_road,foundation,homestead", notes: "Near Bents Old Fort NHS. Santa Fe Trail corridor. Private land around the fort. Contact Otero County ranchers."
  },
  {
    name: "Las Animas Old Town",
    description: "Historic town at confluence of Purgatoire and Arkansas Rivers. County seat of Bent County since 1886. Kit Carson died here in 1868. Old town area has deep 1860s-1900s history. Check vacant lots and old residential areas.",
    latitude: 38.07, longitude: -103.22,
    land_type: "municipal", permission_status: "not_requested", status: "identified", priority: 4,
    tags: "ghost_town,foundation,old_road", notes: "Kit Carson died here 1868. Bent County seat. Arkansas/Purgatoire confluence."
  },
  {
    name: "La Junta Old Town",
    description: "Historic railroad junction town where the Santa Fe Trail split. Founded 1875. Koshare Indian Museum area. Old town core has deep history. AT&SF Railroad hub. Check old lots near railroad depot.",
    latitude: 37.99, longitude: -103.55,
    land_type: "municipal", permission_status: "not_requested", status: "identified", priority: 4,
    tags: "old_road,foundation,homestead", notes: "Santa Fe Trail junction. AT&SF railroad hub. Otero County seat."
  },
  {
    name: "Rocky Ford Melon Fields",
    description: "Historic agricultural town famous for cantaloupes since 1880s. Arkansas River valley. Old irrigation ditches and farm sites. Railroad era town with historic downtown. Check areas near old Santa Fe Railroad depot.",
    latitude: 38.05, longitude: -103.72,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "old_road,homestead,foundation", notes: "Arkansas River valley. Famous melon town since 1880s. Railroad era."
  },
  {
    name: "Timpas Creek Santa Fe Trail Crossing",
    description: "Historic crossing point on the Santa Fe Trail where Timpas Creek meets the trail route south of La Junta. Stage station and campsite location. Very remote rangeland. Iron Mountain nearby was a landmark for trail travelers.",
    latitude: 37.82, longitude: -103.72,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 5,
    tags: "old_road,cistern,foundation", notes: "Santa Fe Trail crossing. Stage station site. Very remote. Comanche National Grassland nearby."
  },

  // === COMANCHE NATIONAL GRASSLAND AREA ===
  {
    name: "Vogel Canyon Picnic Area",
    description: "Comanche National Grassland site with ancient rock art and Santa Fe Trail ruts. PUBLIC USFS LAND. Canyon with springs was a campsite for centuries. Trail ruts visible. Check regulations for detecting on USFS grassland.",
    latitude: 37.75, longitude: -103.60,
    land_type: "national_grassland", permission_status: "not_requested", status: "identified", priority: 4,
    tags: "old_road,cistern", notes: "PUBLIC LAND - Comanche National Grassland (USFS). Santa Fe Trail ruts visible. Check USFS regs."
  },
  {
    name: "Picture Canyon Area",
    description: "Comanche National Grassland site with extensive rock art and historic ranch sites. Public USFS land in Baca County. Very remote. Old ranch foundations and cattle operation remnants throughout the grassland.",
    latitude: 37.02, longitude: -102.73,
    land_type: "national_grassland", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "old_road,foundation,cistern", notes: "PUBLIC LAND - Comanche National Grassland. Baca County. Very remote. Check USFS regs."
  },

  // === BIG SANDY CREEK CORRIDOR ===
  {
    name: "Big Sandy Creek North",
    description: "Upper Big Sandy Creek in Elbert County. Creek corridor with scattered ranches and old homestead sites. Tree-lined creek with some abandoned structures visible on satellite. Good creek-bed detecting for lost items.",
    latitude: 39.10, longitude: -103.85,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "homestead,tree_cluster,old_road", notes: "Big Sandy Creek upper reach. Elbert County. Creek corridor."
  },
  {
    name: "Big Sandy Creek at Limon",
    description: "Big Sandy Creek near the town of Limon. Limon is a railroad junction town (UP and Rock Island). Creek runs south of town through rangeland with old ranch sites. Check areas where creek crosses old roads.",
    latitude: 39.22, longitude: -103.68,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "homestead,tree_cluster,old_road,windmill", notes: "Near Limon. Railroad junction area. Big Sandy Creek."
  },

  // === KIOWA CREEK CORRIDOR (Closer to Denver) ===
  {
    name: "Kiowa Creek at Elbert",
    description: "Kiowa Creek near the town of Elbert. Old ranching community southeast of Denver. Creek corridor with old ranch compounds and homesteads. Town founded 1870s. Check creek banks and old farmsteads.",
    latitude: 39.23, longitude: -104.53,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "homestead,tree_cluster,foundation", notes: "Near Elbert. Kiowa Creek. 45min from Denver. Old ranching area."
  },
  {
    name: "Kiowa Town Outskirts",
    description: "Small town in Elbert County on the plains SE of Denver. Founded 1880s. Historic downtown with some old buildings. Creek drainages around town with old homestead sites. Closest plains detecting to Denver metro.",
    latitude: 39.35, longitude: -104.46,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "homestead,old_road,foundation", notes: "Elbert County. 40min from Denver. Closest plains town to metro."
  },

  // === PLATTE RIVER CORRIDOR (North) ===
  {
    name: "Fort Morgan Old Town",
    description: "Historic town on the South Platte River. Named for Col. Christopher Morgan. Founded 1884 as railroad town. Sugar beet industry. Old town area near railroad with 1880s-1920s potential. Fort site was nearby.",
    latitude: 40.25, longitude: -103.80,
    land_type: "municipal", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "foundation,old_road", notes: "South Platte River. Morgan County seat. Railroad and sugar beet town."
  },
  {
    name: "Bijou Creek Crossing at Wiggins",
    description: "Where Bijou Creek meets the South Platte near Wiggins. Creek crossings were historically important spots. Stage route and early settlement. Old bridge sites and campgrounds.",
    latitude: 40.23, longitude: -104.07,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "old_road,tree_cluster,homestead", notes: "Creek confluence. Stage route area. Morgan County."
  },

  // === GHOST TOWNS AND ABANDONED SETTLEMENTS ===
  {
    name: "Dearfield Ghost Town",
    description: "Historically significant African American homestead colony founded 1910 by O.T. Jackson. National Register site. Buildings still standing but deteriorating. One of Colorado most important ghost towns. East of Greeley.",
    latitude: 40.39, longitude: -104.17,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 5,
    tags: "ghost_town,foundation,homestead", notes: "National Register site. African American colony 1910. Very significant. Check ownership/permissions carefully."
  },
  {
    name: "Ramah Town",
    description: "Tiny community in Elbert County SE of Denver. Founded as farming community. Some abandoned structures visible. Old school and church sites. Quiet area with Dust Bowl era abandonment.",
    latitude: 39.13, longitude: -104.17,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "ghost_town,homestead,foundation", notes: "Elbert County. Dust Bowl era abandonment. SE of Denver."
  },
  {
    name: "Matheson Area",
    description: "Tiny community on I-70 between Deer Trail and Limon. Railroad era settlement. Some structures remain. Surrounding rangeland has old homestead foundations. Very sparse population.",
    latitude: 39.37, longitude: -103.83,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "ghost_town,homestead,old_road", notes: "I-70 corridor. Railroad era. Between Deer Trail and Limon."
  },

  // === PAWNEE NATIONAL GRASSLAND AREA (North) ===
  {
    name: "Pawnee Buttes Trailhead Area",
    description: "Pawnee National Grassland PUBLIC USFS land. Famous buttes landmark. Surrounding grassland has old homestead foundations from failed 1900s-1930s farming attempts. Very remote. Check USFS detecting regulations.",
    latitude: 40.81, longitude: -103.99,
    land_type: "national_grassland", permission_status: "not_requested", status: "identified", priority: 4,
    tags: "homestead,foundation,windmill", notes: "PUBLIC LAND - Pawnee National Grassland (USFS). NE Colorado. Check regs."
  },
  {
    name: "Keota Ghost Town",
    description: "Famous Pawnee Grassland ghost town. Once thriving farming community, completely abandoned by 1940s. Church and some building remains. On/near public grassland. Featured in James Micheners Centennial.",
    latitude: 40.70, longitude: -104.06,
    land_type: "national_grassland", permission_status: "not_requested", status: "identified", priority: 5,
    tags: "ghost_town,foundation,homestead,windmill", notes: "Famous ghost town. Pawnee Grassland area. Michener connection. Check land ownership."
  },

  // === SAND CREEK / KIOWA COUNTY ===
  {
    name: "Sand Creek Area Homesteads",
    description: "Open rangeland along Sand Creek in Kiowa County. Historic area with old homestead sites scattered along the creek. Very remote and undisturbed. Note: Stay away from Sand Creek Massacre NHS (separate protected site).",
    latitude: 38.57, longitude: -102.52,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "homestead,windmill,old_road,tree_cluster", notes: "Kiowa County. STAY AWAY from Massacre NHS. Target old homesteads along general creek area."
  },
  {
    name: "Eads Town Outskirts",
    description: "County seat of Kiowa County. Small plains town founded 1880s on railroad. Old downtown, abandoned lots. Surrounding prairie has scattered homesteads. Historic grain elevators.",
    latitude: 38.48, longitude: -102.78,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "ghost_town,homestead,old_road,foundation", notes: "Kiowa County seat. Railroad town. Very remote eastern CO."
  },

  // === CROWLEY / OTERO COUNTY ===
  {
    name: "Ordway Area Farms",
    description: "Agricultural town in Crowley County. Founded 1900 during irrigation boom. Sugar beet era. Old irrigation ditches and farm sites. Some abandoned farmsteads visible on satellite.",
    latitude: 38.22, longitude: -103.76,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "homestead,foundation,old_road", notes: "Crowley County. Irrigation era. Sugar beet farming history."
  },
  {
    name: "Sugar City Ghost Town",
    description: "Former sugar beet processing town in Crowley County. National Sugar Manufacturing Company built here 1900. Sugar factory ruins and old town lots. Population dropped from 1000+ to under 250. Great industrial archaeology.",
    latitude: 38.24, longitude: -103.66,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 4,
    tags: "ghost_town,foundation,dump_site", notes: "Sugar factory town. Industrial ruins. Crowley County. Early 1900s."
  },

  // === WASHINGTON COUNTY (Northeast) ===
  {
    name: "Akron Area Homesteads",
    description: "County seat of Washington County in NE Colorado. Railroad town founded 1882. Surrounding area has extensive homestead-era settlement. Old farmsteads along creek drainages north and south of town.",
    latitude: 40.16, longitude: -103.22,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 3,
    tags: "homestead,windmill,old_road", notes: "Washington County seat. NE Colorado. Railroad and homestead era."
  },
  {
    name: "Wray Old Town Area",
    description: "County seat of Yuma County near Nebraska border. Historic Beecher Island Battlefield nearby (1868 Indian Wars engagement). Old downtown has 1880s-1920s buildings. Republican River nearby.",
    latitude: 40.07, longitude: -102.22,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 4,
    tags: "old_road,foundation,homestead", notes: "Yuma County seat. Beecher Island Battlefield nearby. Republican River."
  },
  {
    name: "Beecher Island Battlefield Area",
    description: "Site of the 1868 Battle of Beecher Island between US cavalry and Cheyenne/Sioux warriors. Arikaree Fork of Republican River. Monument on site. Surrounding private rangeland has military and Native American artifact potential.",
    latitude: 39.93, longitude: -102.16,
    land_type: "private", permission_status: "not_requested", status: "identified", priority: 5,
    tags: "old_road,foundation", notes: "1868 Indian Wars battlefield. Very historically significant. Private land - need permission. Monument on site."
  }
];

function postSite(site) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(site);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/sites',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('Adding ' + sites.length + ' sites...');
  const ids = [];
  for (let i = 0; i < sites.length; i++) {
    try {
      const result = await postSite(sites[i]);
      if (result.success) {
        ids.push(result.data.id);
        console.log('  [' + (i + 1) + '/' + sites.length + '] Added: ' + sites[i].name + ' (ID ' + result.data.id + ')');
      } else {
        console.log('  [' + (i + 1) + '/' + sites.length + '] FAILED: ' + sites[i].name + ' - ' + result.error);
      }
    } catch (err) {
      console.log('  [' + (i + 1) + '/' + sites.length + '] ERROR: ' + sites[i].name + ' - ' + err.message);
    }
  }
  console.log('\nDone! Added ' + ids.length + ' sites. IDs: ' + ids.join(', '));
}

main();
